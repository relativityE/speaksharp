/**
 * RWT R1 (row 15) — Retry Save and recovery on the deployed product.
 *
 * The take's completion request is the ONLY thing altered, once, on the page's own request:
 *  - request lost: the first `rpc/complete_session_v2` is aborted before it leaves the browser, so the server never saves;
 *  - response lost: the first request reaches the server and commits; only its response is dropped, so the server saved
 *    and the page does not know.
 * Both must show the truthful recovery banner with the words still on the page; Retry Save must leave exactly one saved
 * session for the take, with the newest-one retention state; and the next Start must save only itself. The server stays
 * real. Receipts are content-free: lengths and booleans, never transcript text. Preparation only: execution requires a
 * fresh release-bound RWT authorization.
 */
import { readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Page, Request, Route, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/rwtProductionTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RwtReceipt, loadRwtFixture, rwtLaunchArgs, suppressPageSnapshot, telemetryClassRows,
} from './helpers/rwtJourney';
import { type RunOwner, prepareRunOwnedAccount } from './helpers/rwtDisposableAccount';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { CoachingGenerationTap } from './helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from './helpers/rwtCoachingCollector';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, aliveReceipt, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
import { HarnessParityTap, type StartPressBudget } from './helpers/rwtHarnessParity';
import { openProductsItem } from './helpers/productsMenu';
import {
    expectBenchmarkRecordingStarted, preparePrivateModelIfPrompted, pressCaptureControl, selectBenchmarkMode, startBenchmarkRecording,
    stopBenchmarkRecording, waitForPrivateEngineReady,
} from './helpers/benchmark-utils';
import {
    CompletionObserver, SAVE_RETRY_SUITE, type SaveRetryVariant, type SessionRowFacts, completionDropDisposition,
    nextTakeIdArrived, nextTakeRetentionVerdict, recoveryBannerVerdict, savedTakeReadbackVerdict,
} from './helpers/rwtSaveRetry';
import {
    type CompletionAttempt, SAVED_ROW_COLUMNS, type SavedRow, attemptEvidence, completionAttemptsVerdict, exactRetrySaveVerdict,
    parseCompletionAttempt, reviewReopenVerdict, transcriptDigest,
} from './helpers/rwtSaveRetryAttempts';
import {
    J4A_COACHING_MAXIMUM, J4A_COACHING_ROUTE, J4A_START_PRESS_BUDGET, j4aCoachingBlockedRow, j4aCoachingGuard, j4aNoSecondTakeVerdict,
    j4aOneSaveForAccountVerdict, j4aPrivacyCleanupVerdict, j4aRequestNeverReachedVerdict,
} from './helpers/rwtJ4aEvidence';
import {
    SAVE_RETRY_CONSENT_MODE, captureConsentGate, settleFixedConsentOnPractice, type CaptureConsentGate, type ChoiceClient, type ConsentRowRecorder,
} from './helpers/rwtPracticeConsent';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
const fixture = loadRwtFixture('open_mic_tts');
const COMPLETION_RPC = '**/rest/v1/rpc/complete_session_v2';

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});
test.describe.configure({ mode: 'serial' });

/** Content-free facts for every session row of the run-owned account (lengths and states, never text). */
async function readSessionRows(uid: string): Promise<SessionRowFacts[]> {
    const { data, error } = await admin!.from('sessions')
        .select('id,status,idempotency_key,transcript_state,transcript,created_at').eq('user_id', uid).order('created_at');
    if (error || !Array.isArray(data)) throw new Error(`session row read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    return data.map((row) => ({
        id: String(row.id),
        status: typeof row.status === 'string' ? row.status : null,
        hasIdempotencyKey: typeof row.idempotency_key === 'string' && row.idempotency_key.length > 0,
        transcriptState: typeof row.transcript_state === 'string' ? row.transcript_state : null,
        transcriptLength: typeof row.transcript === 'string' ? row.transcript.length : 0,
    }));
}

/** The words on the page, as a length only: the live transcript or its container, whichever the page renders. */
async function transcriptOnPageLength(page: Page): Promise<number> {
    // `review-transcript` is the saved review's own surface (Sam 6218045990); the live surfaces are checked too.
    for (const id of ['live-transcript', 'transcript-container', 'review-transcript']) {
        const el = page.getByTestId(id).first();
        if (await el.count() === 0) continue;
        const text = await el.innerText({ timeout: 5_000 }).catch(() => '');
        if (text.trim().length > 0) return text.trim().length;
    }
    return 0;
}

/** The account's session rows with the durable-save columns, by id order; kept in memory only (never in a receipt). */
async function readSavedRows(uid: string, onlyActive = false): Promise<SavedRow[] | null> {
    let query = admin!.from('sessions').select(SAVED_ROW_COLUMNS).eq('user_id', uid);
    if (onlyActive) query = query.eq('status', 'active');
    const { data, error } = await query.order('created_at');
    return error || !Array.isArray(data) ? null : data as SavedRow[];
}

/**
 * J4.a evidence check: every row in ANY account holding the take's id, and every row holding the Start row's idempotency key
 * (admin reads, no user filter), so a save under another id or account is seen. Both reads are required: with no usable key
 * nothing is read and the verdict HOLDs by name (Sam, Nov 18), never an id-only PASS. Kept in memory only.
 */
async function readTakeRowsAnyAccount(sessionId: string, idempotencyKey: unknown): Promise<{ byId: SavedRow[]; byKey: SavedRow[] } | null> {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') return null;
    const byId = await admin!.from('sessions').select(SAVED_ROW_COLUMNS).eq('id', sessionId);
    if (byId.error || !Array.isArray(byId.data)) return null;
    const byKey = await admin!.from('sessions').select(SAVED_ROW_COLUMNS).eq('idempotency_key', idempotencyKey);
    if (byKey.error || !Array.isArray(byKey.data)) return null;
    return { byId: byId.data as SavedRow[], byKey: byKey.data as SavedRow[] };
}

/**
 * Harness `reopen` (browser-actions.cjs:155-158): open the saved take from Analytics, fingerprint the detail transcript
 * (sha256 of innerText.trim()), reload, fingerprint again. Digests only leave the page.
 */
async function reopenFromAnalytics(page: Page, id: string): Promise<{ opened: boolean; before: string | null; after: string | null }> {
    const fingerprint = async () => {
        const detail = page.getByTestId('session-detail-transcript');
        if (!(await detail.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false))) return null;
        return transcriptDigest(await detail.innerText());
    };
    await page.goto('/analytics', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const open = page.getByTestId(`open-session-detail-${id}`).or(page.getByTestId(`open-session-detail-mobile-${id}`)).first();
    const opened = await open.click({ timeout: 45_000 }).then(() => true).catch(() => false);
    if (!opened) return { opened, before: null, after: null };
    const before = await fingerprint();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    return { opened, before, after: await fingerprint() };
}

const persistedId = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));

/**
 * Harness parity (catalog AHT-05 = `request-lost`, AHT-06 = `response-lost`: draft-adapters/save-fault-binding.cjs:66), from the
 * journey's DESIGN (not a run's count). Each variant records two takes, each with one Start press:
 *   1. the faulted take — on a cold model `mic-download` (`preparePrivateModelIfPrompted`, helpers/benchmark-utils.ts:609, whose one
 *      press downloads AND starts the take), otherwise `mic-start` (`startBenchmarkRecording` at ready, helpers/benchmark-utils.ts:862);
 *      exactly one of the two, since the start helper is skipped when setup already started the take;
 *   2. the next take — the completed review's `verdict-practice-again` (`again.click()`, rwt-save-retry-recovery.live.spec.ts:227).
 * Retry Save (`session-retry-save`) is not a Start control. So: 2 presses in all; `mic-download` at most 1, `mic-start` at most 1,
 * `verdict-practice-again` at most 1, and no Retry press. Same for both variants.
 */
const SAVE_RETRY_START_PRESS_BUDGET: StartPressBudget = { total: 2, perControl: { 'mic-download': 1, 'mic-start': 1, 'verdict-practice-again': 1 } };
/** The page-close step's own bound: each page close is itself bounded at 15 s inside it. */
const PARITY_CLOSE_STEP_MS = 60_000;

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();

async function runVariant(page: Page, testInfo: TestInfo, variant: SaveRetryVariant): Promise<void> {
    const suite = `${SAVE_RETRY_SUITE}-${variant}`;
    const receipt = new RwtReceipt(`${SAVE_RETRY_SUITE}-${variant}`);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    tap.attach(page); generations.attach(page);
    // Harness parity (PO route 2026-11-10): Cloud STT requests and Start presses on every page of this variant's context;
    // attached in the body below, before the first navigation.
    const parity = new HarnessParityTap();
    const owner: RunOwner = { email: '', uid: '' };
    // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the 30-minute timeout.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(suite), label: suite });
    const takes: string[] = [];
    let claimed = false;
    let accountDeleted = false;
    // The ONE altered request. Every other completion request, including Retry Save's replay, reaches the server untouched.
    const drop = { completionPosts: 0, droppedStatus: null as number | null, dropped: false, forwarded: false, droppedSessionId: null as string | null };
    // AHT-05/06 `completion-attempts` (harness completion-attempts.cjs): every completion POST's session, body sha and phase.
    // `retryMarked` is set immediately before the explicit Retry Save click. Bodies stay in memory.
    const attempts: CompletionAttempt[] = [];
    const attemptByRequest = new Map<Request, CompletionAttempt>();
    let retryMarked = false;
    // J4.a (request lost) is bounded (Sam, Nov 19; PO's approved run): ONE take, zero coaching requests, and the journey stops
    // right after the Retry Save readback. BOTH legs prove Save: Yes / Coaching: No at each Start click (#1835; Sam, Nov 20).
    const j4a = variant === 'request-lost';
    const leg = j4a ? 'J4.a' : 'J4.b';
    let choiceVerified = false;
    // J4.a: coaching is blocked in the browser, not only counted (Sam, Nov 19 on c558f4c). Armed below, before the first page.
    const coachingGuard = j4aCoachingGuard();
    // #1258 C — every non-dropped completion call's answer, read from the browser's own events by request identity.
    const completions = new CompletionObserver<Request>();
    page.on('response', (response) => {
        const attempt = attemptByRequest.get(response.request());
        if (attempt) attempt.httpStatus = response.status();
        if (completions.isObserved(response.request())) completions.onResponse(response.request(), response.status(), response.text().catch(() => null));
    });
    page.on('requestfailed', (request) => completions.onFailed(request, request.failure()?.errorText));
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
        // (bounded; page-independent, since a finalizer may run after its tabs closed).
        await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
        await steps.step('watchdog', () => watch.record(receipt));
        // Sam, #1811 b319d42b RETURN: the completion route is the attempts observer, so it is never removed before the page
        // closes. It stays through coaching settle and the page close; a late attempt at any point before close is recorded.
        await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
        // J4.b: two saved takes, at most one coaching request each. J4.a: coaching off, so none at all (Sam, Nov 19).
        await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations,
            { maximum: j4a ? J4A_COACHING_MAXIMUM : 2, oneRequestPerSession: takes }));
        // Harness parity rows (catalog AHT-05/AHT-06: no-cloud-stt, start-press-budget, owned-pages-closed), before the account is
        // deleted. Bounded steps, rows only while each step is alive, and the page close in its own step, last before cleanup.
        await steps.step('harness parity counts', (alive) => {
            parity.noCloudSttRow(aliveReceipt(receipt, alive));
            parity.startPressRow(aliveReceipt(receipt, alive), j4a ? J4A_START_PRESS_BUDGET : SAVE_RETRY_START_PRESS_BUDGET);
        });
        await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
        // J4.a coaching block (Sam, Nov 19 on 2b57bd47): read the block count only AFTER every owned page is proven closed, so an
        // attempt made between the checks above and the close is counted. The route stays armed through the close; an unproven
        // closure HOLDs.
        if (j4a) await steps.step('J4.a coaching blocked', (alive) => {
            j4aCoachingBlockedRow(aliveReceipt(receipt, alive), 'J4.a: no coaching request left the browser', coachingGuard, parity.ownedPagesClosedAt);
        });
        // Harness `completion-attempts` at the FINAL boundary (final-attempts.cjs): every owned page is closed, so no completion
        // request can still arrive; a late attempt after the in-journey checks is counted here, never missed.
        await steps.step('completion attempts', (alive) => {
            const attemptsVerdict = completionAttemptsVerdict(attempts);
            aliveReceipt(receipt, alive).row('completion attempts are the fault and one Retry', attemptsVerdict.status, attemptsVerdict.detail,
                { attempts: attemptEvidence(attempts, attempts.find((a) => a.dropped)?.sessionId ?? null), retryMarked });
        });
        // J4.a stops after the Retry readback: at the final boundary the account holds the one take and nothing else.
        if (j4a) {
            await steps.step('J4.a one take', async (alive) => {
                const ownerRows = owner.uid ? await readSavedRows(owner.uid) : null;
                const one = j4aNoSecondTakeVerdict({ takeSessionId: drop.droppedSessionId, ownerRows, attemptSessionIds: attempts.map((a) => a.sessionId) });
                aliveReceipt(receipt, alive).row('J4.a: one take, nothing after Retry', one.status, one.detail,
                    { reason: one.reason, ownerRows: ownerRows?.length ?? null, completionPosts: attempts.length });
            });
        }
        // A signup that died before its uid was read is still found by its created email.
        if ((owner.uid || owner.email) && !accountDeleted) {
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion; its own settlement decides the row.
            accountDeleted = (await finalizeOwnedCleanup(steps, receipt, new OwnedCleanup(
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX,
                    stoppedTakes: { writersClosedAt: () => parity.ownedPagesClosedAt, unsettledSaves: () => parity.unsettledSaves } })))) === 'deleted';
        }
        // J4.a and J4.b (Sam, Nov 19): cleanup must also leave no privacy choice row for the owner (a counted zero by its exact id).
        await steps.step(`${leg} privacy choice cleanup`, async (alive) => {
            const read = owner.uid && accountDeleted
                ? await admin!.from('practice_privacy_choices').select('user_id', { count: 'exact', head: true }).eq('user_id', owner.uid)
                : null;
            const gone = j4aPrivacyCleanupVerdict({ ownerId: owner.uid || null, choiceVerified, accountDeleted,
                count: read?.count ?? null, readError: Boolean(read?.error) });
            aliveReceipt(receipt, alive).row(j4a ? 'J4.a: cleanup removed the privacy choice' : 'J4.b: cleanup removed the privacy choice',
                gone.status, gone.detail, { reason: gone.reason });
        });
        await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, false));
        steps.report(receipt);
        receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
    });
    try {
        await suppressPageSnapshot(testInfo);
        // Before the first navigation (the signup below): the click recorder is an init script.
        await parity.attach(page.context());
        // J4.a: every coaching request from any tab of this context is aborted before it leaves the browser. Never removed
        // before the pages close, so a late request is stopped too.
        if (j4a) {
            await page.context().route(J4A_COACHING_ROUTE, (route) => coachingGuard.handler(route));
            coachingGuard.armed = true;
        }
        claimed = await prepareRunOwnedAccount(page, receipt, owner, `save-retry-${variant}`, admin, SERVICE_ROLE);
        if (!claimed) return;
        await page.goto('/practice');
        // #1835: saving is off until the owner opts in, and the app's default stays off. Both legs expect saved transcripts, so the
        // run's OWN account opts in through the Practice prompt (Save: Yes, Coaching: No) before anything else there. The row's
        // PASS belongs to the readback the gate takes immediately before each Start click (Sam, Nov 20, #1916); any other outcome,
        // a pre-#1835 build included, records the row and stops before that press.
        const gate: CaptureConsentGate = await (async () => {
            const migrationFiles = (() => { try { return readdirSync(resolvePath(process.cwd(), 'backend/supabase/migrations')); } catch { return null; } })();
            const client = admin as unknown as ChoiceClient;
            const record: ConsentRowRecorder = (status, detail, evidence) => receipt.row('practice privacy choice', status, detail, evidence);
            const consent = await settleFixedConsentOnPractice({ page, client, ownerId: owner.uid, migrationFiles, mode: SAVE_RETRY_CONSENT_MODE, record });
            // The prompt's choice is recorded and read back for this owner, so cleanup must prove its row gone, even if a Start
            // is later refused (a pre-#1835 build has no row to clean).
            choiceVerified = consent.build === 'includes_1835' && consent.choice !== null;
            return captureConsentGate({ consent, client, ownerId: owner.uid, mode: SAVE_RETRY_CONSENT_MODE, record });
        })();
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });

        // #1593 (Sam, #1662 RETURN control 3): the injected save failure is expected only for THIS take, until Retry Save.
        watch.setFaultPhase(true);
        await page.route(COMPLETION_RPC, async (route: Route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            drop.completionPosts += 1;
            completions.track(route.request(), drop.completionPosts);
            const attempt = parseCompletionAttempt(drop.completionPosts, route.request().postDataBuffer(), retryMarked, !drop.dropped);
            attempts.push(attempt);
            attemptByRequest.set(route.request(), attempt);
            if (drop.dropped) return route.fallback();
            drop.dropped = true;
            drop.droppedSessionId = attempt.sessionId;
            completions.markDropped(route.request());
            if (variant === 'request-lost') return route.abort('failed');
            // Response lost: the request reaches the real server and commits; the page never sees the answer.
            drop.forwarded = true;
            const response = await route.fetch();
            drop.droppedStatus = response.status();
            return route.abort('failed');
        });

        await selectBenchmarkMode(page, 'private');
        // The faulted take's Start: the cold model helper reads consent back at its own Download click; when it did not record,
        // the ordinary Start reads it back at its click. The confirmed capture records the privacy row PASS.
        const setup = await preparePrivateModelIfPrompted(page, 900_000, { beforeClick: () => gate.confirm() });
        if (!setup.recordingAlreadyStarted) {
            await waitForPrivateEngineReady(page, 600_000);
            await startBenchmarkRecording(page, `save-retry-${variant}-1`, undefined, { beforeClick: () => gate.confirm() });
        }
        gate.recordPass();
        await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
        // The Start session, read while it is still active (durable-save-oracle `validateBaseline`): its id, key and lease bind
        // the exact retry-saved-once check. A fresh account has exactly one active row here; anything else leaves it unknown.
        const activeRows = await readSavedRows(owner.uid, true);
        const takeRowBefore = activeRows?.length === 1 ? activeRows[0] : null;
        await stopBenchmarkRecording(page, `save-retry-${variant}-1`, 180_000);

        // The truthful recovery state, read before any retry.
        const banner = page.getByTestId('session-unresolved-recovery');
        const bannerShown = await banner.waitFor({ timeout: 180_000 }).then(() => true).catch(() => false);
        const message = bannerShown ? await page.getByTestId('session-unresolved-message').innerText().catch(() => '') : '';
        const resolution = bannerShown ? await banner.getAttribute('data-resolution') : null;
        const retryOffered = await page.getByTestId('session-retry-save').count() > 0;
        const discardOfferedBeforeRetry = await page.getByTestId('session-discard').count() > 0;
        const wordsOnPage = await transcriptOnPageLength(page);
        const rowsBeforeRetry = await readSessionRows(owner.uid);
        const completedBeforeRetry = rowsBeforeRetry.filter((r) => r.status === 'completed').length;
        const dropDisposition = completionDropDisposition(variant, drop, rowsBeforeRetry);
        receipt.row('completion request altered once', dropDisposition.status, dropDisposition.detail,
            { completionPosts: drop.completionPosts, droppedStatus: drop.droppedStatus, rowsBeforeRetry: rowsBeforeRetry.length,
                completedBeforeRetry,
                completionOutcomes: await completions.evidence() });
        // J4.a evidence check (request lost only; J4.b keeps its own verdicts): the stopped request left the server's copy of the
        // take exactly as Start made it.
        if (j4a) {
            const neverReached = j4aRequestNeverReachedVerdict({ dropped: drop.dropped, forwarded: drop.forwarded, droppedStatus: drop.droppedStatus,
                droppedSessionId: drop.droppedSessionId, startRow: takeRowBefore, rowsBeforeRetry: await readSavedRows(owner.uid) });
            receipt.row('J4.a: the first save request never reached the server', neverReached.status, neverReached.detail,
                { reason: neverReached.reason, forwarded: drop.forwarded, droppedStatus: drop.droppedStatus, startRowRead: takeRowBefore !== null });
        }
        const bannerVerdict = recoveryBannerVerdict({ bannerShown, resolution, message, retryOffered, wordsOnPage, completedBeforeRetry });
        receipt.row('recovery banner is truthful', bannerVerdict.status, bannerVerdict.detail,
            { bannerShown, resolution, retryOffered, wordsOnPageLength: wordsOnPage, discardOfferedBeforeRetry,
                messageLength: message.length });
        if (!bannerShown || !retryOffered) throw new Error('the recovery banner with Retry Save was not shown');

        // Codex P2 on f527a033: the injected failure was the FIRST save; Retry Save and everything after it are strict, so a
        // retry that fails again trips the watchdog instead of being excused as the injection.
        watch.setFaultPhase(false);
        retryMarked = true;
        await page.getByTestId('session-retry-save').click();
        const resolved = await banner.waitFor({ state: 'detached', timeout: 120_000 }).then(() => true).catch(() => false);
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 60_000 }).catch(() => undefined);
        const savedId = await persistedId(page);
        if (savedId) takes.push(savedId);
        const discardAfter = await page.getByTestId('session-discard').count() > 0;
        receipt.row('no Discard after the save resolves', resolved && !discardAfter ? 'PASS' : 'FAIL',
            resolved && !discardAfter ? 'Retry Save resolved the take and no Discard is offered for the saved transcript'
                : !resolved ? 'the recovery banner stayed after Retry Save' : 'Discard is still offered after the save resolved',
            { resolved, discardAfter });

        const rowsAfterRetry = await readSessionRows(owner.uid);
        const saved = savedTakeReadbackVerdict(rowsAfterRetry, savedId);
        receipt.row('Retry Save leaves one saved session', saved.status, saved.detail,
            { rows: rowsAfterRetry.length, completed: rowsAfterRetry.filter((r) => r.status === 'completed').length,
                persistedIdBound: savedId !== null, completionPosts: drop.completionPosts, completionOutcomes: await completions.evidence() });
        // Harness `retry-saved-once` (durable-save-oracle compareSavedRows): the one row is the Start session with the exact payload.
        const exact = exactRetrySaveVerdict(attempts.find((a) => a.dropped)?.body ?? null, takeRowBefore, (await readSavedRows(owner.uid)) ?? [], savedId);
        receipt.row('Retry Save saved the exact payload once', exact.status, exact.detail,
            { startRowRead: takeRowBefore !== null, persistedIdBound: savedId !== null });
        if (j4a) {
            const ownerRows = await readSavedRows(owner.uid);
            const startIdempotencyKey = takeRowBefore?.idempotency_key;
            const anyAccount = drop.droppedSessionId ? await readTakeRowsAnyAccount(drop.droppedSessionId, startIdempotencyKey) : null;
            const oneSave = j4aOneSaveForAccountVerdict({ ownerId: owner.uid || null, takeSessionId: drop.droppedSessionId, startIdempotencyKey,
                savedId, ownerRows, anyAccountById: anyAccount?.byId ?? null, anyAccountByKey: anyAccount?.byKey ?? null });
            receipt.row('J4.a: Retry Save saved one take for this account only', oneSave.status, oneSave.detail,
                { reason: oneSave.reason, ownerRows: ownerRows?.length ?? null, anyAccountById: anyAccount?.byId.length ?? null,
                    anyAccountByKey: anyAccount?.byKey.length ?? null, startKeyRead: typeof startIdempotencyKey === 'string' });
            // J4.a stops here, right after the exact Retry readback: no second take, no Analytics reopen (Sam, Nov 19).
            return;
        }

        // The next Start, from the completed review's own repeat action, saves only itself.
        // J4.b's second Start press reads consent back at its click too (pin, pause, re-check, readback, click).
        await pressCaptureControl(page, ['verdict-practice-again'], { waitMs: 120_000, beforeClick: () => gate.confirm() });
        gate.recordPass();
        await expectBenchmarkRecordingStarted(page, `save-retry-${variant}-2`);
        await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
        await stopBenchmarkRecording(page, `save-retry-${variant}-2`, 180_000);
        // Wait for take 2's OWN saved identity — not merely "not take 1's", which the start-of-take clear satisfies at once.
        await expect.poll(async () => nextTakeIdArrived(await persistedId(page), savedId), { timeout: 180_000 }).toBe(true);
        const nextId = await persistedId(page);
        if (nextId) takes.push(nextId);
        const rowsAfterNext = await readSessionRows(owner.uid);
        const next = nextTakeRetentionVerdict(rowsAfterNext, savedId, nextId);
        // Codex r4295679570: the next take's own completion call is tracked too — snapshot again so it is never omitted.
        receipt.row('next take saves only itself', next.status, next.detail,
            { rows: rowsAfterNext.length, completed: rowsAfterNext.filter((r) => r.status === 'completed').length,
                completionOutcomes: await completions.evidence() });

        // Harness `review-reopen` (runner L370 → saveReopen): the next take reopened from Analytics shows its saved transcript.
        const nextRows = nextId ? await readSavedRows(owner.uid) : null;
        const nextTranscript = nextRows?.find((r) => r.id === nextId)?.transcript;
        const savedDigest = typeof nextTranscript === 'string' ? transcriptDigest(nextTranscript) : null;
        const reopened = nextId && savedDigest ? await reopenFromAnalytics(page, nextId) : { opened: false, before: null, after: null };
        const reopen = reviewReopenVerdict(savedDigest, reopened.opened, reopened.before, reopened.after);
        receipt.row('review reopens the saved take', reopen.status, reopen.detail,
            { opened: reopened.opened, beforeMatches: reopened.before === savedDigest, afterMatches: reopened.after === savedDigest });

    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        await finish();
    }
}

test.describe('RWT — Retry Save and recovery @live', () => {
    test.afterEach(async () => {
        await finalizer.drain();
    });

    test('request lost: the completion never reaches the server; Retry Save saves the take once', async ({ page }, testInfo) => {
        test.setTimeout(1_800_000);
        await runVariant(page, testInfo, 'request-lost');
    });

    test('response lost: the server saved but the page was not told; Retry Save does not save it twice', async ({ page }, testInfo) => {
        test.setTimeout(1_800_000);
        await runVariant(page, testInfo, 'response-lost');
    });
});
