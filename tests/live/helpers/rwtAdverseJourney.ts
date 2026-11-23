/**
 * RWT R3 (row 17): the adverse-state journey shared by `rwt-adverse-mic-model.live.spec.ts` (download fails, offline
 * mid-download) and `rwt-adverse-mic-denied.live.spec.ts` (mic denied). Moved verbatim from the former single spec: the
 * mic-denied variant needs its own file-level `launchOptions` (`=deny`), which Playwright refuses inside a describe group.
 */
import { readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect } from './rwtProductionTest';
import { cleanupRunOwnedAccount } from './runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RwtReceipt, installMicAcquisitionCounter, loadRwtFixture, micAcquisitionLog,
    suppressPageSnapshot, telemetryClassRows,
} from './rwtJourney';
import { type RunOwner, prepareRunOwnedAccount } from './rwtDisposableAccount';
import {
    adverseConsentMode, captureConsentGate, settleFixedConsentOnPractice, type CaptureConsentGate, type ChoiceClient, type ConsentRowRecorder,
} from './rwtPracticeConsent';
import { isRecording, observeCloudStt, persistedId, tabState } from './rwtPageState';
import { bindReadbackJourneys } from './rwtOracles';
import { CoachingGenerationTap } from './coachingGenerationTap';
import { coachingRequestBudgetRow } from './rwtCoachingCollector';
import { openProductsItem } from './productsMenu';
import { pressCaptureControl, selectBenchmarkMode, stopBenchmarkRecording } from './benchmark-utils';
import { noCloudVerdict } from './rwtAbandonTakeover';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, aliveReceipt, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './rwtWatchdog';
import { HarnessParityTap, type StartPressBudget } from './rwtHarnessParity';
import {
    ADVERSE_SUITE, type AdverseVariant, MIC_BLOCKED_COPY, MODEL_ASSETS, MODEL_FAILED_STATES, downloadFailureVerdict, armModelStatusLog, readModelStatusLog, AttemptFaultCounter,
    armRuntimeStateLog, readRuntimeStateLog, ModelTransferTracker, BetweenFilesHold,
    deniedAfterPress, micDeniedVerdict,
    NO_TAKE_SAVED_ROW, SAME_PAGE_RECOVERY, SAME_PAGE_RECOVERY_REASON, type AccountSessionRead, noTakeSavedAfterDenialVerdict,
} from './rwtAdverse';
import type { SessionRowFacts } from './rwtSaveRetry';
import {
    type ModelBytesRead, type RecoveryAttempt, type RecoveryControl, type ReopenObservation, RECOVERY_CONTROLS, isRecoveryControl,
    type AttemptPhase, type BetweenFilesSnapshot, type ShownFailure, attemptPhase, coldTakeSettledVerdict, betweenFilesFailureVerdict,
    betweenFilesGate, faultUnprovenRecoveryVerdict, offlineNotExercisedVerdict, runBetweenFilesFault, shownFailureVerdict, unprovenRestoreVerdict,
    worstVerdict, NOT_SUPPORTED_WORDING, pollShownFailure, shownToastTexts,
    recoverySavedVerdict, retrySetupOutcome, reviewReopenVerdict, savedTranscriptDigest,
} from './rwtAdverseRecovery';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
export const fixture = loadRwtFixture('open_mic_tts');
/** The page's offered control settles within this bound once its model status is known (the harness's `primary` bound). */
const RECOVERY_OFFER_MS = 120_000;
/** Retry re-runs the Private setup, including the model download: the bound for that setup to publish `ready`. */
const RETRY_READY_MS = 600_000;
/** After `ready`, the rendered Start becomes enabled within this bound. */
const START_ENABLED_MS = 60_000;
/** A press that records (cold Download & start, or Start) reaches RECORDING within this bound (unchanged from before). */
const RECORDING_MS = 600_000;
/** J7.c: the next model file of the cold download is held within this bound (one file has finished, the next has started). */
const NEXT_FILE_MS = 300_000;
/** J7.c: the page states the failed setup (its toast included) within this bound, on the same failed attempt. */
const SHOWN_FAILURE_MS = 5_000;

/**
 * Blocks the site's microphone the way a person's site setting does. J7.a (PO and Sam, 2026-11-19): the journey only ever
 * blocks it, so this helper cannot allow it.
 */
async function blockSiteMicrophone(page: Page, browser: Browser): Promise<void> {
    const pageSession = await page.context().newCDPSession(page);
    const { targetInfo } = await pageSession.send('Target.getTargetInfo');
    await pageSession.detach();
    const browserSession = await browser.newBrowserCDPSession();
    try {
        await browserSession.send('Browser.setPermission', {
            // CDP `Browser.setPermission` takes a W3C PermissionDescriptor (`microphone`); `audioCapture` is the distinct
            // `Browser.grantPermissions` PermissionType, which Chrome rejects here (run 38876633963).
            permission: { name: 'microphone' }, setting: 'denied', origin: new URL(page.url()).origin,
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
/** The runtime-state log's document token (rwtAdverse `armRuntimeStateLog`), armed beside the model-status log. */
const runtimeStateToken = `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

/** One immediate read of the published runtime state, model status and byte percent. */
const readModelBytes = (page: Page): Promise<ModelBytesRead | null> => page.evaluate(() => {
    const pct = Number.parseInt(document.querySelector('[data-testid="mic-progress"]')?.textContent ?? '', 10);
    const root = document.documentElement;
    return { pct: Number.isFinite(pct) ? pct : null, status: root.getAttribute('data-model-status'), runtimeState: root.getAttribute('data-runtime-state') };
}).catch(() => null);

/** This attempt's phase, from the complete runtime-state log from the index read at its press (`attemptPhase`). */
const attemptPhaseOf = async (page: Page, fromIndex: number): Promise<AttemptPhase> => {
    const log = await page.evaluate(readRuntimeStateLog).catch(() => ({ token: null, states: [] as string[] }));
    return attemptPhase({ observed: log.token === runtimeStateToken, states: log.states }, fromIndex);
};

/**
 * J7.c (Sam, 2026-11-22): what the person sees on the failed attempt, read on that attempt, offline, before anything is pressed.
 * Read for the whole SHOWN_FAILURE_MS window (Sam, 2026-11-23: a late "not supported" toast is still read; only a read off the
 * attempt or showing "not supported" ends it early). Each read takes the mic card's text, the text of each toast actually shown
 * (`shownToastTexts`, never one queued at opacity 0) and Retry's state, bound to the attempt by its own log (still this attempt's
 * setup failure, in this document). `shownFailureVerdict` judges the read the poll returns; the telemetry code is never read.
 */
async function readShownFailure(page: Page, fromIndex: number): Promise<ShownFailure> {
    return pollShownFailure(async () => {
        const sameAttempt = (await attemptPhaseOf(page, fromIndex)) === 'setup-failed';
        const cardText = await page.getByTestId('mic-card').innerText({ timeout: 2_000 }).catch(() => null);
        const toastTexts = await page.locator('[data-sonner-toast]').evaluateAll(shownToastTexts).catch(() => null);
        const retry = page.getByTestId('mic-retry');
        const retryVisible = await retry.isVisible().catch(() => null);
        const retryEnabled = retryVisible ? await retry.isEnabled().catch(() => null) : false;
        // Re-bound after the reads: a log that moved on while they ran (a new setup, a recording) never binds them.
        const bound = sameAttempt && (await attemptPhaseOf(page, fromIndex)) === 'setup-failed';
        return { sameAttempt: bound, cardText, toastTexts, retryVisible, retryEnabled };
    }, { budgetMs: SHOWN_FAILURE_MS, sleep: (ms) => page.waitForTimeout(ms) });
}

/**
 * Sam, 2026-11-15 (run 43740031821; #1868 HOLD on f62e94c3): when no mid-download fault was exercised, the cold `Download & start
 * recording` press goes on to record. That take is stopped through the product's own Stop (the same bounded stop and persisted
 * wait as a recovery take; no Start press), so the account never keeps a recorded take with no saved row. Whether it recorded
 * comes from the attempt's COMPLETE log, never the current state: a take that recorded and then FAILED is recorded (and unsaved:
 * FAIL), and an unobserved attempt is unknown (FAIL). Only a setup failure bound to this attempt skips the wait for a recording.
 */
async function settleColdTake(page: Page, label: string, takes: string[], fromIndex: number): Promise<{ recorded: boolean | null; savedId: string | null }> {
    const phase = await attemptPhaseOf(page, fromIndex);
    if (phase === 'unobserved' || phase === 'unattributed-failure') return { recorded: null, savedId: null };
    // Only a setup failure bound to this attempt (FAILED from its own ENGINE_INITIALIZING, never READY) skips the wait.
    const recordingNow = phase !== 'setup-failed' && await isRecording(page, phase === 'recorded' ? 5_000 : RECORDING_MS);
    if (!recordingNow) {
        const final = await attemptPhaseOf(page, fromIndex);
        if (final === 'unobserved' || final === 'unattributed-failure') return { recorded: null, savedId: null };
        return { recorded: final === 'recorded', savedId: null };
    }
    const recorded = true;
    await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
    await stopBenchmarkRecording(page, label, 180_000);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
    const savedId = await persistedId(page);
    if (savedId) takes.push(savedId);
    return { recorded, savedId };
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
 *  - AHT-12: none. J7.a (PO and Sam, 2026-11-19) covers the denial only; the microphone is never allowed, nothing recovers.
 *  - AHT-13/14 (the failed page): `mic-retry`, then WAIT for the model to publish `ready` (Retry only re-runs setup and never
 *    records — MicCard.tsx), then ONE press of `mic-start`. A Retry that fails again, or never reaches ready, presses nothing more.
 * Each press reads consent back (`gate.confirm()`) inside the press, immediately before its click (Sam, #1916:
 * `pressCaptureControl`); a choice that no longer reads back stops it with nothing pressed.
 */
async function pressRecovery(page: Page, variant: AdverseVariant, gate: CaptureConsentGate): Promise<RecoveryAttempt> {
    const attempt: RecoveryAttempt = { offered: await offeredRecoveryControl(page), retry: 'not-pressed', startEnabled: null, recorded: false };
    if (attempt.offered === null || !RECOVERY_CONTROLS[variant].includes(attempt.offered)) return attempt;
    // Only AHT-13/14 recover, through Retry. Any other offer is never pressed: the verdict decides.
    if (attempt.offered !== 'mic-retry') return attempt;
    const before = await modelStatuses(page);
    await pressCaptureControl(page, ['mic-retry'], { beforeClick: () => gate.confirm() });
    attempt.retry = await waitForRetrySetup(page, before.observed ? before.statuses.length : null);
    if (attempt.retry !== 'ready') return attempt;
    const start = page.getByTestId('mic-start');
    attempt.startEnabled = await expect(start).toBeEnabled({ timeout: START_ENABLED_MS }).then(() => true, () => false);
    if (!attempt.startEnabled) return attempt;
    await pressCaptureControl(page, ['mic-start'], { beforeClick: () => gate.confirm() });
    attempt.recorded = await isRecording(page, RECORDING_MS);
    return attempt;
}

/** The run-owned account's session ids before the journey's first press (the harness's per-case baseline). */
async function readSessionIds(uid: string): Promise<string[]> {
    const { data, error } = await admin!.from('sessions').select('id').eq('user_id', uid);
    if (error || !Array.isArray(data)) throw new Error(`session baseline read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    return data.map((row) => String(row.id));
}

/** J7.a: after the blocked Start, the settle wait before the account is read the second time. */
const NO_TAKE_SETTLE_MS = 10_000;
/** J7.a: one re-read of the account's session ids, bound to that account; null (HOLD, never PASS) when the read fails. */
async function readAccountSessions(uid: string): Promise<AccountSessionRead | null> {
    return readSessionIds(uid).then((ids) => ({ uid, ids }), () => null);
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
    owner: { uid: string; baseline: readonly string[] }, label: string, takes: string[], gate: CaptureConsentGate) {
    const attempt = await pressRecovery(page, variant, gate);
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
 *  AHT-12 mic denied (J7.a, PO and Sam 2026-11-19) — exactly 1:
 *   1. the denied press, `mic-download` or `mic-start` (whichever is offered): `pressCaptureControl` (rwtAdverseJourney.ts:451).
 *   No recovery press: J7.a covers the denial only, and the microphone is never allowed. So either control may take the one
 *   press; `mic-retry` none. The catalog's minimumStarts 3 assumes the harness's same-context Allow → Start route, which J7.a
 *   records as UNTESTED.
 *  AHT-13 download fails — exactly 3:
 *   1. `mic-download` with the model route aborted (rwtAdverseJourney.ts:500);
 *   2. `mic-retry` once the cause is removed (rwtAdverseJourney.ts:212);
 *   3. `mic-start` only after Retry's setup published `ready` (rwtAdverseJourney.ts:218).
 *  AHT-14 offline between model files — exactly 3: `mic-download` (rwtAdverseJourney.ts:522), then the same `mic-retry` and
 *   `mic-start` as AHT-13 (rwtAdverseJourney.ts:212, :218).
 * #1835 (Sam, Nov 20; #1916): every press above runs `gate.confirm()` inside the press, immediately before its click
 * (`pressCaptureControl`), which reads this run's own saved privacy choice back from the server and stops the journey with
 * nothing pressed unless it is exactly the variant's fixed choice (`adverseConsentMode`: J7.a Save No; J7.b/c Save Yes, Coaching No).
 */
const AHT12_START_PRESS_BUDGET: StartPressBudget = { total: 1, perControl: { 'mic-download': 1, 'mic-start': 1 } };
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
    // J7.c option B: the next model file of the cold download, held at its start until the browser is offline (offline variant only).
    const hold = new BetweenFilesHold<object>();
    // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the 30-minute timeout.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(suite), label: suite });
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
        // (bounded; page-independent, since a finalizer may run after its tabs closed).
        await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
        await steps.step('watchdog', () => watch.record(receipt));
        await steps.step('offline restore', () => context.setOffline(false));
        await steps.step('held model file release', () => hold.releaseAll());
        await steps.step('model route restore', () => context.unroute(MODEL_ASSETS));
        await steps.step('no cloud row', () => {
            const cloudVerdict = noCloudVerdict(cloud.requests);
            receipt.row('no Cloud STT request', cloudVerdict.status, cloudVerdict.detail, { cloudRequests: cloud.requests });
        });
        await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
        await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: variant === 'mic-denied' ? 0 : 1, oneRequestPerSession: takes }));
        // Harness parity rows (catalog: no-cloud-stt, start-press-budget, owned-pages-closed), before the account is deleted. The
        // 'no Cloud STT request' row above counts only the journey's own pages; this one is the harness's context-wide definition.
        await steps.step('harness parity counts', (alive) => {
            parity.noCloudSttRow(aliveReceipt(receipt, alive));
            parity.startPressRow(aliveReceipt(receipt, alive), START_PRESS_BUDGET[variant]);
        });
        await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
        // A signup that died before its uid was read is still found by its created email.
        if (owner.uid || owner.email) {
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion; its own settlement decides the row. Writers: the journey's pages.
            await finalizeOwnedCleanup(steps, receipt, new OwnedCleanup(
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX, stoppedTakes: { writersClosedAt: () => parity.ownedPagesClosedAt, unsettledSaves: () => parity.unsettledSaves } })));
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
        // #1835 (Sam, 2026-11-19): a fresh owner is asked its privacy choice on the first Practice visit. Only THIS run's
        // disposable account answers it, with the variant's FIXED choice, before any press; the product default is untouched.
        // J7.a (denial only, no take) chooses Save: No; J7.b/c (a recovered take judged by its saved transcript) choose Save: Yes,
        // so a Save No read back before their first press stops them (Sam, Nov 20). #1910's shared helpers do it: a pre-#1835
        // build, an unknown build, or a choice that is not recorded stops here on Practice with the required row as FAIL or HOLD.
        // The row's PASS belongs to the readback `gate.confirm()` takes inside each Start-control press below, immediately before
        // its click, so no press happens without a verified choice.
        const migrationFiles = (() => { try { return readdirSync(resolvePath(process.cwd(), 'backend/supabase/migrations')); } catch { return null; } })();
        const client = admin as unknown as ChoiceClient;
        const record: ConsentRowRecorder = (status, detail, evidence) => receipt.row('practice privacy choice', status, detail, evidence);
        const consentMode = adverseConsentMode(variant);
        const consent = await settleFixedConsentOnPractice({ page, client, ownerId: owner.uid, migrationFiles, mode: consentMode, record });
        const gate = captureConsentGate({ consent, client, ownerId: owner.uid, mode: consentMode, record });
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });
        await selectBenchmarkMode(page, 'private');
        await page.evaluate(armModelStatusLog, modelStatusToken);
        await page.evaluate(armRuntimeStateLog, runtimeStateToken);

        if (variant === 'mic-denied') {
            await blockSiteMicrophone(page, browser);
            // Informational only (Sam, #1662 RETURN): the verdict is decided at the acquisition boundary below.
            const permissionQuery = await micPermissionState(page);
            // Live case 12: with the microphone denied, a RECORDING transition is the failure itself — stop there. Armed
            // whether or not the denial reads as applied: a recording here is never this scenario's truthful outcome.
            watch.setForbidRecording(true);
            // #1593 (Sam, #1662 RETURN control 3): the denial's own failed Start is expected only in this step.
            watch.setFaultPhase(true);
            // Sam, #1662 RETURN: only THIS press's acquisition outcome counts — an earlier rejection on the page cannot
            // qualify a later Start that failed for another reason.
            const acquisitionsBeforePress = (await micAcquisitionLog(page)).length;
            await pressCaptureControl(page, ['mic-download', 'mic-start'], { beforeClick: () => gate.confirm() });
            gate.recordPass();
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
            // J7.a (PO and Sam, 2026-11-19): no take is saved for THIS account. The account is read right after the blocked
            // copy and again after NO_TAKE_SETTLE_MS, with the page left open, nothing pressed, and recording still forbidden.
            const reads = [await readAccountSessions(owner.uid)];
            await page.waitForTimeout(NO_TAKE_SETTLE_MS);
            reads.push(await readAccountSessions(owner.uid));
            const noTake = noTakeSavedAfterDenialVerdict({ deniedAtAcquisition, uid: owner.uid, baseline: accountRows.baseline, reads });
            receipt.row(NO_TAKE_SAVED_ROW, noTake.status, noTake.detail, {
                baselineRows: accountRows.baseline.length, reads: reads.filter((r) => r !== null).length,
                rowsAfter: reads[reads.length - 1]?.ids.length ?? null, settleMs: NO_TAKE_SETTLE_MS,
            });
            watch.setForbidRecording(false);
            watch.setFaultPhase(false);
            // J7.a scope: the app never tries to unblock the microphone and this test never allows it, so recovery on the same
            // page is not exercised. It is recorded as UNTESTED, never as a row and never as a pass.
            receipt.meta.samePageRecovery = SAME_PAGE_RECOVERY;
            receipt.meta.samePageRecoveryReason = SAME_PAGE_RECOVERY_REASON;
        } else {
            // Sam's ACCEPT of PM 731eb5c0: only this download attempt's model-WEIGHT failures while the fault is armed count,
            // and the fault is armed BEFORE it is induced (a failure delivered during the awaited injection still counts).
            const fault = new AttemptFaultCounter<object>();
            context.on('request', (r) => fault.onRequest(r, r.url()));
            context.on('requestfailed', (r) => fault.onFailed(r));
            let injected = false;
            // J7.c option B only: the page and this attempt's model files at the gate (one file finished, the next held at its start).
            let gateRead: ModelBytesRead | null = null;
            let gateFiles: BetweenFilesSnapshot | null = null;
            // J7.c option B only: what the person saw on the failed attempt, read on that attempt before the network returns.
            let shown: ShownFailure | null = null;
            // AHT-14 only: the runtime-state log index read at the cold press (every phase of this attempt is read from it).
            let pressIndex = 0;
            if (variant === 'download-fails') {
                // Codex P1 r on f527a033: the phase opens BEFORE the fault is injected, so a failure the injection causes is
                // always captured inside it (events are judged by their own capture time).
                watch.setFaultPhase(true); // the injected model fault is expected only until the cause is removed
                fault.armFault();
                injected = await context.route(MODEL_ASSETS, (route) => route.abort('failed')).then(() => true, () => false);
                fault.startAttempt();
                await pressCaptureControl(page, ['mic-download'], { beforeClick: () => gate.confirm() });
                gate.recordPass();
                await failedState(page, 300_000);
            } else {
                // J7.c option B (PO, 2026-11-22; Sam, Chromium offline lets a streaming body finish): the network drops BETWEEN
                // model files. Every model request of this attempt is tracked from the network; the first model file requested after
                // one has finished is held at its start (before any byte is sent), the browser goes offline, and only then is the
                // held request let go, so it meets the dropped network and fails like a person's next file would.
                const transfer = new ModelTransferTracker<object>();
                context.on('request', (r) => transfer.onRequest(r, r.url()));
                context.on('requestfinished', (r) => transfer.onFinished(r));
                context.on('requestfailed', (r) => transfer.onFailed(r));
                await context.route(MODEL_ASSETS, (route) =>
                    hold.onRoute(route.request(), route.request().url(), transfer.snapshot().finished, () => route.continue()));
                const files = (): BetweenFilesSnapshot => {
                    const held = hold.held();
                    return { ...transfer.snapshot(), held: held === null ? 'none' : (transfer.stateOf(held) === 'none' ? 'unseen' : transfer.stateOf(held)) };
                };
                pressIndex = (await page.evaluate(readRuntimeStateLog).catch(() => ({ token: null, states: [] as string[] }))).states.length;
                fault.startAttempt();
                transfer.startAttempt();
                hold.startAttempt();
                await pressCaptureControl(page, ['mic-download'], { beforeClick: () => gate.confirm() });
                gate.recordPass();
                // Sam, 2026-11-15 (#1868 HOLD on f62e94c3): every phase of this attempt is read from its log index at the press.
                const run = await runBetweenFilesFault({
                    setOffline: (offline) => context.setOffline(offline).then(() => true, () => false),
                    phase: () => attemptPhaseOf(page, pressIndex),
                    files,
                    read: () => readModelBytes(page),
                    release: () => hold.release(),
                    isOnline: () => page.evaluate(() => navigator.onLine).catch(() => null),
                    armFault: () => { watch.setFaultPhase(true); fault.armFault(); transfer.armFault(); },
                    disarmFault: () => { transfer.disarm(); fault.disarm(); watch.setFaultPhase(false); },
                    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
                    now: () => Date.now(),
                }, { holdBoundMs: NEXT_FILE_MS, boundMs: 300_000, pollMs: 50 });
                const offlineOutcome = run.outcome;
                gateRead = run.gateRead;
                gateFiles = run.gateFiles;
                injected = offlineOutcome.kind === 'exercised';
                if (offlineOutcome.kind !== 'exercised') {
                    // No fault reached a next model file: never PASS. The cold take is stopped and saved, or FAILs.
                    const failure = offlineNotExercisedVerdict(offlineOutcome);
                    receipt.row('model download failure is stated truthfully', failure.status, failure.detail, {
                        faultInjected: false, offlineOutcome: offlineOutcome.kind, restoredOnline: offlineOutcome.restored,
                        gatePassed: betweenFilesGate(gateRead, gateFiles).inject, filesFinishedAtGate: gateFiles?.finished ?? null,
                        heldAtGate: gateFiles?.held ?? null, progressAtGate: gateRead?.pct ?? null,
                        statusAtGate: gateRead?.status ?? null, runtimeStateAtGate: gateRead?.runtimeState ?? null,
                    });
                    if (!offlineOutcome.restored) {
                        // Sam, 2026-11-15 on 481ae722: no Stop/save while the page has not reported itself online.
                        const stopped = unprovenRestoreVerdict('stop-and-save');
                        receipt.row('Retry downloads the model and a take saves', stopped.status, stopped.detail, { faultExercised: false, restoredOnline: false });
                        await reopenRow(receipt, page, { savedId: null, savedDigest: null });
                        return;
                    }
                    const cold = await settleColdTake(page, `adverse-${variant}-cold`, takes, pressIndex);
                    const settled = coldTakeSettledVerdict(cold);
                    receipt.row('Retry downloads the model and a take saves', settled.status, settled.detail,
                        { faultExercised: false, coldTakeRecorded: cold.recorded, coldTakeSaved: cold.savedId !== null, mode: await sttMode(page) });
                    await reopenRow(receipt, page, { savedId: null, savedDigest: null });
                    return;
                }
                // J7.c (PO): the visible error and an enabled Retry on the SAME failed attempt, read while still offline, before any
                // press. The telemetry code is never read: what the person sees is the verdict.
                shown = await readShownFailure(page, pressIndex);
            }
            const history = await modelStatuses(page);
            const failureFacts = {
                exercised: injected && fault.failures > 0,
                observed: history.observed,
                statuses: history.statuses,
                finalStatus: await modelStatus(page),
                retryOffered: await page.getByTestId('mic-retry').isVisible().catch(() => false),
                mode: await sttMode(page),
            };
            // J7.c: "dropped between model files" is the gate itself (counted bytes, one file finished, the next held), never the percent.
            const droppedBetweenFiles = betweenFilesGate(gateRead, gateFiles).inject;
            const failure = variant === 'offline-mid-download'
                ? worstVerdict(betweenFilesFailureVerdict({ ...failureFacts, droppedBetweenFiles }), shownFailureVerdict(shown))
                : downloadFailureVerdict(failureFacts);
            const toastText = shown?.toastTexts?.join(' | ') ?? null;
            const midDownload: Record<string, string | number | boolean | null> = variant === 'offline-mid-download'
                ? { droppedBetweenFiles, filesFinishedAtGate: gateFiles?.finished ?? null, heldAtGate: gateFiles?.held ?? null,
                    progressAtGate: gateRead?.pct ?? null, statusAtGate: gateRead?.status ?? null, runtimeStateAtGate: gateRead?.runtimeState ?? null,
                    shownOnSameAttempt: shown?.sameAttempt ?? null, retryEnabled: shown?.retryEnabled ?? null,
                    toastCount: shown?.toastTexts?.length ?? null, toastText: toastText === null ? null : toastText.slice(0, 200),
                    notSupportedShown: shown === null ? null : [shown.cardText ?? '', ...(shown.toastTexts ?? [])].some((t) => NOT_SUPPORTED_WORDING.test(t)) }
                : {};
            receipt.row('model download failure is stated truthfully', failure.status, failure.detail,
                { faultInjected: injected, modelWeightFailuresAfterFault: fault.failures, statusesObserved: history.observed, statusChanges: history.statuses.length,
                    finalStatus: await modelStatus(page), mode: await sttMode(page), ...midDownload, ...(await tabState(page)) });
            // Remove the cause the way it ends for a person: the asset host answers again, or the network comes back.
            if (variant === 'download-fails') await context.unroute(MODEL_ASSETS);
            else await context.setOffline(false);
            fault.disarm();
            watch.setFaultPhase(false);
            // Sam, 2026-11-15 on 481ae722: AHT-14 presses no recovery control until the page itself reports it is online again.
            if (variant === 'offline-mid-download' && (await page.evaluate(() => navigator.onLine).catch(() => null)) !== true) {
                const stopped = unprovenRestoreVerdict('recovery-press');
                receipt.row('Retry downloads the model and a take saves', stopped.status, stopped.detail, { restoredOnline: false });
                await reopenRow(receipt, page, { savedId: null, savedDigest: null });
                return;
            }
            // Sam, 2026-11-15 on f326a7b0: AHT-14 presses Retry ONLY after the fault is proven (the failure row PASSed). Otherwise no
            // recovery control is pressed; a take the cold press may still record is stopped and saved through Stop, or FAILs.
            if (variant === 'offline-mid-download' && failure.status !== 'PASS') {
                const cold = await settleColdTake(page, `adverse-${variant}-cold`, takes, pressIndex);
                const unproven = faultUnprovenRecoveryVerdict(cold);
                receipt.row('Retry downloads the model and a take saves', unproven.status, unproven.detail,
                    { faultProven: false, coldTakeRecorded: cold.recorded, coldTakeSaved: cold.savedId !== null, mode: await sttMode(page) });
                await reopenRow(receipt, page, { savedId: null, savedDigest: null });
                return;
            }
            // Retry is judged only after a failed download was stated with Retry; otherwise there is nothing to recover from.
            const recovered = await saveRecoveredTake(page, variant, failure.status === 'PASS', accountRows, `adverse-${variant}`, takes, gate);
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
