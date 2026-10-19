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
import { FINALIZE_CLEANUP_MS, FINALIZE_SETTLE_MS, FinalizationSteps, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
import { openProductsItem } from './helpers/productsMenu';
import {
    expectBenchmarkRecordingStarted, preparePrivateModelIfPrompted, selectBenchmarkMode, startBenchmarkRecording,
    stopBenchmarkRecording, waitForPrivateEngineReady,
} from './helpers/benchmark-utils';
import {
    CompletionObserver, SAVE_RETRY_SUITE, type SaveRetryVariant, type SessionRowFacts, completionDropDisposition,
    nextTakeIdArrived, nextTakeRetentionVerdict, recoveryBannerVerdict, savedTakeReadbackVerdict,
} from './helpers/rwtSaveRetry';

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

const persistedId = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();

async function runVariant(page: Page, testInfo: TestInfo, variant: SaveRetryVariant): Promise<void> {
    const suite = `${SAVE_RETRY_SUITE}-${variant}`;
    const receipt = new RwtReceipt(`${SAVE_RETRY_SUITE}-${variant}`);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    tap.attach(page); generations.attach(page);
    const owner: RunOwner = { email: '', uid: '' };
    // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the 30-minute timeout.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(suite), label: suite });
    const takes: string[] = [];
    let claimed = false;
    let accountDeleted = false;
    // The ONE altered request. Every other completion request, including Retry Save's replay, reaches the server untouched.
    const drop = { completionPosts: 0, droppedStatus: null as number | null, dropped: false };
    // #1258 C — every non-dropped completion call's answer, read from the browser's own events by request identity.
    const completions = new CompletionObserver<Request>();
    page.on('response', (response) => {
        if (completions.isObserved(response.request())) completions.onResponse(response.request(), response.status(), response.text().catch(() => null));
    });
    page.on('requestfailed', (request) => completions.onFailed(request, request.failure()?.errorText));
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        await steps.step('watchdog', () => watch.record(receipt));
        await steps.step('completion route restore', () => page.unroute(COMPLETION_RPC));
        await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
        // Two saved takes: at most one coaching request each.
        await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 2, oneRequestPerSession: takes }));
        // A signup that died before its uid was read is still found by its created email.
        if ((owner.uid || owner.email) && !accountDeleted) {
            await steps.step('run-owned cleanup', async () => {
                try {
                    await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
                    accountDeleted = true;
                    receipt.row('run-owned cleanup', 'PASS', 'the run-owned account was deleted and residue checks passed');
                } catch {
                    receipt.row('run-owned cleanup', 'FAIL', 'run-owned account deletion or residue readback failed');
                }
            }, FINALIZE_CLEANUP_MS, { critical: true });
        }
        await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, false));
        steps.report(receipt);
        receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
    });
    try {
        await suppressPageSnapshot(testInfo);
        claimed = await prepareRunOwnedAccount(page, receipt, owner, `save-retry-${variant}`, admin, SERVICE_ROLE);
        if (!claimed) return;
        await page.goto('/practice');
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });

        // #1593 (Sam, #1662 RETURN control 3): the injected save failure is expected only for THIS take, until Retry Save.
        watch.setFaultPhase(true);
        await page.route(COMPLETION_RPC, async (route: Route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            drop.completionPosts += 1;
            completions.track(route.request(), drop.completionPosts);
            if (drop.dropped) return route.fallback();
            drop.dropped = true;
            completions.markDropped(route.request());
            if (variant === 'request-lost') return route.abort('failed');
            // Response lost: the request reaches the real server and commits; the page never sees the answer.
            const response = await route.fetch();
            drop.droppedStatus = response.status();
            return route.abort('failed');
        });

        await selectBenchmarkMode(page, 'private');
        const setup = await preparePrivateModelIfPrompted(page, 900_000);
        if (!setup.recordingAlreadyStarted) {
            await waitForPrivateEngineReady(page, 600_000);
            await startBenchmarkRecording(page, `save-retry-${variant}-1`);
        }
        await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
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
        const bannerVerdict = recoveryBannerVerdict({ bannerShown, resolution, message, retryOffered, wordsOnPage, completedBeforeRetry });
        receipt.row('recovery banner is truthful', bannerVerdict.status, bannerVerdict.detail,
            { bannerShown, resolution, retryOffered, wordsOnPageLength: wordsOnPage, discardOfferedBeforeRetry,
                messageLength: message.length });
        if (!bannerShown || !retryOffered) throw new Error('the recovery banner with Retry Save was not shown');

        // Codex P2 on f527a033: the injected failure was the FIRST save; Retry Save and everything after it are strict, so a
        // retry that fails again trips the watchdog instead of being excused as the injection.
        watch.setFaultPhase(false);
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

        // The next Start, from the completed review's own repeat action, saves only itself.
        const again = page.getByTestId('verdict-practice-again');
        await expect(again).toBeEnabled({ timeout: 120_000 });
        await again.click();
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
