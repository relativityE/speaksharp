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
