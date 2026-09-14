/**
 * RWT-20 — BOUNDED in-page retry for durable Progress debt, ending in one honest terminal state.
 *
 * THE DEFECT. The durable queue was drained exactly once per authenticated page load. A Progress evaluation that kept
 * failing therefore held Start forever: in the Production real-world test one entry blocked recording for ~88 minutes
 * across two loads, under copy that promised "this will retry automatically".
 *
 * NOW. While this owner's gate is `queued`, attempt rounds run on a fixed backoff. If the debt is still owed after the
 * last round, it is RELEASED: Start becomes available, and the entry stays durable so later loads keep retrying it.
 * Single-flight per owner, so repeated gate publications never multiply attempts.
 */
import {
    attemptProgressDebtRound,
    PROGRESS_RPC_ATTEMPT_TIMEOUT_MS,
    releaseBlockingProgressDebt,
} from './recordProgress';

/** Delay before each retry round. The save path (3 attempts) or the load round has already tried once. */
export const PROGRESS_DEBT_RETRY_DELAYS_MS: readonly number[] = Object.freeze([2_000, 8_000, 20_000]);

/**
 * Worst case from the start of the schedule to the release: every delay plus every attempt hitting its deadline.
 * This is the longest a queued debt can hold Start within one page (60 s with the current values).
 */
export const PROGRESS_DEBT_RELEASE_BOUND_MS = PROGRESS_DEBT_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0)
    + PROGRESS_DEBT_RETRY_DELAYS_MS.length * PROGRESS_RPC_ATTEMPT_TIMEOUT_MS;

export interface ProgressDebtRetryResult {
    resolved: number;
    released: number;
}

const schedules = new Map<string, Promise<ProgressDebtRetryResult>>();

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export function scheduleProgressDebtRetry(userId: string): Promise<ProgressDebtRetryResult> {
    if (!userId) return Promise.resolve({ resolved: 0, released: 0 });
    const existing = schedules.get(userId);
    if (existing) return existing;
    const run = runSchedule(userId).finally(() => schedules.delete(userId));
    schedules.set(userId, run);
    return run;
}

async function runSchedule(userId: string): Promise<ProgressDebtRetryResult> {
    let resolved = 0;
    for (const delay of PROGRESS_DEBT_RETRY_DELAYS_MS) {
        await sleep(delay);
        const round = await attemptProgressDebtRound(userId, 'retry');
        resolved += round.drained;
        // Nothing left holding Start (resolved, or retired elsewhere), or storage unreadable — which stays
        // fail-closed and is outside this bound: stop without releasing anything.
        if (round.unreadable || round.remainingBlocking === 0) return { resolved, released: 0 };
    }
    return { resolved, released: releaseBlockingProgressDebt(userId) };
}

/** Test-only: forget in-flight schedules between cases. */
export function __resetProgressDebtRetryForTests(): void {
    schedules.clear();
}
