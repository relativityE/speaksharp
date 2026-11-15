/**
 * AHT-12 / 13 / 14 (fifteen-case front-run review, 2026-11-10) — the pure verdicts behind the adverse journey's recovery,
 * reopen and mid-download gate (`rwtAdverseJourney.ts`). Free of Playwright so each rule is unit-tested with its failing
 * controls (tests/unit/rwtAdverseRecovery.test.ts). Inputs are content-free: states, ids, counts and SHA-256 digests.
 * Every row fails closed: a missing observation is HOLD, a contradiction is FAIL, and only a complete observation is PASS.
 */
import { createHash } from 'node:crypto';
import { type AdverseVariant, downloadFailureVerdict } from './rwtAdverse';
import { type SessionRowFacts, type Verdict, savedTakeReadbackVerdict } from './rwtSaveRetry';

/** The MicCard primary control the page offers (MicCard.tsx: `mic-download` cold, `mic-retry` failed setup, else `mic-start`). */
export const RECOVERY_CONTROL_IDS = ['mic-start', 'mic-download', 'mic-retry'] as const;
export type RecoveryControl = (typeof RECOVERY_CONTROL_IDS)[number];
export const isRecoveryControl = (id: unknown): id is RecoveryControl => (RECOVERY_CONTROL_IDS as readonly unknown[]).includes(id);

/**
 * The control each variant's recovery is DESIGNED to press first. AHT-12 recovers in a fresh allowing browser, whose page
 * offers the cold one-press `Download & start recording` (or Start when the model is already there). AHT-13/14 recover on the
 * failed page itself through `Retry Private setup` — and Retry only re-runs setup (MicCard.tsx: "retrying setup starts no
 * recording"), so a separate Start follows once the model is ready. Any other offered control is not this case's recovery.
 */
export const RECOVERY_CONTROLS: Readonly<Record<AdverseVariant, readonly RecoveryControl[]>> = Object.freeze({
    'mic-denied': Object.freeze(['mic-download', 'mic-start'] as const),
    'download-fails': Object.freeze(['mic-retry'] as const),
    'offline-mid-download': Object.freeze(['mic-retry'] as const),
});

/**
 * AHT-12 scope (Sam, 2026-11-11): the existing test is a FRESH-BROWSER STAND-IN. Two Starts: one denied Start in the first
 * browser, then one download-and-record activation in a fresh allowing browser (a third dummy press would contradict the app's
 * one-activation behaviour). It does not prove Allow → Retry on the original denied page. The catalog's full AHT-12 case
 * (assertion-catalog.json minimumStarts 3, same-context denial → grant → Retry) stays a SEPARATE, OPEN requirement: the catalog
 * is not changed to two, and no row here claims it.
 */
export const AHT12_STAND_IN_LABEL =
    'fresh-browser stand-in: same account, a fresh allowing browser; it does not prove Allow → Retry on the original denied page';
export const AHT12_CATALOG_CASE_OPEN =
    "the catalog's full AHT-12 case (three presses, same-context denial → grant → Retry) is a separate requirement this test does not meet";

const FAILED = new Set(['error', 'init-failed']);
export type RetrySetup = 'not-pressed' | 'ready' | 'failed-again' | 'pending' | 'unobserved';

/**
 * What Retry's setup did, from the COMPLETE model-status history published AFTER the Retry press (`readModelStatusLog`
 * sliced at the press; `null` when that history was not observed in this document). In order: `ready` first → ready; a
 * failed state after the setup had left the failed state → failed again; otherwise still pending. A history still reading
 * only the old failed state is pending, never "failed again" (the press has not been picked up yet).
 */
export function retrySetupOutcome(statusesAfterPress: readonly string[] | null): Exclude<RetrySetup, 'not-pressed'> {
    if (statusesAfterPress === null) return 'unobserved';
    let left = false;
    for (const s of statusesAfterPress) {
        if (s === 'ready') return 'ready';
        if (FAILED.has(s)) { if (left) return 'failed-again'; continue; }
        left = true;
    }
    return 'pending';
}

/** What the journey's recovery presses observed. `startEnabled` is null when no Start was due. */
export interface RecoveryAttempt {
    offered: RecoveryControl | null;
    retry: RetrySetup;
    startEnabled: boolean | null;
    recorded: boolean;
}

/**
 * deliberate-recovery-saved / allowed-recovery-saved, at the harness's `ownSaved` bar (source-adapters.cjs `ownSaved`): the
 * designed recovery control was offered and pressed, Retry (13/14) brought the model to ready before Start, a take recorded,
 * and the account's new rows are EXACTLY one row — the page-bound id, completed, with an idempotency key and an available,
 * non-empty transcript (`savedTakeReadbackVerdict`, unchanged). `preconditionEstablished` false (13/14: the failed download was
 * not stated with Retry) turns a missing Retry into HOLD — there was nothing to recover from — never PASS.
 */
export function recoverySavedVerdict(o: {
    variant: AdverseVariant; preconditionEstablished: boolean; attempt: RecoveryAttempt; savedId: string | null; rows: readonly SessionRowFacts[];
}): Verdict {
    const expected = RECOVERY_CONTROLS[o.variant];
    const a = o.attempt;
    if (a.offered === null || !expected.includes(a.offered)) {
        const offered = a.offered ?? 'no recovery control';
        if (!o.preconditionEstablished) {
            return { status: 'HOLD', detail: `the failure was not established, so its recovery is not judged (the page offered ${offered})` };
        }
        return { status: 'FAIL', detail: `the page offered ${offered}, not ${expected.join(' or ')}, for the recovery` };
    }
    if (a.offered === 'mic-retry') {
        if (a.retry === 'unobserved') return { status: 'HOLD', detail: 'the model status after Retry was not observed, so the recovery is not judged' };
        if (a.retry === 'failed-again') return { status: 'FAIL', detail: 'Retry setup failed again after the cause was removed' };
        if (a.retry !== 'ready') return { status: 'FAIL', detail: 'the model did not reach ready after Retry' };
    }
    if (a.startEnabled === false) return { status: 'FAIL', detail: 'Start never became enabled after Retry brought the model to ready' };
    if (!a.recorded) return { status: 'FAIL', detail: 'no take recorded after the recovery press' };
    const saved = savedTakeReadbackVerdict(o.rows, o.savedId);
    return saved.status === 'PASS'
        ? { status: 'PASS', detail: `after the cause was removed, ${saved.detail}` }
        : saved;
}

const DIGEST = /^[0-9a-f]{64}$/;

/** SHA-256 of the saved transcript, TRIMMED like the harness readback; null when it is not available or empty. Text stays here. */
export function savedTranscriptDigest(row: { transcript_state?: unknown; transcript?: unknown } | null | undefined): string | null {
    if (!row || row.transcript_state !== 'available' || typeof row.transcript !== 'string') return null;
    const trimmed = row.transcript.trim();
    return trimmed === '' ? null : createHash('sha256').update(trimmed).digest('hex');
}

/** What the reopen observed: Analytics listed the take, its detail showed a transcript, and the digests before/after reload. */
export interface ReopenObservation {
    listed: boolean; detailShown: boolean; before: string | null; reloadShown: boolean; after: string | null;
}

/**
 * review-reopen (harness source-adapters.cjs `saveReopen` / browser-actions.cjs `reopen`): from `/analytics`, the take's own
 * `open-session-detail-<id>` opens a `session-detail-transcript` whose trimmed text digests to the saved transcript's
 * trimmed digest, and again after a reload. No saved take or no readable saved transcript → HOLD (nothing to compare).
 */
export function reviewReopenVerdict(o: ReopenObservation & { savedId: string | null; savedDigest: string | null }): Verdict {
    if (o.savedId === null) return { status: 'HOLD', detail: 'no saved recovery take to reopen' };
    if (o.savedDigest === null || !DIGEST.test(o.savedDigest)) {
        return { status: 'HOLD', detail: 'the saved transcript is not available, so the reopened detail cannot be compared' };
    }
    if (!o.listed) return { status: 'FAIL', detail: 'Analytics does not list the saved take' };
    if (!o.detailShown || o.before === null || !DIGEST.test(o.before)) return { status: 'FAIL', detail: 'the opened detail showed no readable transcript' };
    if (o.before !== o.savedDigest) return { status: 'FAIL', detail: 'the reopened transcript differs from the saved one' };
    if (!o.reloadShown || o.after === null || !DIGEST.test(o.after)) return { status: 'FAIL', detail: 'after reload the detail showed no readable transcript' };
    if (o.after !== o.savedDigest) return { status: 'FAIL', detail: 'after reload the transcript differs from the saved one' };
    return { status: 'PASS', detail: 'Analytics reopened the saved take with its saved transcript, before and after a reload (digest equal)' };
}

/**
 * AHT-14 "mid-download": the page had RECEIVED model bytes and the transfer was still running when the browser went offline.
 * `mic-progress` is the product's own byte count (transformers.js reports `loaded / total` while reading each response body in
 * the model worker; the store keeps it as a percent), so a rendered 1–99 % while `loading` is bytes seen, mid-transfer — and it
 * is read in the page, whether or not the worker's fetches reach Playwright's network events. 100 % is a finished transfer.
 */
export type ModelBytesRead = { pct: number | null; status: string | null; runtimeState?: string | null };
export function modelBytesSeen(read: ModelBytesRead | null): boolean {
    return read !== null && read.status === 'loading' && typeof read.pct === 'number' && read.pct >= 1 && read.pct < 100;
}

/**
 * AHT-14 injection gate (Sam, 2026-11-15, after rc-gates run 43740031821). The browser goes offline ONLY while the product's own
 * state machine (`data-runtime-state`, the exact TranscriptionService state) is DOWNLOADING and the page shows received bytes
 * mid-transfer. The model status alone cannot say that: TranscriptionService publishes `ready` for READY and for RECORDING, and
 * `loading` for DOWNLOAD_COMPLETE and ENGINE_INITIALIZING too. In that run the journey went offline after its read had settled,
 * the cold `Download & start recording` press was already recording, the take's session could not be written, and the account
 * kept an admitted save that no timer, lease release or cleanup may settle (#1643), so the run-owned account could not be deleted.
 * Anything but a proven mid-transfer download is no injection: the fault is never put on a page that may be recording.
 */
export const DOWNLOAD_RUNTIME_STATE = 'DOWNLOADING';
export type OfflineInjectionGate = { inject: true } | { inject: false; reason: string };
export function offlineInjectionGate(read: ModelBytesRead | null): OfflineInjectionGate {
    if (read === null) return { inject: false, reason: 'the page state was unreadable' };
    if (read.runtimeState !== DOWNLOAD_RUNTIME_STATE) {
        return { inject: false, reason: `the runtime state was ${read.runtimeState ?? 'unreadable'}, not ${DOWNLOAD_RUNTIME_STATE}` };
    }
    if (!modelBytesSeen(read)) return { inject: false, reason: 'no model bytes were seen mid-transfer' };
    return { inject: true };
}

/**
 * Sam, 2026-11-15 (#1868 HOLD on f62e94c3): a single snapshot cannot say what one attempt did. The attempt's phase is decided from
 * the COMPLETE runtime-state log (`armRuntimeStateLog`) from the index read at its press:
 *  - `recorded`: RECORDING (or PAUSED / STOPPING) appeared — a take may exist, whatever came after (a later FAILED included);
 *  - `past-download`: the transfer finished (DOWNLOAD_COMPLETE, ENGINE_INITIALIZING or READY) and no recording yet;
 *  - `setup-failed`: INIT_FAILED or FAILED reached from THIS attempt's DOWNLOADING, with nothing past the download before it.
 *    Only that order binds a failure to the setup; a bare FAILED is never read as one;
 *  - `unattributed-failure`: INIT_FAILED or FAILED without this attempt's DOWNLOADING before it;
 *  - `downloading` / `pre-download`: the last state is DOWNLOADING / nothing decisive yet;
 *  - `unobserved`: no log in this document (replaced document), or an index beyond the log.
 */
export const RECORDING_RUNTIME_STATES = ['RECORDING', 'PAUSED', 'STOPPING'] as const;
export const PAST_DOWNLOAD_RUNTIME_STATES = ['DOWNLOAD_COMPLETE', 'ENGINE_INITIALIZING', 'READY'] as const;
const SETUP_FAILED_RUNTIME_STATES = ['INIT_FAILED', 'FAILED'];
export type RuntimeStateLog = { observed: boolean; states: readonly string[] };
export type AttemptPhase = 'unobserved' | 'pre-download' | 'downloading' | 'past-download' | 'recorded' | 'setup-failed' | 'unattributed-failure';
export function attemptPhase(log: RuntimeStateLog | null, fromIndex: number): AttemptPhase {
    if (!log || !log.observed || !Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex > log.states.length) return 'unobserved';
    const states = log.states.slice(fromIndex);
    if (states.some((s) => (RECORDING_RUNTIME_STATES as readonly string[]).includes(s))) return 'recorded';
    const failedAt = states.findIndex((s) => SETUP_FAILED_RUNTIME_STATES.includes(s));
    const pastAt = states.findIndex((s) => (PAST_DOWNLOAD_RUNTIME_STATES as readonly string[]).includes(s));
    if (failedAt >= 0 && (pastAt < 0 || pastAt > failedAt)) {
        return states.slice(0, failedAt).includes(DOWNLOAD_RUNTIME_STATE) ? 'setup-failed' : 'unattributed-failure';
    }
    if (pastAt >= 0) return 'past-download';
    if (states[states.length - 1] === DOWNLOAD_RUNTIME_STATE) return 'downloading';
    return 'pre-download';
}

/**
 * The page and context the offline fault drives, injected so every interleaving is unit-tested without a browser. `phase()` reads
 * the attempt's phase from the complete log; `isOnline()` is the page's own `navigator.onLine` (null: unreadable); `armFault`
 * and `disarmFault` open and close the watchdog's fault phase and the attempt's failure counter around the offline window.
 */
export interface OfflineFaultIo {
    setOffline(offline: boolean): Promise<boolean>;
    phase(): Promise<AttemptPhase>;
    isOnline(): Promise<boolean | null>;
    armFault(): void;
    disarmFault(): void;
    sleep(ms: number): Promise<void>;
    now(): number;
}

/**
 * - `exercised`: the browser went offline during this attempt's confirmed download, and the setup then failed from that download
 *   with no recording (`settled: true`), or was still downloading offline at the bound (`settled: false`, judged by the failure
 *   verdict as before). The network is still offline: the caller states the failure, then removes the cause.
 * - `not-exercised`: no fault reached a download; the network was never taken offline, or its restoration was PROVEN (the page
 *   reports `navigator.onLine`) before any recording was seen. Never PASS.
 * - `fail-closed`: a recording appeared under the fault, the attempt was unobserved, a failure could not be bound to this
 *   attempt, or restoration was not proven. Always FAIL; the network has been restored as far as the context allows.
 */
export type OfflineFaultOutcome =
    | { kind: 'exercised'; settled: boolean }
    | { kind: 'not-exercised'; reason: string; restored: boolean }
    | { kind: 'fail-closed'; reason: string; restored: boolean };

/**
 * AHT-14's offline window, as one bounded controller (Sam, 2026-11-15, #1868 HOLD). Offline only after the gate (runtime exactly
 * DOWNLOADING with bytes mid-transfer) AND the attempt's own log say downloading; then the log is polled for the whole window:
 * a transition during `setOffline(true)` is caught by the first read after it, and one just after any read by the next. Any sight
 * of the download finishing restores the network at once and requires the page to report itself online; any sight of a
 * recording, an unobserved attempt or a failure not bound to this attempt restores and fails closed.
 */
export async function runOfflineFault(io: OfflineFaultIo, gateRead: ModelBytesRead | null,
    opts: { boundMs: number; pollMs: number }): Promise<OfflineFaultOutcome> {
    const gate = offlineInjectionGate(gateRead);
    if (!gate.inject) return { kind: 'not-exercised', reason: gate.reason, restored: true };
    const before = await io.phase();
    if (before !== 'downloading') {
        return before === 'recorded' || before === 'unobserved' || before === 'unattributed-failure'
            ? { kind: 'fail-closed', reason: `the attempt was ${before} before going offline`, restored: true }
            : { kind: 'not-exercised', reason: `the attempt was ${before}, not downloading, at the gate`, restored: true };
    }
    const restore = async (): Promise<boolean> => {
        const ok = await io.setOffline(false).catch(() => false);
        io.disarmFault();
        return ok && (await io.isOnline().catch(() => null)) === true;
    };
    io.armFault();
    if (!(await io.setOffline(true).catch(() => false))) {
        const restored = await restore();
        return restored
            ? { kind: 'not-exercised', reason: 'going offline failed', restored }
            : { kind: 'fail-closed', reason: 'going offline failed and the page did not report itself online again', restored };
    }
    const deadline = io.now() + opts.boundMs;
    for (;;) {
        const phase = await io.phase();
        if (phase === 'setup-failed') return { kind: 'exercised', settled: true };
        if (phase === 'past-download') {
            const restored = await restore();
            // A recording may have begun while the network came back: re-read; only a proven, still unrecorded restore is benign.
            const after = await io.phase();
            if (restored && after !== 'recorded' && after !== 'unobserved') {
                return { kind: 'not-exercised', reason: 'the download finished before the fault reached it; the network was restored before any recording', restored };
            }
            return { kind: 'fail-closed', reason: restored ? `the attempt was ${after} when the network came back` : 'the download finished under the fault and the page did not report itself online again', restored };
        }
        if (phase === 'recorded' || phase === 'unobserved' || phase === 'unattributed-failure') {
            const restored = await restore();
            return { kind: 'fail-closed', reason: `the attempt was ${phase} under the fault`, restored };
        }
        if (io.now() >= deadline) return { kind: 'exercised', settled: false };
        await io.sleep(opts.pollMs);
    }
}

/** The failure row when no mid-download fault was exercised: HOLD for a proven, benign miss; FAIL when it failed closed. Never PASS. */
export function offlineNotExercisedVerdict(outcome: Exclude<OfflineFaultOutcome, { kind: 'exercised' }>): Verdict {
    if (outcome.kind === 'fail-closed') {
        return { status: 'FAIL', detail: `the offline fault failed closed (${outcome.reason}; network restoration ${outcome.restored ? 'proven' : 'NOT proven'})` };
    }
    return { status: 'HOLD', detail: `the browser was not kept offline mid-download (${outcome.reason}), so no download failure was exercised` };
}

/**
 * The recovery row when no fault was exercised. The cold press goes on to download and record; the journey stops that take
 * through the product's own Stop and waits for its save, so the account never keeps a recorded take with no saved row. `recorded`
 * comes from the attempt's complete log, never from the current state: a take that recorded and then FAILED is recorded. Retry
 * is not judged (there was nothing to retry): HOLD at best. Recorded but unsaved, or unknown whether it recorded, is FAIL: the
 * account may then hold an unsettled save; the cleanup row reports whether deletion settled.
 */
export function coldTakeSettledVerdict(o: { recorded: boolean | null; savedId: string | null }): Verdict {
    if (o.recorded === null) {
        return { status: 'FAIL', detail: 'whether the cold take recorded is unknown (the attempt was unobserved), so a save may be unsettled' };
    }
    if (o.recorded && o.savedId === null) {
        return { status: 'FAIL', detail: 'the cold take recorded but its save was not confirmed, so a save may be unsettled' };
    }
    if (o.recorded) {
        return { status: 'HOLD', detail: 'no fault was exercised, so Retry was not judged; the cold take that recorded was stopped and saved' };
    }
    return { status: 'HOLD', detail: 'no fault was exercised and the attempt shows no recording, so there was nothing to recover' };
}

/**
 * download-fault-exercised + download-failure-truthful for AHT-14. HOLD (never PASS) when no model bytes were seen before going
 * offline — that is offline-before-download, not mid-download — or when no failed model request of this attempt was observed
 * while the fault was armed (the download runs in a Web Worker; if Playwright does not surface that worker's fetches, or the
 * transfer finished before offline applied, the fault's reach is unproven). Otherwise the AHT-13 rule decides, unchanged.
 */
export function midDownloadFailureVerdict(o: Parameters<typeof downloadFailureVerdict>[0] & { bytesSeenBeforeOffline: boolean }): Verdict {
    if (o.observed === false || o.statuses.length === 0) return downloadFailureVerdict(o);
    if (!o.bytesSeenBeforeOffline) {
        return { status: 'HOLD', detail: 'no model bytes were seen before going offline, so this was not offline mid-download' };
    }
    if (!o.exercised) {
        return { status: 'HOLD', detail: 'model bytes were seen, but no failed model request of this download was observed after going offline (worker fetches may not reach Playwright\'s network events), so the fault\'s reach is unproven' };
    }
    return downloadFailureVerdict(o);
}
