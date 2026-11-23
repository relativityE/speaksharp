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

/** One immediate read of the page: the byte percent it renders, its model status and its published runtime state. */
export type ModelBytesRead = { pct: number | null; status: string | null; runtimeState?: string | null };

/**
 * J7.c option B (PO, 2026-11-22; Elon's options of 2026-11-21): THE NETWORK DROPS BETWEEN MODEL FILES. Chromium's offline switch
 * blocks new requests but lets a response that is already streaming finish (Elon's Chromium 143 probe), so the fault is placed
 * where a real drop meets a multi-file download: one file of this attempt has finished, and the next is held at the start of its
 * request (`BetweenFilesHold`) until the browser is offline.
 *
 * WHAT THE PAGE ACTUALLY PUBLISHES (pinned by tests/unit/rwtAdverseRecovery.test.ts against the product's own mapper):
 * `data-runtime-state` is `mapToRuntimeState(fsm)` (forensicAnchors.ts), not the raw FSM. The cold download runs INSIDE the raw
 * ENGINE_INITIALIZING state (the raw DOWNLOADING state is mapped to ENGINE_INITIALIZING too), so no published state says
 * "downloading". The gate is therefore the published setup state, bytes the product has counted (1 % or more, 100 % included:
 * the real aggregator, progressAggregator.ts, can hold 100 % while a later file downloads), at least one finished model file of
 * this attempt, and the next model file of this attempt held unsent. All four, or the browser never goes offline.
 */
export const SETUP_RUNTIME_STATE = 'ENGINE_INITIALIZING';
/**
 * This attempt's model files, from the network (`ModelTransferTracker`), and how the held next file stands: `none` while nothing
 * is held, `unseen` when the route holds a request the network events never showed as this attempt's (the gate refuses it).
 */
export type BetweenFilesSnapshot = { finished: number; failedUnderFault: number; held: 'none' | 'unseen' | 'pending' | 'finished' | 'failed' };
export type OfflineInjectionGate = { inject: true } | { inject: false; reason: string };
/** The product counted received bytes (any percent from 1, 100 included: the aggregator can hold 100 mid-download). */
export function bytesCounted(read: ModelBytesRead | null): boolean {
    return read !== null && read.status === 'loading' && typeof read.pct === 'number' && read.pct >= 1;
}
export function betweenFilesGate(read: ModelBytesRead | null, files: BetweenFilesSnapshot | null): OfflineInjectionGate {
    if (read === null) return { inject: false, reason: 'the page state was unreadable' };
    if (read.runtimeState !== SETUP_RUNTIME_STATE) {
        return { inject: false, reason: `the runtime state was ${read.runtimeState ?? 'unreadable'}, not ${SETUP_RUNTIME_STATE}` };
    }
    if (!bytesCounted(read)) return { inject: false, reason: 'no model bytes were counted yet' };
    if (files === null || files.finished < 1) return { inject: false, reason: 'no model file of this attempt had finished' };
    if (files.held !== 'pending') return { inject: false, reason: 'no next model file of this attempt was held at the start of its request' };
    return { inject: true };
}

/**
 * Sam, 2026-11-15 (#1868 HOLD on f62e94c3): a single snapshot cannot say what one attempt did. The attempt's phase is decided from
 * the COMPLETE published runtime-state log (`armRuntimeStateLog`) from the index read at its press, over the states the page
 * actually publishes (IDLE, INITIATING, DOWNLOAD_REQUIRED, ENGINE_INITIALIZING, READY, RECORDING, STOPPING, FAILED, FAILED_VISIBLE,
 * TERMINATED):
 *  - `recorded`: RECORDING (raw RECORDING or PAUSED) or STOPPING appeared — a take may exist, whatever came after (a FAILED too);
 *  - `setup-failed`: FAILED / FAILED_VISIBLE reached from THIS attempt's ENGINE_INITIALIZING, with no READY before it. Only that
 *    order binds a failure to the attempt's setup; a bare FAILED is never read as one;
 *  - `unattributed-failure`: FAILED / FAILED_VISIBLE without this attempt's ENGINE_INITIALIZING before it;
 *  - `left-setup`: the engine became READY, or the runtime left setup without failing (IDLE / TERMINATED after it): no download;
 *  - `in-setup`: the last state is ENGINE_INITIALIZING. Download OR engine init — only the network can tell (`betweenFilesGate`);
 *  - `pre-setup`: nothing decisive yet; `unobserved`: no log in this document (replaced document), or an index beyond the log.
 */
export const RECORDING_RUNTIME_STATES = ['RECORDING', 'STOPPING'] as const;
const FAILED_RUNTIME_STATES = ['FAILED', 'FAILED_VISIBLE'];
const LEFT_SETUP_RUNTIME_STATES = ['READY', 'IDLE', 'TERMINATED'];
export type RuntimeStateLog = { observed: boolean; states: readonly string[] };
export type AttemptPhase = 'unobserved' | 'pre-setup' | 'in-setup' | 'left-setup' | 'recorded' | 'setup-failed' | 'unattributed-failure';
export function attemptPhase(log: RuntimeStateLog | null, fromIndex: number): AttemptPhase {
    if (!log || !log.observed || !Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex > log.states.length) return 'unobserved';
    const states = log.states.slice(fromIndex);
    const failedAt = states.findIndex((s) => FAILED_RUNTIME_STATES.includes(s));
    // A take exists if RECORDING was ever published (the log keeps every transition, transients included). STOPPING stays
    // conservative (possibly a take) only BEFORE this attempt's first failure: after FAILED / FAILED_VISIBLE the product tears
    // the failed setup down through STOPPING with no RECORDING (Elon's isolated real-worker run, J7.c, 2026-11-22).
    const stoppedBeforeFailure = states.some((s, i) => s === 'STOPPING' && (failedAt < 0 || i < failedAt));
    if (states.includes('RECORDING') || stoppedBeforeFailure) return 'recorded';
    const setupAt = states.indexOf(SETUP_RUNTIME_STATE);
    const readyAt = states.indexOf('READY');
    if (failedAt >= 0 && (readyAt < 0 || readyAt > failedAt)) {
        return setupAt >= 0 && setupAt < failedAt ? 'setup-failed' : 'unattributed-failure';
    }
    if (readyAt >= 0) return 'left-setup';
    if (setupAt < 0) return 'pre-setup';
    const last = states[states.length - 1];
    if (last === SETUP_RUNTIME_STATE) return 'in-setup';
    return LEFT_SETUP_RUNTIME_STATES.includes(last) ? 'left-setup' : 'pre-setup';
}

/**
 * The page and context the between-files fault drives, injected so every interleaving is unit-tested without a browser. `phase()`
 * reads the attempt's phase from the complete log; `files()` is this attempt's model files from the network and how the held next
 * file stands; `read()` is one read of the page (`ModelBytesRead`); `release()` sends the held file's request on (false when it
 * could not); `isOnline()` is the page's own `navigator.onLine` (null: unreadable); `armFault` and `disarmFault` open and close the
 * watchdog's fault phase and the attempt's failure counters around the offline window.
 */
export interface OfflineFaultIo {
    setOffline(offline: boolean): Promise<boolean>;
    phase(): Promise<AttemptPhase>;
    files(): BetweenFilesSnapshot;
    read(): Promise<ModelBytesRead | null>;
    release(): Promise<boolean>;
    isOnline(): Promise<boolean | null>;
    armFault(): void;
    disarmFault(): void;
    sleep(ms: number): Promise<void>;
    now(): number;
}

/**
 * - `exercised`: the browser went offline with the next model file of this attempt held, that file was then sent into the dropped
 *   network, and the setup failed from this attempt's ENGINE_INITIALIZING with no READY or recording (`settled: true`), or a
 *   request of this attempt had failed under the fault and the setup was still running offline at the bound (`settled: false`,
 *   judged by the failure verdict). The network is still offline: the caller states the failure, then removes the cause.
 * - `not-exercised`: no fault reached the download; the network was never taken offline, or its restoration was PROVEN (the page
 *   reports `navigator.onLine`) before any recording was seen. Never PASS.
 * - `fail-closed`: a recording appeared, the attempt was unobserved, a failure could not be bound to this attempt, or restoration
 *   was not proven. Always FAIL; the network has been restored as far as the context allows.
 */
export type OfflineFaultOutcome =
    | { kind: 'exercised'; settled: boolean }
    | { kind: 'not-exercised'; reason: string; restored: boolean }
    | { kind: 'fail-closed'; reason: string; restored: boolean };
/** The outcome, with the page read and the files the gate decided from (null when no next file was ever held). */
export type BetweenFilesRun = { outcome: OfflineFaultOutcome; gateRead: ModelBytesRead | null; gateFiles: BetweenFilesSnapshot | null };

const UNSAFE_PHASES: readonly AttemptPhase[] = ['recorded', 'unobserved', 'unattributed-failure'];

/**
 * J7.c's offline window, as one bounded controller (option B). It waits, within `holdBoundMs`, for the next model file of this
 * attempt to be held; reads the page; goes offline only when `betweenFilesGate` and the attempt's own log both say so; then sends
 * the held request into the dropped network and polls. Every poll re-reads the log and the files: the setup failing from this
 * attempt is the fault exercised; a recording, an unobserved attempt or a failure not bound to this attempt restores and fails
 * closed; the held file downloading anyway (offline did not reach it) or the setup leaving without failing restores at once and
 * requires the page to report itself online. Whenever the browser does not go offline, the held request is sent on online, so a
 * download is never left stalled. Restoring early is always the safe side: it costs an exercised fault (HOLD), never a stranded
 * save.
 */
export async function runBetweenFilesFault(io: OfflineFaultIo,
    opts: { holdBoundMs: number; boundMs: number; pollMs: number }): Promise<BetweenFilesRun> {
    const run = (outcome: OfflineFaultOutcome, gateRead: ModelBytesRead | null = null, gateFiles: BetweenFilesSnapshot | null = null): BetweenFilesRun =>
        ({ outcome, gateRead, gateFiles });
    // Whenever the browser does not go offline, a held file goes on, online: a download is never left stalled.
    const sendOnline = async (outcome: OfflineFaultOutcome, gateRead: ModelBytesRead | null = null, gateFiles: BetweenFilesSnapshot | null = null): Promise<BetweenFilesRun> => {
        await io.release().catch(() => false);
        return run(outcome, gateRead, gateFiles);
    };
    // 1. The next file of this attempt, held. Until then the download runs untouched; a recording or a lost log stops the wait.
    const holdDeadline = io.now() + opts.holdBoundMs;
    // A held file the network events have not reported yet ('unseen') is waited on too: the gate needs it seen and still pending.
    const heldSeen = (): boolean => !['none', 'unseen'].includes(io.files().held);
    for (;;) {
        if (heldSeen()) break;
        const phase = await io.phase();
        if (heldSeen()) break;
        if (UNSAFE_PHASES.includes(phase)) {
            return sendOnline({ kind: 'fail-closed', reason: `the attempt was ${phase} before any next model file was held`, restored: true });
        }
        if (phase === 'setup-failed' || phase === 'left-setup') {
            return sendOnline({ kind: 'not-exercised', reason: `the attempt was ${phase} before any next model file was held`, restored: true });
        }
        if (io.now() >= holdDeadline) {
            return sendOnline({ kind: 'not-exercised', reason: 'no model file of this attempt was requested after one had finished, within the bound', restored: true });
        }
        await io.sleep(opts.pollMs);
    }
    // 2. The gate, from one page read and the files. Refused: the held file goes on, online.
    const gateRead = await io.read();
    const gateFiles = io.files();
    const gate = betweenFilesGate(gateRead, gateFiles);
    if (!gate.inject) return sendOnline({ kind: 'not-exercised', reason: gate.reason, restored: true }, gateRead, gateFiles);
    const before = await io.phase();
    if (before !== 'in-setup') {
        return sendOnline(UNSAFE_PHASES.includes(before)
            ? { kind: 'fail-closed', reason: `the attempt was ${before} before going offline`, restored: true }
            : { kind: 'not-exercised', reason: `the attempt was ${before}, not in setup, at the gate`, restored: true }, gateRead, gateFiles);
    }
    const restore = async (): Promise<boolean> => {
        const ok = await io.setOffline(false).catch(() => false);
        io.disarmFault();
        return ok && (await io.isOnline().catch(() => null)) === true;
    };
    const benignOrClosed = async (why: string): Promise<BetweenFilesRun> => {
        const restored = await restore();
        // A recording may have begun while the network came back: re-read; only a proven, still unrecorded restore is benign.
        const after = await io.phase();
        if (restored && !UNSAFE_PHASES.includes(after)) {
            return run({ kind: 'not-exercised', reason: `${why}; the network was restored before any recording`, restored }, gateRead, gateFiles);
        }
        return run({ kind: 'fail-closed', reason: restored ? `${why}, and the attempt was ${after} when the network came back` : `${why}, and the page did not report itself online again`, restored }, gateRead, gateFiles);
    };
    // 3. Offline, armed first (a failure delivered while setOffline is awaited still counts), then the held file is sent.
    io.armFault();
    if (!(await io.setOffline(true).catch(() => false))) {
        const restored = await restore();
        await io.release().catch(() => false);
        return run(restored
            ? { kind: 'not-exercised', reason: 'going offline failed', restored }
            : { kind: 'fail-closed', reason: 'going offline failed and the page did not report itself online again', restored }, gateRead, gateFiles);
    }
    if (!(await io.release().catch(() => false))) return benignOrClosed('the held model file could not be sent');
    // 4. The window: decided from the log and the files on every poll.
    const deadline = io.now() + opts.boundMs;
    for (;;) {
        const phase = await io.phase();
        if (phase === 'setup-failed') return run({ kind: 'exercised', settled: true }, gateRead, gateFiles);
        if (UNSAFE_PHASES.includes(phase)) {
            const restored = await restore();
            return run({ kind: 'fail-closed', reason: `the attempt was ${phase} under the fault`, restored }, gateRead, gateFiles);
        }
        if (phase !== 'in-setup') return benignOrClosed(`the attempt was ${phase} under the fault, not downloading`);
        const files = io.files();
        if (files.held === 'finished' && files.failedUnderFault === 0) {
            // The log may have moved on since the phase read: decide from it again before calling it a benign miss.
            const again = await io.phase();
            if (again === 'setup-failed') return run({ kind: 'exercised', settled: true }, gateRead, gateFiles);
            if (UNSAFE_PHASES.includes(again)) {
                const restored = await restore();
                return run({ kind: 'fail-closed', reason: `the attempt was ${again} under the fault`, restored }, gateRead, gateFiles);
            }
            return benignOrClosed('the held model file downloaded although the browser was offline');
        }
        if (io.now() >= deadline) {
            return files.failedUnderFault > 0
                ? run({ kind: 'exercised', settled: false }, gateRead, gateFiles)
                : benignOrClosed('no model request of this attempt failed under the fault within the bound');
        }
        await io.sleep(opts.pollMs);
    }
}

/**
 * Sam, 2026-11-15 on 481ae722: nothing that can write a take (Stop/save of the cold take, or the recovery press) runs unless the
 * page itself reported `navigator.onLine` after the network was restored. Unproven restoration stops the journey fail-closed here;
 * the finalizer still restores the network and the cleanup row reports whether deletion settled.
 */
export function unprovenRestoreVerdict(next: 'stop-and-save' | 'recovery-press'): Verdict {
    return { status: 'FAIL', detail: next === 'stop-and-save'
        ? 'the network restoration was not proven (the page did not report itself online), so the cold take was not stopped or saved; the journey stopped fail-closed'
        : 'the network restoration was not proven (the page did not report itself online), so no recovery control was pressed; the journey stopped fail-closed' };
}

/**
 * Sam, 2026-11-15 on f326a7b0: when the offline fault was applied but its failure was not proven (the failure row is not PASS), no
 * recovery control is pressed. A take the cold press may still record is stopped and saved through Stop (`coldTakeSettledVerdict`
 * decides FAIL for recorded-but-unsaved or unknown); otherwise HOLD, never PASS: Retry was not judged.
 */
export function faultUnprovenRecoveryVerdict(o: { recorded: boolean | null; savedId: string | null }): Verdict {
    const cold = coldTakeSettledVerdict(o);
    if (cold.status === 'FAIL') return cold;
    return { status: 'HOLD', detail: `the download failure was not proven, so no recovery control was pressed${o.recorded ? '; the take that recorded was stopped and saved' : ''}` };
}

/** The failure row when no between-files fault was exercised: HOLD for a proven, benign miss; FAIL when it failed closed. Never PASS. */
export function offlineNotExercisedVerdict(outcome: Exclude<OfflineFaultOutcome, { kind: 'exercised' }>): Verdict {
    if (outcome.kind === 'fail-closed') {
        return { status: 'FAIL', detail: `the offline fault failed closed (${outcome.reason}; network restoration ${outcome.restored ? 'proven' : 'NOT proven'})` };
    }
    return { status: 'HOLD', detail: `the network was not dropped between model files (${outcome.reason}), so no download failure was exercised` };
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
 * download-fault-exercised + download-failure-truthful for J7.c (AHT-14). HOLD (never PASS) when the gate never passed (no file of
 * this attempt had finished with the next one held, so this was not a drop between files), or when no failed model request of
 * this attempt was observed while the fault was armed (the fault's reach is unproven). Otherwise the AHT-13 rule decides, unchanged.
 */
export function betweenFilesFailureVerdict(o: Parameters<typeof downloadFailureVerdict>[0] & { droppedBetweenFiles: boolean }): Verdict {
    if (o.observed === false || o.statuses.length === 0) return downloadFailureVerdict(o);
    if (!o.droppedBetweenFiles) {
        return { status: 'HOLD', detail: 'the network was not dropped between model files of this download, so the case was not exercised' };
    }
    if (!o.exercised) {
        return { status: 'HOLD', detail: 'the network was dropped between model files, but no failed model request of this download was observed under the fault, so the fault\'s reach is unproven' };
    }
    return downloadFailureVerdict(o);
}

/** MicCard's own line for a failed Private setup (MicCard.tsx), the message every failed download must show beside Retry. */
export const MODEL_SETUP_FAILED_COPY = 'Setup didn\u2019t finish \u2014 retry. Your audio stays on your machine.';
/** Any wording that tells the person their setup or browser is not supported. After a network drop that is untrue: a product bug. */
export const NOT_SUPPORTED_WORDING = /\bnot supported\b|\bunsupported\b|\bisn[\u2019']t supported\b/i;

/**
 * Sam, 2026-11-22 (J7.c option B): what the person SEES on the failed attempt, captured on that same attempt, offline, before
 * anything is pressed: the mic card (its status line and the failure line), every toast on the page, and the Retry control.
 * Judged apart from telemetry: the `unsupported` acquisition code is never read here. `sameAttempt` is true only when the
 * page's runtime log, from this attempt's press, still ends in this attempt's setup failure (same document, nothing since).
 *  - HOLD: nothing was read, the page could not be bound to the failed attempt, or it was unreadable.
 *  - FAIL: anything visible says "not supported" (PO, 2026-11-22: a product bug, not a pass); Retry is missing or disabled; or
 *    the card does not state the failure.
 *  - PASS: the card states the failure, Retry is enabled, and nothing visible calls it not supported.
 */
export type ShownFailure = {
    sameAttempt: boolean | null; cardText: string | null; toastTexts: readonly string[] | null;
    retryVisible: boolean | null; retryEnabled: boolean | null;
};
/** Whether any part of a read that WAS read (the card, the shown toasts) says "not supported"; an unreadable part hides nothing read. */
function shownNotSupported(o: ShownFailure): boolean {
    return [o.cardText ?? '', ...(o.toastTexts ?? [])].some((text) => NOT_SUPPORTED_WORDING.test(text));
}
export function shownFailureVerdict(o: ShownFailure | null): Verdict {
    if (o === null) return { status: 'HOLD', detail: 'what the page showed on the failed attempt was not read' };
    if (o.sameAttempt !== true) return { status: 'HOLD', detail: 'what the page showed could not be bound to the failed attempt' };
    // Codex P2 on ee8ffe4a: "not supported" in whatever part was read is FAIL, even when another part was unreadable.
    if (shownNotSupported(o)) {
        return { status: 'FAIL', detail: 'after the network dropped, the page told the person it is not supported: a product bug, not a pass' };
    }
    if (o.cardText === null || o.toastTexts === null) return { status: 'HOLD', detail: 'what the page showed on the failed attempt was unreadable' };
    if (o.retryVisible !== true || o.retryEnabled !== true) {
        return { status: 'FAIL', detail: `the failed attempt offered no enabled Retry (${o.retryVisible !== true ? 'not shown' : 'disabled'})` };
    }
    if (!o.cardText.includes(MODEL_SETUP_FAILED_COPY)) return { status: 'FAIL', detail: 'the failed attempt did not state that setup did not finish' };
    return { status: 'PASS', detail: 'the failed attempt stated that setup did not finish, with Retry enabled, and nothing on the page called it not supported' };
}

/**
 * Sam, 2026-11-23 (#1941, blocking): the text of the toasts a person can actually see, passed as is to `evaluateAll` on
 * `[data-sonner-toast]` (it runs in the page, so it uses nothing outside itself). sonner keeps queued, entering and leaving toasts
 * in the page at opacity 0 (this app shows one or two at a time), and that text was never shown to anyone. A toast counts only
 * when neither it nor any ancestor is `display: none`, `visibility: hidden` or `collapse`, or opacity 0; its `innerText` then
 * leaves out any hidden part of it.
 */
export function shownToastTexts(toasts: readonly Element[]): string[] {
    const texts: string[] = [];
    for (const toast of toasts) {
        let shown = true;
        for (let el: Element | null = toast; shown && el !== null; el = el.parentElement) {
            const style = getComputedStyle(el);
            shown = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity || '1') !== 0;
        }
        if (shown) texts.push((toast as HTMLElement).innerText);
    }
    return texts;
}

/**
 * Whether a read of the failed attempt ends the observation window early. Only a read that can no longer pass does: one no
 * longer bound to the failed attempt (HOLD; a pass needs the whole window on that attempt), or a bound read in which anything
 * read and shown says "not supported", even if another part was unreadable (FAIL whatever follows). Sam, 2026-11-23 (#1941, blocking): a correct card with Retry
 * enabled and a toast is NOT final, because a "not supported" toast can still arrive on a later read; a pass is judged only on
 * the last read of the whole window. (This replaces the early stop on a correct card plus any toast from Elon on 90cf2eba; his
 * case, a toast that renders before the card's setup-failed line, is still read past, because nothing stops before the bound.)
 */
export function shownFailureSettled(o: ShownFailure): boolean {
    // Codex P2 on ee8ffe4a: "not supported" seen in the readable part ends it as FAIL even if the other part was unreadable,
    // so a later read without that toast can never turn it into a PASS. A read with nothing forbidden but a part unreadable reads on.
    return o.sameAttempt !== true || shownNotSupported(o);
}

/**
 * Reads the failed attempt for the whole observation window (`budgetMs`) and returns the last read, unless a read ends it early
 * (`shownFailureSettled`: off the attempt, or "not supported" shown), in which case that read is returned. `read` takes one
 * bound read of the page; the clock and the wait between reads are injected so the poll is tested offline.
 */
export async function pollShownFailure(read: () => Promise<ShownFailure>, { budgetMs, intervalMs = 250, now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }) }: { budgetMs: number; intervalMs?: number; now?: () => number;
    sleep?: (ms: number) => Promise<void> }): Promise<ShownFailure> {
    const deadline = now() + budgetMs;
    for (;;) {
        const shown = await read();
        if (shownFailureSettled(shown) || now() >= deadline) return shown;
        await sleep(intervalMs);
    }
}

/** One row from several verdicts on the same facts: FAIL over HOLD over PASS; the first verdict of the worst status speaks. */
export function worstVerdict(...verdicts: readonly Verdict[]): Verdict {
    for (const status of ['FAIL', 'HOLD'] as const) {
        const found = verdicts.find((v) => v.status === status);
        if (found) return found;
    }
    return verdicts[0];
}
