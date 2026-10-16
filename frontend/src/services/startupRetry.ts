/**
 * #1258 C10 — `Try again` during a slow start (PM 6205858358 item 3, PM 6207105255 item 1).
 *
 * The button is bound to ONE accepted start attempt (`startAttemptRegistry`), not to the page's presentation wait. That
 * attempt is the authority across every await: the facts are read before anything is torn down, the cancel marker names
 * only that attempt, the old hook call is awaited until it has ACTUALLY returned (its own settlement — the wait clearing
 * is not proof), and immediately before the replacement every fact is read again. A successor attempt, a live take, a
 * different owner, a left page or an unresolved save means the work stands down: nothing of the successor's is touched,
 * nothing is reported, and no restart is claimed. The replacement is START-ONLY — it can never toggle a recording off.
 */
export type StartupRetryOutcome = 'restarted' | 'not_applicable' | 'superseded' | 'release_unconfirmed' | 'unwind_timeout';

/** The states a pending start passes through before capture is live (RECORDING counts only while not live). */
const STARTUP_STATES = new Set(['INITIATING', 'ENGINE_INITIALIZING', 'RECORDING']);
/** States in which a replacement Start must not be issued: something is (or is becoming) a recording. */
const BUSY_STATES = new Set(['INITIATING', 'ENGINE_INITIALIZING', 'RECORDING', 'STOPPING']);

export const STARTUP_RETRY_UNWIND_FAILED_MESSAGE =
    'The slow start was cancelled, but it did not finish closing. Press Start to try again.';

export interface StartupRetryFacts {
    /** The current attempt's id in the registry (a newer press replaces it). */
    attemptId: string | null;
    attemptSettled: boolean;
    /** The page's own capture wait for the current take is still on (cleared when capture goes live, or the start ends). */
    waitPending: boolean;
    captureLive: boolean;
    runtimeState: string | null;
    owner: string | null;
    mounted: boolean;
}

export interface StartupRetryDeps {
    /** The attempt the button was pressed for. */
    attemptId: string;
    ownerAtRender: string | null;
    read: () => StartupRetryFacts;
    /** Resolves true once that attempt's hook invocation has returned, false if it has not within `ms`. */
    waitForSettled: (ms: number) => Promise<boolean>;
    controller: {
        pendingResolutionKind: () => string | null;
        hardResetAwaited: (reason: string) => Promise<void>;
        isEngineTerminal: () => boolean;
    };
    /** Mark / unmark the pressed attempt (and ONLY it) as deliberately cancelled — attempt-scoped, never a shared slot. */
    markCancelled: () => void;
    clearCancelled: () => void;
    clearWait: () => void;
    reportFailure: (message: string) => void;
    unconfirmedMessage: string;
    /** A START-ONLY replacement (never a toggle). */
    restartStartOnly: () => Promise<void>;
    settleMs: number;
}

export async function cancelStartupAndRetry(d: StartupRetryDeps): Promise<StartupRetryOutcome> {
    const own = (f: StartupRetryFacts) => f.attemptId === d.attemptId && f.owner === d.ownerAtRender && f.mounted;
    const before = d.read();
    // PM 6207494433: a SETTLED hook call is not live capture. The controller's Start resolves at FSM RECORDING, before
    // real frames necessarily arrive, so the current attempt stays retryable while its own capture wait is still on and
    // capture is not live. An attempt whose wait has ENDED is never retried.
    if (!own(before)
        || !before.waitPending // the wait ended: the take went live, or the start ended one way or another
        || before.captureLive // the take went live meanwhile: it is a recording now, not a slow start
        || !STARTUP_STATES.has(before.runtimeState ?? '')
        || d.controller.pendingResolutionKind() !== null) { // never discard an unresolved save
        return 'not_applicable';
    }
    /** Failure cleanup and reporting belong to THIS attempt only; a successor's state is never touched. */
    const failFor = (message: string, outcome: StartupRetryOutcome): StartupRetryOutcome => {
        if (!own(d.read())) return 'superseded';
        d.clearWait();
        d.reportFailure(message);
        return outcome;
    };
    d.markCancelled();
    let oldSettled = false;
    try {
        try {
            await d.controller.hardResetAwaited('startup_retry');
        } catch {
            return failFor(d.unconfirmedMessage, 'release_unconfirmed');
        }
        if (!d.controller.isEngineTerminal()) return failFor(d.unconfirmedMessage, 'release_unconfirmed');
        // The cancelled attempt's OWN settlement — not the presentation wait — before anything new can start.
        oldSettled = await d.waitForSettled(d.settleMs);
        if (!oldSettled) return failFor(STARTUP_RETRY_UNWIND_FAILED_MESSAGE, 'unwind_timeout');
    } finally {
        // Cleared BEFORE the replacement, and only once THIS attempt has settled. Codex r4291244682 / PM 6209560600: an
        // unsettled attempt keeps its own mark (its settlement clears it), so its late RECORDING_INTENT_RETIRED still reads
        // as this deliberate cancel — no failure status, telemetry or reset. Another attempt's mark is never touched.
        if (oldSettled || await d.waitForSettled(0)) d.clearCancelled();
    }
    // Revalidate at the replacement boundary: anything that moved during the awaits means stand down, untouched.
    const now = d.read();
    if (!own(now) || now.captureLive || BUSY_STATES.has(now.runtimeState ?? '') || d.controller.pendingResolutionKind() !== null) {
        return 'superseded';
    }
    await d.restartStartOnly();
    return 'restarted';
}
