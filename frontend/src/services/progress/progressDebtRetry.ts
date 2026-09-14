/**
 * RWT-20 — BOUNDED in-page retry for durable Progress debt, ending in one honest terminal state.
 *
 * THE DEFECT. The durable queue was drained exactly once per authenticated page load. A Progress evaluation that kept
 * failing therefore held Start forever: in the Production real-world test one entry blocked recording for ~88 minutes
 * across two loads, under copy that promised "this will retry automatically".
 *
 * NOW. While this owner's gate is `queued`, failing debt is retried on a fixed backoff. EACH entry keeps its own
 * budget: it is released only once it has itself failed `PROGRESS_DEBT_ATTEMPT_BUDGET` attempts, so debt that arrives
 * mid-schedule is never released by an older entry's schedule. The budget and clock are the entry's PERSISTED
 * `attempts` / `lastAttemptAtIso`, so a reload resumes them instead of restarting the hold. A released entry stays
 * durable and later loads keep retrying it. Single-flight per owner, so repeated gate publications never multiply
 * attempts.
 */
import { getQueueEntriesForUser, type QueueEntry } from './progressReconcileQueue';
import {
    attemptProgressDebtRound,
    PROGRESS_RPC_ATTEMPT_TIMEOUT_MS,
    releaseProgressDebtEntry,
} from './recordProgress';

/** Delay before each retry, indexed by the attempts the entry has already failed. */
export const PROGRESS_DEBT_RETRY_DELAYS_MS: readonly number[] = Object.freeze([2_000, 8_000, 20_000]);

/** Failed reconciliation attempts (on any load or retry) after which an entry stops holding Start. */
export const PROGRESS_DEBT_ATTEMPT_BUDGET = PROGRESS_DEBT_RETRY_DELAYS_MS.length;

/**
 * Worst case from an entry's first retry wait to its release: every delay plus every attempt hitting its deadline.
 * This is the longest one queued debt can hold Start within one page (60 s with the current values).
 */
export const PROGRESS_DEBT_RELEASE_BOUND_MS = PROGRESS_DEBT_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0)
    + PROGRESS_DEBT_RETRY_DELAYS_MS.length * PROGRESS_RPC_ATTEMPT_TIMEOUT_MS;

export interface ProgressDebtRetryResult {
    resolved: number;
    released: number;
}

const schedules = new Map<string, Promise<ProgressDebtRetryResult>>();

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** How soon a due debt that was skipped, because the other trigger was attempting it, is read again. */
const SKIP_RECHECK_MS = 250;

export function scheduleProgressDebtRetry(userId: string): Promise<ProgressDebtRetryResult> {
    if (!userId) return Promise.resolve({ resolved: 0, released: 0 });
    const existing = schedules.get(userId);
    if (existing) return existing;
    const run = runSchedule(userId).finally(() => schedules.delete(userId));
    schedules.set(userId, run);
    return run;
}

async function runSchedule(userId: string): Promise<ProgressDebtRetryResult> {
    const startedAt = Date.now();
    // In-memory floor for the budget and clock, used only when an attempt could not be persisted: without it a
    // failing write would leave `attempts` unchanged and the schedule would retry forever.
    const tried = new Map<string, { attempts: number; lastAt: number }>();
    const attemptsOf = (e: QueueEntry) => Math.max(e.attempts ?? 0, tried.get(e.sessionId)?.attempts ?? 0);
    const dueAt = (e: QueueEntry) => {
        const attempts = attemptsOf(e);
        const persisted = Date.parse(e.lastAttemptAtIso ?? '');
        // Never attempted: the first wait starts when this page first chases it (or when it was enqueued, if later).
        const base = Math.max(
            attempts === 0 ? Math.max(startedAt, Date.parse(e.enqueuedAtIso) || 0) : (Number.isFinite(persisted) ? persisted : 0),
            tried.get(e.sessionId)?.lastAt ?? 0,
        );
        return base + PROGRESS_DEBT_RETRY_DELAYS_MS[Math.min(attempts, PROGRESS_DEBT_RETRY_DELAYS_MS.length - 1)];
    };
    const refused = new Set<string>();
    let recheckAt = 0;
    let resolved = 0;
    let released = 0;
    for (;;) {
        const owed = getQueueEntriesForUser(userId);
        // Unreadable storage stays fail-closed and is outside this bound: stop without releasing anything.
        if (!owed.ok) return { resolved, released };
        const blocking = owed.entries.filter((e) => !e.releasedAtIso && !refused.has(e.sessionId));
        // Release ONLY entries that have spent their own budget (possibly on earlier loads).
        let releaseSkipped = false;
        for (const entry of blocking.filter((e) => attemptsOf(e) >= PROGRESS_DEBT_ATTEMPT_BUDGET)) {
            const outcome = await releaseProgressDebtEntry(userId, entry);
            if (outcome === 'released') released++;
            else if (outcome === 'refused') refused.add(entry.sessionId); // an unrecorded release keeps blocking; stop chasing it this page
            else releaseSkipped = true;
        }
        const pending = blocking.filter((e) => attemptsOf(e) < PROGRESS_DEBT_ATTEMPT_BUDGET);
        if (pending.length === 0 && !releaseSkipped) return { resolved, released };
        if (pending.length === 0) {
            // A spent debt's release was skipped (another tab owns it right now): re-read shortly instead of returning
            // while it still holds Start. Nothing is counted for the skip (PM RETURN 5661399676).
            await sleep(SKIP_RECHECK_MS);
            continue;
        }

        const nextDue = Math.min(...pending.map(dueAt));
        await sleep(Math.max(0, Math.max(nextDue, recheckAt) - Date.now()));
        // Re-read after the wait: the other trigger may have persisted, cleared or released a debt meanwhile, and a stale
        // snapshot would treat the attempt it just made as still due (Codex 4002837036).
        const fresh = getQueueEntriesForUser(userId);
        if (!fresh.ok) return { resolved, released };
        const now = Date.now();
        const current = fresh.entries.filter((e) => !e.releasedAtIso && !refused.has(e.sessionId) && attemptsOf(e) < PROGRESS_DEBT_ATTEMPT_BUDGET);
        const due = new Set(current.filter((e) => dueAt(e) <= now).map((e) => e.sessionId));
        const round = await attemptProgressDebtRound(userId, 'retry', due);
        resolved += round.drained;
        if (round.unreadable) return { resolved, released };
        for (const e of current) {
            // Only attempts this round made advance the in-memory floor. A skipped debt's next due time comes from the
            // attempt the other trigger persists, so it is re-read shortly instead of being spun on or counted.
            if (!round.attempted.has(e.sessionId)) continue;
            tried.set(e.sessionId, { attempts: attemptsOf(e) + 1, lastAt: now });
        }
        recheckAt = [...due].some((id) => !round.attempted.has(id)) ? Date.now() + SKIP_RECHECK_MS : 0;
    }
}

/** Test-only: forget in-flight schedules between cases. */
export function __resetProgressDebtRetryForTests(): void {
    schedules.clear();
}
