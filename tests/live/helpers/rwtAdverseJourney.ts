/**
 * RWT R3 (row 17): the adverse-state journey shared by `rwt-adverse-mic-model.live.spec.ts` (download fails, offline
 * mid-download) and `rwt-adverse-mic-denied.live.spec.ts` (mic denied). Moved verbatim from the former single spec: the
 * mic-denied variant needs its own file-level `launchOptions` (`=deny`), which Playwright refuses inside a describe group.
 */
import { createClient } from '@supabase/supabase-js';
import { chromium, type Browser, type Page, type TestInfo } from '@playwright/test';
import { routeVercelBypass } from './deployedLiveTest';
import { applyRwtIdentity, rwtIdentityFor } from './rwtBrowserIdentity';
import { expect } from './rwtProductionTest';
import { cleanupRunOwnedAccount } from './runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RwtReceipt, installMicAcquisitionCounter, loadRwtFixture, micAcquisitionLog, rwtLaunchArgs,
    suppressPageSnapshot, telemetryClassRows,
} from './rwtJourney';
import { type RunOwner, prepareRunOwnedAccount } from './rwtDisposableAccount';
import { isRecording, observeCloudStt, persistedId, tabState } from './rwtPageState';
import { bindReadbackJourneys } from './rwtOracles';
import { CoachingGenerationTap } from './coachingGenerationTap';
import { coachingRequestBudgetRow } from './rwtCoachingCollector';
import { openProductsItem } from './productsMenu';
import { selectBenchmarkMode, stopBenchmarkRecording } from './benchmark-utils';
import { noCloudVerdict } from './rwtAbandonTakeover';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, aliveReceipt, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './rwtWatchdog';
import { HarnessParityTap, type StartPressBudget } from './rwtHarnessParity';
import {
    ADVERSE_SUITE, type AdverseVariant, MIC_BLOCKED_COPY, MODEL_ASSETS, MODEL_FAILED_STATES, downloadFailureVerdict, armModelStatusLog, readModelStatusLog, AttemptFaultCounter,
    deniedAfterPress, micDeniedVerdict,
} from './rwtAdverse';
import type { SessionRowFacts } from './rwtSaveRetry';
import {
    AHT12_CATALOG_CASE_OPEN, AHT12_STAND_IN_LABEL, type ModelBytesRead, type RecoveryAttempt, type RecoveryControl, type ReopenObservation, RECOVERY_CONTROLS, isRecoveryControl,
    midDownloadFailureVerdict, modelBytesSeen, recoverySavedVerdict, retrySetupOutcome, reviewReopenVerdict, savedTranscriptDigest,
} from './rwtAdverseRecovery';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
export const fixture = loadRwtFixture('open_mic_tts');
const MODEL_PATH = /\/models\//;
/** The page's offered control settles within this bound once its model status is known (the harness's `primary` bound). */
const RECOVERY_OFFER_MS = 120_000;
/** Retry re-runs the Private setup, including the model download: the bound for that setup to publish `ready`. */
const RETRY_READY_MS = 600_000;
/** After `ready`, the rendered Start becomes enabled within this bound. */
const START_ENABLED_MS = 60_000;
/** A press that records (cold Download & start, or Start) reaches RECORDING within this bound (unchanged from before). */
const RECORDING_MS = 600_000;
/** AHT-14: the cold download shows its first received bytes within this bound (the former request-issued bound). */
const MODEL_BYTES_MS = 120_000;

/** The site's microphone permission, set the way a person's site setting sets it (Blocked / Allowed). */
async function setSiteMicrophone(page: Page, browser: Browser, setting: 'denied' | 'granted'): Promise<void> {
    const pageSession = await page.context().newCDPSession(page);
    const { targetInfo } = await pageSession.send('Target.getTargetInfo');
    await pageSession.detach();
    const browserSession = await browser.newBrowserCDPSession();
    try {
        await browserSession.send('Browser.setPermission', {
            // CDP `Browser.setPermission` takes a W3C PermissionDescriptor (`microphone`); `audioCapture` is the distinct
            // `Browser.grantPermissions` PermissionType, which Chrome rejects here (run 38876633963).
            permission: { name: 'microphone' }, setting, origin: new URL(page.url()).origin,
            browserContextId: targetInfo.browserContextId,
        });
    } finally {
        await browserSession.detach();
    }
}
const micPermissionState = (page: Page) => page.evaluate(async () =>
    (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state).catch(() => null);

/**
 * Sam's ACCEPT of PM 731eb5c0: the COMPLETE published model-status history (rwtAdverse `armModelStatusLog`), bound to the
 * page's document by a token. `observed` false (no log in this document) is a lost observation, never "never ready".
 */
const modelStatusToken = `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const modelStatuses = async (page: Page): Promise<{ observed: boolean; statuses: string[] }> => {
    const log = await page.evaluate(readModelStatusLog).catch(() => ({ token: null, statuses: [] as string[] }));
    return { observed: log.token === modelStatusToken, statuses: log.statuses };
};
const modelStatus = (page: Page) => page.locator('html').getAttribute('data-model-status');
const sttMode = (page: Page) => page.locator('html').getAttribute('data-stt-mode');
const failedState = (page: Page, timeout: number) => page.waitForFunction(
    (states: string[]) => states.includes(document.documentElement.getAttribute('data-model-status') ?? ''),
    [...MODEL_FAILED_STATES] as string[], { timeout }).then(() => true).catch(() => false);

/**
 * The control the page offers once its model status is settled (MicCard.tsx's own mapping: `download-required` → mic-download,
 * a failed setup → mic-retry, `ready`/`idle` → mic-start), visible. Read from the status, never by racing three locators, so a
 * control that is re-rendered under another id while the status resolves is never pressed. Null when none settles in time.
 */
async function offeredRecoveryControl(page: Page): Promise<RecoveryControl | null> {
    const handle = await page.waitForFunction(() => {
        const s = document.documentElement.getAttribute('data-model-status') ?? '';
        const id = s === 'download-required' ? 'mic-download' : (s === 'error' || s === 'init-failed') ? 'mic-retry'
            : (s === 'ready' || s === 'idle') ? 'mic-start' : null;
        const el = id ? document.querySelector(`[data-testid="${id}"]`) : null;
        return el && el.getClientRects().length > 0 ? id : false;
    }, undefined, { timeout: RECOVERY_OFFER_MS }).catch(() => null);
    if (!handle) return null;
    const id = await handle.jsonValue().catch(() => null);
    await handle.dispose().catch(() => undefined);
    return isRecoveryControl(id) ? id : null;
}

/**
 * AHT-14: the first moment the page shows RECEIVED model bytes mid-transfer — `mic-progress` 1–99 % while `loading` (the product's
 * own byte count; see `modelBytesSeen`) — or the state it settled in instead (ready / failed), or the last read at the bound.
 * Polled every 50 ms so the transfer is still running when the browser goes offline. Read in the page, so it does not depend on
 * whether the model worker's fetches reach Playwright's network events.
 */
async function waitForModelBytes(page: Page): Promise<ModelBytesRead | null> {
    const decided = await page.waitForFunction(() => {
        const status = document.documentElement.getAttribute('data-model-status');
        const pct = Number.parseInt(document.querySelector('[data-testid="mic-progress"]')?.textContent ?? '', 10);
        const midTransfer = status === 'loading' && Number.isFinite(pct) && pct >= 1 && pct < 100;
        return midTransfer || status === 'ready' || status === 'error' || status === 'init-failed'
            ? { pct: Number.isFinite(pct) ? pct : null, status } : false;
    }, undefined, { timeout: MODEL_BYTES_MS, polling: 50 }).then((h) => h.jsonValue(), () => null);
    if (decided) return decided;
    // The bound ended undecided: the last read, so the receipt says what the page showed when the browser went offline.
    return page.evaluate(() => {
        const pct = Number.parseInt(document.querySelector('[data-testid="mic-progress"]')?.textContent ?? '', 10);
        return { pct: Number.isFinite(pct) ? pct : null, status: document.documentElement.getAttribute('data-model-status') };
    }).catch(() => null);
}

/**
 * Retry's setup outcome from the complete model-status history published after the Retry press (`retrySetupOutcome`), polled
 * until it is decided or the bound ends. `statusesBefore` is the history's length at the press (null: not observed).
 */
async function waitForRetrySetup(page: Page, statusesBefore: number | null): Promise<RecoveryAttempt['retry']> {
    if (statusesBefore === null) return 'unobserved';
    const deadline = Date.now() + RETRY_READY_MS;
    for (;;) {
        const log = await modelStatuses(page);
        const outcome = retrySetupOutcome(log.observed ? log.statuses.slice(statusesBefore) : null);
        if (outcome !== 'pending' || Date.now() >= deadline) return outcome;
        await page.waitForTimeout(500);
    }
}

/**
 * The recovery's Start presses, by design (each one is counted in START_PRESS_BUDGET below). The page's offered control must be
 * the variant's designed one (`RECOVERY_CONTROLS`); otherwise nothing is pressed and the verdict decides.
 *  - AHT-12 (fresh allowing browser): ONE press of the offered cold `mic-download` (download, then recording) or `mic-start`.
 *  - AHT-13/14 (the failed page): `mic-retry`, then WAIT for the model to publish `ready` (Retry only re-runs setup and never
 *    records — MicCard.tsx), then ONE press of `mic-start`. A Retry that fails again, or never reaches ready, presses nothing more.
 */
async function pressRecovery(page: Page, variant: AdverseVariant): Promise<RecoveryAttempt> {
    const attempt: RecoveryAttempt = { offered: await offeredRecoveryControl(page), retry: 'not-pressed', startEnabled: null, recorded: false };
    if (attempt.offered === null || !RECOVERY_CONTROLS[variant].includes(attempt.offered)) return attempt;
    if (attempt.offered === 'mic-retry') {
        const before = await modelStatuses(page);
        await page.getByTestId('mic-retry').click();
        attempt.retry = await waitForRetrySetup(page, before.observed ? before.statuses.length : null);
        if (attempt.retry !== 'ready') return attempt;
        const start = page.getByTestId('mic-start');
        attempt.startEnabled = await expect(start).toBeEnabled({ timeout: START_ENABLED_MS }).then(() => true, () => false);
        if (!attempt.startEnabled) return attempt;
        await start.click();
        attempt.recorded = await isRecording(page, RECORDING_MS);
        return attempt;
    }
    const control = page.getByTestId(attempt.offered);
    if (!(await expect(control).toBeEnabled({ timeout: RECORDING_MS }).then(() => true, () => false))) return attempt;
    await control.click();
    attempt.recorded = await isRecording(page, RECORDING_MS);
    return attempt;
}

/** The run-owned account's session ids before the journey's first press (the harness's per-case baseline). */
async function readSessionIds(uid: string): Promise<string[]> {
    const { data, error } = await admin!.from('sessions').select('id').eq('user_id', uid);
    if (error || !Array.isArray(data)) throw new Error(`session baseline read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    return data.map((row) => String(row.id));
}

/**
 * The account's rows written since the baseline, as content-free facts, and the saved transcript's trimmed SHA-256 per row. The
 * transcript text is read here and digested at once; only states, lengths and digests leave this function.
 */
async function readNewTakeRows(uid: string, baseline: readonly string[]): Promise<{ rows: SessionRowFacts[]; digests: Map<string, string | null> }> {
    const { data, error } = await admin!.from('sessions')
        .select('id,status,idempotency_key,transcript_state,transcript,created_at').eq('user_id', uid).order('created_at');
    if (error || !Array.isArray(data)) throw new Error(`session row read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    const fresh = data.filter((row) => !baseline.includes(String(row.id)));
    const digests = new Map(fresh.map((row) => [String(row.id), savedTranscriptDigest(row)] as const));
    const rows = fresh.map((row) => ({
        id: String(row.id),
        status: typeof row.status === 'string' ? row.status : null,
        hasIdempotencyKey: typeof row.idempotency_key === 'string' && row.idempotency_key.length > 0,
        transcriptState: typeof row.transcript_state === 'string' ? row.transcript_state : null,
        transcriptLength: typeof row.transcript === 'string' ? row.transcript.length : 0,
    }));
    return { rows, digests };
}

/**
 * The recovery take, judged at the harness's `ownSaved` bar (`recoverySavedVerdict`): the designed presses, a recording, and
 * exactly one new row for the take — the page-bound id, completed, idempotency key, transcript available and non-empty.
 */
async function saveRecoveredTake(page: Page, variant: AdverseVariant, preconditionEstablished: boolean,
    owner: { uid: string; baseline: readonly string[] }, label: string, takes: string[]) {
    const attempt = await pressRecovery(page, variant);
    let savedId: string | null = null;
    let read: Awaited<ReturnType<typeof readNewTakeRows>> = { rows: [], digests: new Map() };
    if (attempt.recorded) {
        await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
        await stopBenchmarkRecording(page, label, 180_000);
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
        savedId = await persistedId(page);
        if (savedId) takes.push(savedId);
        read = await readNewTakeRows(owner.uid, owner.baseline);
    }
    const verdict = recoverySavedVerdict({ variant, preconditionEstablished, attempt, savedId, rows: read.rows });
    const evidence = {
        recoveryControl: attempt.offered, retrySetup: attempt.retry, startEnabled: attempt.startEnabled, recorded: attempt.recorded,
        newSessionRows: read.rows.length,
    };
    return { verdict, evidence, savedId, savedDigest: savedId ? read.digests.get(savedId) ?? null : null };
}

/**
 * SHA-256 of the rendered `session-detail-transcript`'s trimmed text, computed IN THE PAGE (the harness's `fingerprint`): only the
 * digest leaves the browser. Null when the element is unreadable.
 */
const detailTranscriptDigest = (page: Page): Promise<string | null> => page.getByTestId('session-detail-transcript').evaluate(async (el) => {
    const bytes = new TextEncoder().encode((el as HTMLElement).innerText.trim());
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
}, undefined, { timeout: 15_000 }).catch(() => null);

/**
 * review-reopen, as the harness does it (browser-actions.cjs `reopen`): open `/analytics`, open THIS take through its own
 * `open-session-detail-<id>` control, digest the detail's transcript, reload, digest again. Case-local: rwtJourney.ts's
 * `analyticsThroughActions` starts from the post-save action and digests untrimmed text, so it is not reused here.
 */
async function reopenSavedTake(page: Page, sessionId: string): Promise<ReopenObservation> {
    const seen: ReopenObservation = { listed: false, detailShown: false, before: null, reloadShown: false, after: null };
    const detail = page.getByTestId('session-detail-transcript');
    await page.goto('/analytics', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const open = page.getByTestId(`open-session-detail-${sessionId}`).or(page.getByTestId(`open-session-detail-mobile-${sessionId}`)).first();
    seen.listed = await open.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false);
    if (!seen.listed) return seen;
    await open.click();
    seen.detailShown = await detail.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false);
    if (seen.detailShown) seen.before = await detailTranscriptDigest(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    seen.reloadShown = await detail.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false);
    if (seen.reloadShown) seen.after = await detailTranscriptDigest(page);
    return seen;
}

/** The review-reopen row for the recovery take; HOLD without navigating when there is no saved take or saved transcript. */
async function reopenRow(receipt: RwtReceipt, page: Page, recovered: { savedId: string | null; savedDigest: string | null }): Promise<void> {
    const seen = recovered.savedId && recovered.savedDigest
        ? await reopenSavedTake(page, recovered.savedId)
        : { listed: false, detailShown: false, before: null, reloadShown: false, after: null };
    const verdict = reviewReopenVerdict({ ...seen, savedId: recovered.savedId, savedDigest: recovered.savedDigest });
    receipt.row('the recovered take reopens from Analytics', verdict.status, verdict.detail, {
        listed: seen.listed, detailShown: seen.detailShown, reloadShown: seen.reloadShown,
        reopenedMatchesSaved: seen.before !== null && seen.before === recovered.savedDigest,
        reloadedMatchesSaved: seen.after !== null && seen.after === recovered.savedDigest,
    });
}

/**
 * Harness parity (PO route 2026-11-10), from the journey's DESIGN (not a run's count). Start presses are counted by control
 * test id (mic-start, mic-download, mic-retry, verdict-practice-again). Every variant presses once to meet its adverse state;
 * the recovery (`pressRecovery`) then presses only its variant's designed control (`RECOVERY_CONTROLS`), never in a loop, and
 * presses nothing when the page offers anything else. Each press, by its line:
 *  AHT-12 mic denied — at most 2:
 *   1. the denied press, `mic-download` or `mic-start` (whichever is offered): `await control.click()` (rwtAdverseJourney.ts:381);
 *   2. the allowing browser's ONE recovery press of its offered `mic-download` (cold: download, then recording) or `mic-start`:
 *      `await control.click()` (rwtAdverseJourney.ts:169). No Retry: a `mic-retry` offer there is a FAIL, not pressed.
 *   So `mic-download` and `mic-start` may each take both presses; `mic-retry` none. The catalog's minimumStarts 3 assumes
 *   the harness's same-context Allow → Start route, which this two-browser design does not take (a `=deny` browser never
 *   grants; see the mic-denied branch).
 *  AHT-13 download fails — exactly 3:
 *   1. `mic-download` with the model route aborted (rwtAdverseJourney.ts:439);
 *   2. `mic-retry` once the cause is removed (rwtAdverseJourney.ts:157);
 *   3. `mic-start` only after Retry's setup published `ready` (rwtAdverseJourney.ts:163).
 *  AHT-14 offline mid-download — exactly 3: `mic-download` (rwtAdverseJourney.ts:444), then the same `mic-retry` and
 *   `mic-start` as AHT-13 (rwtAdverseJourney.ts:157, :163).
 */
const AHT12_START_PRESS_BUDGET: StartPressBudget = { total: 2, perControl: { 'mic-download': 2, 'mic-start': 2 } };
const AHT13_START_PRESS_BUDGET: StartPressBudget = { total: 3, perControl: { 'mic-download': 1, 'mic-retry': 1, 'mic-start': 1 } };
const AHT14_START_PRESS_BUDGET: StartPressBudget = { total: 3, perControl: { 'mic-download': 1, 'mic-retry': 1, 'mic-start': 1 } };
const START_PRESS_BUDGET: Record<AdverseVariant, StartPressBudget> = {
    'mic-denied': AHT12_START_PRESS_BUDGET, 'download-fails': AHT13_START_PRESS_BUDGET, 'offline-mid-download': AHT14_START_PRESS_BUDGET,
};
/** The page-close step's own bound: each page close is itself bounded at 15 s inside it. */
const PARITY_CLOSE_STEP_MS = 60_000;

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
export const finalizer = new JourneyFinalizer();

export async function runVariant(page: Page, browser: Browser, testInfo: TestInfo, variant: AdverseVariant): Promise<void> {
    const suite = `${ADVERSE_SUITE}-${variant}`;
    const receipt = new RwtReceipt(`${ADVERSE_SUITE}-${variant}`);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    const cloud = { requests: 0 };
    tap.attach(page); generations.attach(page); observeCloudStt(page, cloud);
    // Harness parity: Cloud STT (HTTP and WebSocket) and Start presses on every page of BOTH browser contexts the journey opens.
    const parity = new HarnessParityTap();
    const owner: RunOwner = { email: '', uid: '' };
    const takes: string[] = [];
    let claimed = false;
    const context = page.context();
    // Mic-denied only: the browser in which the person allows the microphone (see below).
    let recoveryBrowser: Browser | null = null;
    // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the 30-minute timeout.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(suite), label: suite, contexts: () => recoveryBrowser?.contexts() ?? [] });
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
        // (bounded; page-independent, since a finalizer may run after its tabs closed).
        await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
        await steps.step('watchdog', () => watch.record(receipt));
        await steps.step('recovery browser close', () => recoveryBrowser?.close());
        await steps.step('offline restore', () => context.setOffline(false));
        await steps.step('model route restore', () => context.unroute(MODEL_ASSETS));
        await steps.step('no cloud row', () => {
            const cloudVerdict = noCloudVerdict(cloud.requests);
            receipt.row('no Cloud STT request', cloudVerdict.status, cloudVerdict.detail, { cloudRequests: cloud.requests });
        });
        await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
        await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 1, oneRequestPerSession: takes }));
        // Harness parity rows (catalog: no-cloud-stt, start-press-budget, owned-pages-closed), before the account is deleted. The
        // 'no Cloud STT request' row above counts only the journey's own pages; this one is the harness's context-wide definition.
        await steps.step('harness parity counts', (alive) => {
            parity.noCloudSttRow(aliveReceipt(receipt, alive));
            parity.startPressRow(aliveReceipt(receipt, alive), START_PRESS_BUDGET[variant]);
        });
        await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
        // A signup that died before its uid was read is still found by its created email.
        if (owner.uid || owner.email) {
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion; its own settlement decides the row.
            await finalizeOwnedCleanup(steps, receipt, new OwnedCleanup(
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX })));
        }
        await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, false));
        steps.report(receipt);
        receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
    });
    try {
        // Before the first navigation (signup): the Start-press recorder runs in every later document of this context.
        await parity.attach(context);
        await suppressPageSnapshot(testInfo);
        claimed = await prepareRunOwnedAccount(page, receipt, owner, `adverse-${variant}`, admin, SERVICE_ROLE);
        if (!claimed) return;
        // The harness's per-case baseline: rows already on the account before the first press are never the recovery take's.
        const accountRows = { uid: owner.uid, baseline: await readSessionIds(owner.uid) };
        // The acquisition boundary's own outcomes (grants and NotAllowedError) are observed from the first page load.
        await installMicAcquisitionCounter(page);
        await page.goto('/practice');
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });
        await selectBenchmarkMode(page, 'private');
        await page.evaluate(armModelStatusLog, modelStatusToken);

        if (variant === 'mic-denied') {
            await setSiteMicrophone(page, browser, 'denied');
            // Informational only (Sam, #1662 RETURN): the verdict is decided at the acquisition boundary below.
            const permissionQuery = await micPermissionState(page);
            const control = page.getByTestId('mic-download').or(page.getByTestId('mic-start')).filter({ visible: true }).first();
            // Live case 12: with the microphone denied, a RECORDING transition is the failure itself — stop there. Armed
            // whether or not the denial reads as applied: a recording here is never this scenario's truthful outcome.
            watch.setForbidRecording(true);
            // #1593 (Sam, #1662 RETURN control 3): the denial's own failed Start is expected only in this step.
            watch.setFaultPhase(true);
            // Sam, #1662 RETURN: only THIS press's acquisition outcome counts — an earlier rejection on the page cannot
            // qualify a later Start that failed for another reason.
            const acquisitionsBeforePress = (await micAcquisitionLog(page)).length;
            await control.click();
            // The model downloads first on a fresh account; the blocked microphone is met at the recording boundary.
            const blockedCopyShown = await page.getByText(MIC_BLOCKED_COPY).first().waitFor({ timeout: 900_000 }).then(() => true).catch(() => false);
            await page.waitForTimeout(2_000);
            const state = await tabState(page);
            const acquisitions = await micAcquisitionLog(page);
            const deniedAtAcquisition = deniedAfterPress(acquisitions, acquisitionsBeforePress);
            const rejections = acquisitions.filter((a) => a.id >= acquisitionsBeforePress && a.outcome !== 'granted' && a.outcome !== 'pending');
            const denied = micDeniedVerdict({ deniedAtAcquisition, blockedCopyShown, tab: state });
            receipt.row('blocked microphone is stated truthfully', denied.status, denied.detail,
                { deniedAtAcquisition, acquisitionRejections: rejections.length, permissionQuery, blockedCopyShown, ...state, mode: await sttMode(page) });
            watch.setForbidRecording(false);
            watch.setFaultPhase(false);
            // #1593 (local probe, 2026-10-18): only `--use-fake-ui-for-media-stream=deny` makes the browser answer a
            // truthful NotAllowedError, and that browser can never grant afterwards. Allowing the microphone is therefore
            // what a person does next: the same account, in a browser that allows it (the harness's ordinary launch).
            recoveryBrowser = await chromium.launch({ args: rwtLaunchArgs(fixture, { webgpu: false }) });
            const baseURL = new URL(page.url()).origin;
            const allowed = await recoveryBrowser.newContext({ baseURL, permissions: ['microphone'] });
            await parity.attach(allowed);
            await routeVercelBypass(allowed, baseURL);
            const allowedPage = await allowed.newPage();
            await applyRwtIdentity(allowed, allowedPage, await rwtIdentityFor(recoveryBrowser));
            tap.attach(allowedPage); generations.attach(allowedPage); observeCloudStt(allowedPage, cloud);
            watch.setPage(allowedPage);
            if (!owner.signInOn) throw new Error('the run-owned account cannot sign in on another browser');
            await owner.signInOn(allowedPage);
            await allowedPage.goto('/practice');
            await openProductsItem(allowedPage, 'open-mic');
            await allowedPage.waitForURL(/\/session/, { timeout: 45_000 });
            await selectBenchmarkMode(allowedPage, 'private');
            // The recovery runs whatever the denial row read: the allowing browser's own cold Start is the case either way.
            const recovered = await saveRecoveredTake(allowedPage, variant, true, accountRows, `adverse-${variant}`, takes);
            // Sam, #1662 RETURN and 2026-11-11: a FRESH-BROWSER STAND-IN. It proves recovery for the SAME ACCOUNT in a fresh,
            // allowing browser, not Allow→Retry in the originally denied page (a `=deny` browser cannot grant). The catalog's
            // full three-press, same-context case stays open as a separate requirement (AHT12_CATALOG_CASE_OPEN).
            receipt.row('after allowing the microphone a take saves', recovered.verdict.status,
                `${recovered.verdict.detail} (${AHT12_STAND_IN_LABEL})`,
                { recoveryScope: 'same_account_fresh_browser', standIn: true, catalogCaseOpen: AHT12_CATALOG_CASE_OPEN, ...recovered.evidence });
            await reopenRow(receipt, allowedPage, recovered);
        } else {
            // Sam's ACCEPT of PM 731eb5c0: only this download attempt's model-WEIGHT failures while the fault is armed count,
            // and the fault is armed BEFORE it is induced (a failure delivered during the awaited injection still counts).
            const fault = new AttemptFaultCounter<object>();
            context.on('request', (r) => fault.onRequest(r, r.url()));
            context.on('requestfailed', (r) => fault.onFailed(r));
            let injected = false;
            // AHT-14 only: what the page showed at the moment the browser went offline, and the network-level model responses
            // seen by then (a diagnostic only: the model worker's fetches may not reach Playwright's network events).
            let atOffline: ModelBytesRead | null = null;
            let modelResponsesBeforeOffline: number | null = null;
            if (variant === 'download-fails') {
                // Codex P1 r on f527a033: the phase opens BEFORE the fault is injected, so a failure the injection causes is
                // always captured inside it (events are judged by their own capture time).
                watch.setFaultPhase(true); // the injected model fault is expected only until the cause is removed
                fault.armFault();
                injected = await context.route(MODEL_ASSETS, (route) => route.abort('failed')).then(() => true, () => false);
                fault.startAttempt();
                await page.getByTestId('mic-download').click();
            } else {
                let modelResponses = 0;
                context.on('response', (r) => { if (MODEL_PATH.test(r.url())) modelResponses += 1; });
                fault.startAttempt();
                await page.getByTestId('mic-download').click();
                // "Mid-download" (review AHT-14): offline only once the page has RECEIVED model bytes, never merely when a request
                // is issued. If no bytes show within the bound it still goes offline, and the failure row is HOLD, never PASS.
                atOffline = await waitForModelBytes(page);
                modelResponsesBeforeOffline = modelResponses;
                watch.setFaultPhase(true); // opened before going offline: the offline transition itself fails the download
                fault.armFault();
                injected = await context.setOffline(true).then(() => true, () => false);
            }
            await failedState(page, 300_000);
            const history = await modelStatuses(page);
            const failureFacts = {
                exercised: injected && fault.failures > 0,
                observed: history.observed,
                statuses: history.statuses,
                finalStatus: await modelStatus(page),
                retryOffered: await page.getByTestId('mic-retry').isVisible().catch(() => false),
                mode: await sttMode(page),
            };
            const bytesSeenBeforeOffline = modelBytesSeen(atOffline);
            const failure = variant === 'offline-mid-download'
                ? midDownloadFailureVerdict({ ...failureFacts, bytesSeenBeforeOffline })
                : downloadFailureVerdict(failureFacts);
            const midDownload: Record<string, string | number | boolean | null> = variant === 'offline-mid-download'
                ? { bytesSeenBeforeOffline, progressAtOffline: atOffline?.pct ?? null, statusAtOffline: atOffline?.status ?? null, modelResponsesBeforeOffline }
                : {};
            receipt.row('model download failure is stated truthfully', failure.status, failure.detail,
                { faultInjected: injected, modelWeightFailuresAfterFault: fault.failures, statusesObserved: history.observed, statusChanges: history.statuses.length,
                    finalStatus: await modelStatus(page), mode: await sttMode(page), ...midDownload, ...(await tabState(page)) });
            // Remove the cause the way it ends for a person: the asset host answers again, or the network comes back.
            if (variant === 'download-fails') await context.unroute(MODEL_ASSETS);
            else await context.setOffline(false);
            fault.disarm();
            watch.setFaultPhase(false);
            // Retry is judged only after a failed download was stated with Retry; otherwise there is nothing to recover from.
            const recovered = await saveRecoveredTake(page, variant, failure.status === 'PASS', accountRows, `adverse-${variant}`, takes);
            const after = await modelStatuses(page);
            receipt.row('Retry downloads the model and a take saves', recovered.verdict.status, recovered.verdict.detail,
                { ...recovered.evidence, sawReadyAfterRetry: after.observed && after.statuses.includes('ready'), statusesObserved: after.observed,
                    mode: await sttMode(page) });
            await reopenRow(receipt, page, recovered);
        }
    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        await finish();
    }
}
