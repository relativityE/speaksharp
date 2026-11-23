/**
 * RWT R3 (row 17) — the pure verdicts behind `rwt-adverse-mic-model`: a blocked microphone, a Private model download
 * that fails, and the network going away mid-download. Free of Playwright so every rule is unit-tested with its failing
 * controls. Inputs are content-free: states, counts and booleans.
 */
import type { TabState, Verdict } from './rwtAbandonTakeover';

export const ADVERSE_SUITE = 'adverse-mic-model';
export const ADVERSE_VARIANTS = ['mic-denied', 'download-fails', 'offline-mid-download'] as const;
export type AdverseVariant = (typeof ADVERSE_VARIANTS)[number];

/** The product's own copy for a blocked microphone (useSessionLifecycle.getStartFailureMessage). */
export const MIC_BLOCKED_COPY = 'Microphone access is blocked. Allow microphone access and try again.';
/** The Private model's own-origin assets: the only requests the download cases alter. */
export const MODEL_ASSETS = '**/models/**';
export const MODEL_FAILED_STATES = ['error', 'init-failed'] as const;

/** Blocked microphone: the denial actually applied, the page says so, and nothing records or holds a track. */
/**
 * #1593 (Sam, #1662 RETURN): the case is exercised only when the APPLICATION's acquisition was refused with a
 * NotAllowedError — what a blocked site setting does and what the product reads. A permission query is informational: it
 * can read "denied" while a fake-media flag still grants a live track (live case 12), or "prompt" while acquisition is denied.
 */
/**
 * Sam, #1662 RETURN (case 12, press-bound denial; item 5 on f527a033): the case is exercised only when THIS press's own
 * acquisition — the first one INVOKED after the press — was refused with NotAllowedError. An older acquisition that rejects
 * later, or a later retry, cannot qualify a press whose own acquisition failed for another reason.
 */
export function deniedAfterPress(log: readonly { id: number; outcome: string }[], acquisitionsBeforePress: number): boolean {
    return log.find((a) => a.id >= acquisitionsBeforePress)?.outcome === 'NotAllowedError';
}

export function micDeniedVerdict(o: { deniedAtAcquisition: boolean; blockedCopyShown: boolean; tab: TabState }): Verdict {
    if (!o.deniedAtAcquisition) return { status: 'HOLD', detail: 'the page\'s microphone acquisition was never refused with NotAllowedError, so the case was not exercised' };
    if (!o.blockedCopyShown) return { status: 'FAIL', detail: 'the page did not say the microphone is blocked' };
    if (o.tab.runtimeState === 'RECORDING' || o.tab.recorderVisible) return { status: 'FAIL', detail: 'the page shows a recording although the microphone is blocked' };
    if (o.tab.liveTracks > 0) return { status: 'FAIL', detail: 'a microphone track is live although access is blocked' };
    return { status: 'PASS', detail: 'the page says the microphone is blocked, and nothing records' };
}

/**
 * J7.a (PO and Sam, 2026-11-19): the agreed scope is the denial alone. The browser blocks the microphone, the page says so,
 * capture never starts, and no take is saved for the test account. The app never tries to unblock the microphone and the
 * test never grants it, so recovery after allowing the microphone on the same page is not exercised. It is recorded as
 * UNTESTED in the receipt's meta, never as a row and never as a pass.
 */
export const NO_TAKE_SAVED_ROW = 'no take is saved after the blocked Start';
export const SAME_PAGE_RECOVERY = 'UNTESTED';
export const SAME_PAGE_RECOVERY_REASON =
    'not exercised: J7.a covers the blocked microphone only; the test never allows the microphone on the denied page';
/** The rows the J7.a scope removed: a mic-denied receipt that carries either one is not this test's receipt. */
export const MIC_DENIED_RECOVERY_ROWS = Object.freeze(['after allowing the microphone a take saves', 'the recovered take reopens from Analytics']);

/** One read of the account's session ids, bound to the account it was read for. Null when the read failed. */
export interface AccountSessionRead { uid: string; ids: readonly string[] }

/**
 * J7.a: nothing is saved for THIS account after the blocked Start. `baseline` is the account's session ids before the
 * first press; `reads` are re-reads after the blocked copy, at least two, the last after a settle wait. PASS only when the
 * denial was exercised and every read is of this exact account and shows no session id beyond the baseline. A row
 * created and left active counts as a saved take: the product wrote one. An unreadable read or a read of another account
 * proves nothing (HOLD).
 */
export function noTakeSavedAfterDenialVerdict(o: {
    deniedAtAcquisition: boolean; uid: string; baseline: readonly string[] | null; reads: readonly (AccountSessionRead | null)[];
}): Verdict {
    if (!o.deniedAtAcquisition) return { status: 'HOLD', detail: 'the page\'s microphone acquisition was never refused with NotAllowedError, so the case was not exercised' };
    if (!o.uid || o.baseline === null) return { status: 'HOLD', detail: 'the account\'s sessions before the press were not read, so "no take saved" is not claimed' };
    if (o.reads.length < 2 || o.reads.some((r) => r === null)) {
        return { status: 'HOLD', detail: 'the account\'s sessions were not read twice after the blocked Start, so "no take saved" is not claimed' };
    }
    const reads = o.reads as readonly AccountSessionRead[];
    if (reads.some((r) => r.uid !== o.uid)) return { status: 'HOLD', detail: 'a session read was not of the test account, so it proves nothing about it' };
    const fresh = new Set(reads.flatMap((r) => r.ids.filter((id) => !o.baseline!.includes(id))));
    if (fresh.size > 0) return { status: 'FAIL', detail: `the blocked Start left ${fresh.size} new session row(s) on the test account` };
    return { status: 'PASS', detail: `no session row was saved for the test account after the blocked Start (${reads.length} reads)` };
}

/**
 * A failing model download: the fault reached the download, the page never claimed `ready`, it ended in a failed state
 * with Retry, and the engine stayed Private. Sam's ACCEPT of PM 731eb5c0: `statuses` is the COMPLETE published history
 * (initial state and every transition, `readModelStatusLog`); an incomplete or empty history proves nothing — HOLD.
 */
export function downloadFailureVerdict(o: {
    exercised: boolean; observed?: boolean; statuses: readonly string[]; finalStatus: string | null; retryOffered: boolean; mode: string | null;
}): Verdict {
    if (o.observed === false || o.statuses.length === 0) return { status: 'HOLD', detail: 'the model status was not observed completely, so "never ready" is not claimed' };
    if (!o.exercised) return { status: 'HOLD', detail: 'the fault never reached the model download, so the case was not exercised' };
    if (o.statuses.includes('ready')) return { status: 'FAIL', detail: 'the page claimed the model was ready while its download was failing' };
    if (!(MODEL_FAILED_STATES as readonly string[]).includes(o.finalStatus ?? '')) {
        return { status: 'FAIL', detail: `the download failure ended as ${o.finalStatus ?? 'unreadable'}, not a failed state` };
    }
    if (!o.retryOffered) return { status: 'FAIL', detail: 'the failed download offered no Retry' };
    if (o.mode !== 'private') return { status: 'FAIL', detail: `the engine left Private (${o.mode ?? 'unreadable'})` };
    return { status: 'PASS', detail: 'the failed download was stated with Retry, never claimed ready, and the engine stayed Private' };
}

/** After the cause is removed, the person's own action recovers: a take records and saves one completed session. */
export function recoveredTakeVerdict(o: { recorded: boolean; savedId: string | null; savedStatus: string | null }): Verdict {
    if (!o.recorded) return { status: 'FAIL', detail: 'no take recorded after the cause was removed' };
    if (o.savedId === null) return { status: 'FAIL', detail: 'the recovered take bound no saved session' };
    if (o.savedStatus !== 'completed') return { status: 'FAIL', detail: `the recovered take is ${o.savedStatus ?? 'unreadable'}, not completed` };
    return { status: 'PASS', detail: 'after the cause was removed, a take recorded and saved one completed session' };
}

/**
 * Sam's ACCEPT of PM 731eb5c0 (cases 13/14) — THE PUBLISHED MODEL STATUS, COMPLETELY. The old logger read the current
 * attribute once per MutationObserver delivery, so `loading → ready → error` inside one delivery was logged as
 * `loading, error` and "never ready" passed. This log keeps the initial state and EVERY published value (each record's
 * successor is the next record's `oldValue`), drains undelivered records on every read, and is bound to its document by a
 * token (a replaced document has no log — `token: null`). Self-contained page functions (`page.evaluate`).
 */
export function armModelStatusLog(token: string): boolean {
    const w = window as unknown as Record<string, unknown>;
    const root = document.documentElement;
    const statuses: string[] = [root.getAttribute('data-model-status') ?? 'absent'];
    const record = (records: MutationRecord[]): void => {
        records.forEach((_r, i) => {
            const after = i + 1 < records.length ? records[i + 1].oldValue : root.getAttribute('data-model-status');
            statuses.push(after ?? 'absent');
        });
    };
    const observer = new MutationObserver(record);
    observer.observe(root, { attributes: true, attributeFilter: ['data-model-status'], attributeOldValue: true });
    w.__rwtModelStatusLog__ = { token, statuses, observer, record };
    return true;
}

export function readModelStatusLog(): { token: string | null; statuses: string[] } {
    const w = window as unknown as Record<string, unknown>;
    const log = w.__rwtModelStatusLog__ as { token: string; statuses: string[]; observer: MutationObserver; record: (r: MutationRecord[]) => void } | undefined;
    if (!log) return { token: null, statuses: [] };
    log.record(log.observer.takeRecords());
    return { token: log.token, statuses: log.statuses.slice() };
}

/**
 * Sam, 2026-11-15 (#1868 HOLD on f62e94c3) — THE RUNTIME STATE MACHINE, COMPLETELY: the same complete, token-bound log as the
 * model status above, of `data-runtime-state` (the exact TranscriptionService state). The model status cannot tell RECORDING
 * from READY, or a recording's save failure from a setup failure (both publish `error`); this log can, for one attempt, from
 * the index read at its press. Self-contained page functions (`page.evaluate`).
 */
export function armRuntimeStateLog(token: string): boolean {
    const w = window as unknown as Record<string, unknown>;
    const root = document.documentElement;
    const states: string[] = [root.getAttribute('data-runtime-state') ?? 'absent'];
    const record = (records: MutationRecord[]): void => {
        records.forEach((_r, i) => {
            const after = i + 1 < records.length ? records[i + 1].oldValue : root.getAttribute('data-runtime-state');
            states.push(after ?? 'absent');
        });
    };
    const observer = new MutationObserver(record);
    observer.observe(root, { attributes: true, attributeFilter: ['data-runtime-state'], attributeOldValue: true });
    w.__rwtRuntimeStateLog__ = { token, states, observer, record };
    return true;
}

export function readRuntimeStateLog(): { token: string | null; states: string[] } {
    const w = window as unknown as Record<string, unknown>;
    const log = w.__rwtRuntimeStateLog__ as { token: string; states: string[]; observer: MutationObserver; record: (r: MutationRecord[]) => void } | undefined;
    if (!log) return { token: null, states: [] };
    log.record(log.observer.takeRecords());
    return { token: log.token, states: log.states.slice() };
}

/**
 * J7.c option B (PO, 2026-11-22 "Yes to all 4"; Elon's options of 2026-11-21): THE FILES OF THIS ATTEMPT, from the network.
 * Chromium's offline switch blocks new requests but lets a response that is already streaming finish (Elon's Chromium 143
 * probe), so J7.c drops the network BETWEEN model files: after one file of this attempt has finished, at the start of the next.
 * This tracker sees this attempt's model-asset requests through the context's own network events (the same events
 * AttemptFaultCounter counts; AHT-13 run 43739078107 observed the worker's model requests failing through them): how many have
 * finished, how each one ended, and how many failed while the fault was armed (the fault reaching the download). If these events
 * were ever not delivered, `finished` stays 0 and nothing is held, so the browser never goes offline: the unobservable case is no
 * injection, never a stranded save.
 */
export type ModelRequestState = 'none' | 'pending' | 'finished' | 'failed';
export class ModelTransferTracker<R = unknown> {
    private attemptOpen = false;
    private faultArmed = false;
    private readonly requested = new Set<R>();
    private readonly ended = new Map<R, 'finished' | 'failed'>();
    private finished = 0;
    private failedUnderFault = 0;
    /** The person's download press: the requests it starts from now on are this attempt's. */
    startAttempt(): void { this.attemptOpen = true; }
    /** Immediately BEFORE the fault is induced. */
    armFault(): void { this.faultArmed = true; }
    /** The cause is removed: later requests and failures are not this attempt's fault window. */
    disarm(): void { this.faultArmed = false; this.attemptOpen = false; }
    onRequest(request: R, url: string): void { if (this.attemptOpen && MODEL_ASSET.test(url)) this.requested.add(request); }
    onFinished(request: R): void {
        if (!this.requested.delete(request)) return;
        this.ended.set(request, 'finished');
        this.finished += 1;
    }
    onFailed(request: R): void {
        if (!this.requested.delete(request)) return;
        this.ended.set(request, 'failed');
        if (this.faultArmed) this.failedUnderFault += 1;
    }
    /** How one request of this attempt stands: `none` for a request this attempt never started (or none at all). */
    stateOf(request: R | null): ModelRequestState {
        if (request === null) return 'none';
        if (this.requested.has(request)) return 'pending';
        return this.ended.get(request) ?? 'none';
    }
    snapshot(): { finished: number; failedUnderFault: number } {
        return { finished: this.finished, failedUnderFault: this.failedUnderFault };
    }
}

/**
 * J7.c option B: THE NEXT FILE, HELD AT ITS START. Installed as the context's route for model assets, it lets every request
 * through except one: the first model request of this attempt that starts after one of the attempt's files has finished. That
 * request waits, unsent, until `release()` continues it, so the journey can take the browser offline first and the request then
 * meets the dropped network as the next file of a real download would. Nothing is ever fulfilled or aborted here: a held request
 * is only ever continued, and `releaseAll()` (finalization) continues it at the latest, so a download is never left stalled.
 */
export class BetweenFilesHold<R = unknown> {
    private attemptOpen = false;
    private taken = false;
    private request: R | null = null;
    private continueHeld: (() => Promise<boolean>) | null = null;
    /** The person's download press: from now on the next file of this attempt may be held. */
    startAttempt(): void { this.attemptOpen = true; }
    /** The route's handler. `finished` is how many of this attempt's model files have finished so far. */
    async onRoute(request: R, url: string, finished: number, proceed: () => Promise<void>): Promise<void> {
        if (!this.attemptOpen || this.taken || !MODEL_ASSET.test(url) || finished < 1) return proceed();
        this.taken = true;
        this.request = request;
        await new Promise<void>((settle) => {
            let released = false;
            this.continueHeld = async () => {
                if (released) return false;
                released = true;
                try { await proceed(); return true; } catch { return false; } finally { settle(); }
            };
        });
    }
    /** The held request, or null while none is held yet. */
    held(): R | null { return this.continueHeld ? this.request : null; }
    /** Sends the held request on (true), once; false when none is held or it was already released, or continuing failed. */
    release(): Promise<boolean> { return this.continueHeld ? this.continueHeld() : Promise.resolve(false); }
    /** Finalization: nothing more is held, and a request still held is sent on. */
    async releaseAll(): Promise<void> { this.attemptOpen = false; await this.release(); }
}

/** A model asset request (weights, config or tokenizer): the download's own traffic. */
export const MODEL_ASSET = /\/models\//;

/**
 * Sam's ACCEPT of PM 731eb5c0 — THE FAULT'S OWN FAILURES. Only a model-asset request THIS download attempt started (after
 * the person's download press), failing while the fault is ARMED, counts — the download may fail on its config before any
 * weight is requested, and that is the injected fault reaching it. The fault is armed BEFORE it is induced (a failure
 * delivered while `setOffline` or the route is still being awaited counts) and disarmed when the cause is removed. Model
 * traffic from before the attempt (page-load or another attempt's), non-model requests and failures before arming never
 * qualify.
 */
export class AttemptFaultCounter<R = unknown> {
    private attemptOpen = false;
    private faultArmed = false;
    private readonly attempt = new Set<R>();
    failures = 0;
    /** The person's download press: the requests it starts from now on are this attempt's. */
    startAttempt(): void { this.attemptOpen = true; }
    /** Immediately BEFORE the fault is induced. */
    armFault(): void { this.faultArmed = true; }
    /** The cause is removed: later failures are not this fault's. */
    disarm(): void { this.faultArmed = false; this.attemptOpen = false; }
    onRequest(request: R, url: string): void { if (this.attemptOpen && MODEL_ASSET.test(url)) this.attempt.add(request); }
    onFailed(request: R): void { if (this.faultArmed && this.attempt.has(request)) this.failures += 1; }
}
