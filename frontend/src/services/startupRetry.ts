/**
 * #1258 C10 — `Try again` during a slow start (PM 6205858358 item 3).
 *
 * The button is rendered for ONE pending start attempt, identified by the moment it was pressed (`startupWaitStartedAt`).
 * By the time the person presses it, and the controller module has loaded, the world may have moved: the take may have
 * gone live, a successor attempt may own the wait, the owner may have changed, or an unresolved save may exist. So every
 * fact is re-read HERE, at the destructive boundary, and anything that moved means nothing is torn down.
 *
 * Then: cancel with CONFIRMED release (a rejected or unconfirmed teardown starts nothing and says so truthfully), wait a
 * bounded time for the cancelled attempt to unwind (a stuck unwind starts nothing and says so), and only then issue
 * exactly ONE new start, with the deliberate-cancel marker already cleared so that start's own failure reports as a
 * failure, never as the cancel.
 */
export type StartupRetryOutcome = 'restarted' | 'not_applicable' | 'release_unconfirmed' | 'unwind_timeout';

/** The states a pending start passes through before capture is live (RECORDING counts only while not live). */
const STARTUP_STATES = new Set(['INITIATING', 'ENGINE_INITIALIZING', 'RECORDING']);

export const STARTUP_RETRY_UNWIND_FAILED_MESSAGE =
    'The slow start was cancelled, but it did not finish closing. Press Start to try again.';

export interface StartupRetryDeps {
    /** The pending attempt the button was rendered for. */
    attemptStartedAt: number;
    ownerAtRender: string | null;
    read: () => { startupWaitStartedAt: number | null; captureLive: boolean; runtimeState: string | null; owner: string | null };
    controller: {
        pendingResolutionKind: () => string | null;
        hardResetAwaited: (reason: string) => Promise<void>;
        isEngineTerminal: () => boolean;
    };
    setCancelling: (cancelling: boolean) => void;
    /** Clears the cancelled attempt's wait so the page leaves "Getting your mic ready…" after a failure. */
    clearWait: () => void;
    reportFailure: (message: string) => void;
    unconfirmedMessage: string;
    restart: () => Promise<void>;
    settleMs: number;
    sleep?: (ms: number) => Promise<void>;
}

export async function cancelStartupAndRetry(d: StartupRetryDeps): Promise<StartupRetryOutcome> {
    const sleep = d.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = d.read();
    if (now.startupWaitStartedAt !== d.attemptStartedAt // a successor attempt, or the wait already ended
        || now.captureLive // the take went live meanwhile: it is a recording now, not a slow start
        || !STARTUP_STATES.has(now.runtimeState ?? '')
        || now.owner !== d.ownerAtRender
        || d.controller.pendingResolutionKind() !== null) { // never discard an unresolved save
        return 'not_applicable';
    }
    d.setCancelling(true);
    try {
        try {
            await d.controller.hardResetAwaited('startup_retry');
        } catch {
            d.clearWait();
            d.reportFailure(d.unconfirmedMessage);
            return 'release_unconfirmed';
        }
        if (!d.controller.isEngineTerminal()) {
            d.clearWait();
            d.reportFailure(d.unconfirmedMessage);
            return 'release_unconfirmed';
        }
        // The cancelled attempt's own handler ends its wait as it unwinds; a new start before that would be refused as
        // already in flight. Bounded: a stuck unwind starts nothing.
        const settleBy = Date.now() + d.settleMs;
        while (d.read().startupWaitStartedAt === d.attemptStartedAt && Date.now() < settleBy) await sleep(50);
        if (d.read().startupWaitStartedAt === d.attemptStartedAt) {
            d.clearWait();
            d.reportFailure(STARTUP_RETRY_UNWIND_FAILED_MESSAGE);
            return 'unwind_timeout';
        }
    } finally {
        // Cleared BEFORE the new start: from here on a failure is that start's own, reported as a failure.
        d.setCancelling(false);
    }
    await d.restart();
    return 'restarted';
}
