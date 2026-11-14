/**
 * #1811 AHT-01/02/07/08 recoverable feedback: the journey side of the transactional run fence (20261114100000).
 *
 * The database is the durable, run-bound record of every report the run-owned account writes; this helper only drives it:
 *   - open  BEFORE the journey's first feedback write (no fence → no write: the case is held, never run unfenced);
 *   - close at the final boundary, once every owned page is closed (waits for in-flight inserts, refuses later ones);
 *   - clean after the account deletion (AHT-02's retained, now ownerless report included), reading back to zero.
 * A runner lost anywhere in between leaves a fence a recovery dispatch can close and clean by its deterministic run key.
 *
 * Content-free: only counts, states and the run key leave this module — never report text, ids or account data.
 */
import type { RunBinding } from './runBinding';

/** The feedback-submitting journeys (Sam, #1859 review): AHT-01, the Focus journey (AHT-02), AHT-07 and AHT-08. */
export type FenceCase = 'AHT-01' | 'AHT-02' | 'AHT-07' | 'AHT-08' | 'AHT-07+AHT-08';
export const FENCE_CASES: readonly FenceCase[] = Object.freeze(['AHT-01', 'AHT-02', 'AHT-07', 'AHT-08', 'AHT-07+AHT-08']);

export interface FenceRpcClient {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
export interface FenceClose { state: 'closed' | 'cleaned'; reports: number; keys: number }
export interface FenceClean { deleted: number; residue: number; foreign: number; state: 'closed' | 'cleaned' }

/** The fence's run key, exactly as the database derives it: `<runId>-<runAttempt>-<case>`. */
export function fenceRunKey(binding: Pick<RunBinding, 'runId' | 'runAttempt'>, fenceCase: FenceCase): string {
    if (!/^[1-9]\d{0,19}$/.test(binding.runId) || !/^[1-9]\d{0,3}$/.test(binding.runAttempt) || !FENCE_CASES.includes(fenceCase)) {
        throw new Error('feedback fence: invalid run key parts');
    }
    return `${binding.runId}-${binding.runAttempt}-${fenceCase}`;
}

const failure = (step: string, error: { code?: string } | null) => new Error(`feedback fence ${step} failed (fail closed): ${error?.code ?? 'unknown'}`);

export interface FenceReadback {
    exists: boolean; state?: 'open' | 'closed' | 'cleaned'; owner?: string; case?: string;
    recorded?: number; keys?: number; remaining?: number; foreign?: number;
}

/** The read-only readback of one fence (never writes, never locks). Fails closed on an error or an unexpected shape. */
export async function verifyFeedbackFence(admin: FenceRpcClient, runKey: string): Promise<FenceReadback> {
    const { data, error } = await admin.rpc('verify_rwt_feedback_fence_v1', { p_run_key: runKey });
    if (error) throw failure('verify', error);
    const d = data as FenceReadback | null;
    if (!d || typeof d.exists !== 'boolean') throw new Error('feedback fence verify returned an unexpected shape (fail closed)');
    if (d.exists && (!['open', 'closed', 'cleaned'].includes(String(d.state)) || typeof d.owner !== 'string'
        || ![d.recorded, d.keys, d.remaining, d.foreign].every(Number.isInteger))) {
        throw new Error('feedback fence verify returned an unexpected shape (fail closed)');
    }
    return d;
}

/**
 * Open the run's fence for its run-owned account, CONFIRMED before the caller's first feedback write. Open is not idempotent
 * (Sam, #1859 review), so an uncertain response (an error, a transport failure, an unexpected payload) is never retried by
 * reopening: the fence is read back by its deterministic key, and accepted only if it exists, is open, and is this owner's
 * for this case. Anything else throws, and the caller HOLDs before any feedback write.
 */
export async function openFeedbackFence(
    admin: FenceRpcClient, owner: string, binding: RunBinding, fenceCase: FenceCase, keyCap: number,
): Promise<string> {
    if (!Number.isInteger(keyCap) || keyCap < 1 || keyCap > 8) throw new Error('feedback fence: key cap outside 1..8');
    const expected = fenceRunKey(binding, fenceCase);
    let opened = false;
    try {
        const { data, error } = await admin.rpc('open_rwt_feedback_fence_v1',
            { p_owner: owner, p_binding: binding, p_case: fenceCase, p_key_cap: keyCap });
        opened = !error && data === expected;
    } catch { /* uncertain: resolved by the readback below */ }
    const readback = await verifyFeedbackFence(admin, expected);
    if (!readback.exists || readback.state !== 'open' || readback.owner !== owner || readback.case !== fenceCase) {
        throw new Error(`feedback fence open ${opened ? 'unconfirmed' : 'uncertain'}: the readback does not show this owner's open fence (fail closed)`);
    }
    return expected;
}

/** Close: waits for every in-flight insert of the account, then refuses all later ones. Idempotent. */
export async function closeFeedbackFence(admin: FenceRpcClient, runKey: string): Promise<FenceClose> {
    const { data, error } = await admin.rpc('close_rwt_feedback_fence_v1', { p_run_key: runKey });
    if (error) throw failure('close', error);
    const d = data as Partial<FenceClose> | null;
    if (!d || (d.state !== 'closed' && d.state !== 'cleaned') || !Number.isInteger(d.reports) || !Number.isInteger(d.keys)) {
        throw new Error('feedback fence close returned an unexpected shape (fail closed)');
    }
    return { state: d.state, reports: d.reports as number, keys: d.keys as number };
}

/** Clean: deletes exactly the recorded reports (owned or ownerless), never another account's, then reads them back. */
export async function cleanFeedbackFence(admin: FenceRpcClient, runKey: string): Promise<FenceClean> {
    const { data, error } = await admin.rpc('clean_rwt_feedback_fence_v1', { p_run_key: runKey });
    if (error) throw failure('clean', error);
    const d = data as Partial<FenceClean> | null;
    if (!d || !Number.isInteger(d.deleted) || !Number.isInteger(d.residue) || !Number.isInteger(d.foreign)
        || (d.state !== 'closed' && d.state !== 'cleaned')) {
        throw new Error('feedback fence clean returned an unexpected shape (fail closed)');
    }
    return { deleted: d.deleted as number, residue: d.residue as number, foreign: d.foreign as number, state: d.state };
}

/**
 * Clean, then the INDEPENDENT zero check (Sam, #1859 review): a separate read-only readback must show the fence cleaned with
 * nothing remaining and nothing foreign. Returns both results; the verdict below decides.
 */
export async function cleanAndVerifyFeedbackFence(admin: FenceRpcClient, runKey: string): Promise<{ cleaned: FenceClean; readback: FenceReadback }> {
    const cleaned = await cleanFeedbackFence(admin, runKey);
    const readback = await verifyFeedbackFence(admin, runKey);
    return { cleaned, readback };
}

/**
 * The receipt verdict for a cleaned fence. PASS only when the readback is zero, no recorded report belongs to another
 * account, the fence is `cleaned`, and the deletion matches what the closed fence recorded.
 */
export function fenceCleanupVerdict(closed: FenceClose | null, cleaned: FenceClean | null, readback: FenceReadback | null = null): { verdict: 'PASS' | 'FAIL'; detail: string } {
    if (!closed) return { verdict: 'FAIL', detail: 'the feedback fence was never closed' };
    if (!cleaned) return { verdict: 'FAIL', detail: 'the feedback fence was not cleaned' };
    if (!readback || !readback.exists || readback.state !== 'cleaned' || readback.remaining !== 0 || readback.foreign !== 0) {
        return { verdict: 'FAIL', detail: 'the independent readback did not confirm zero remaining' };
    }
    if (cleaned.foreign !== 0) return { verdict: 'FAIL', detail: `${cleaned.foreign} recorded report(s) now belong to another account; left untouched` };
    if (cleaned.residue !== 0 || cleaned.state !== 'cleaned') return { verdict: 'FAIL', detail: `${cleaned.residue} recorded report(s) remain after clean` };
    if (cleaned.deleted > closed.reports) return { verdict: 'FAIL', detail: 'clean removed more reports than the fence recorded' };
    return { verdict: 'PASS', detail: `fence closed with ${closed.reports} recorded report(s); ${cleaned.deleted} removed, zero remain` };
}

/** The receipt sink this module writes to (the journeys' RwtReceipt satisfies it). */
export interface FenceReceiptSink { row(name: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, unknown>): void }

/**
 * One journey's fence, end to end, in the order Sam's #1859 review requires:
 *   open (confirmed, before the first feedback write) → writer stopped → close (acknowledged) → the journey's own account
 *   deletion and retention-after-deletion proof → clean → INDEPENDENT zero readback.
 * `writable` is the only gate a journey's feedback write may pass: false before a confirmed open, and false again once the
 * writer is stopped. Every row is content-free (counts and states; the run key never leaves the process).
 */
export class JourneyFeedbackFence {
    private runKey: string | null = null;
    private stopped = false;
    private closed: FenceClose | null = null;
    private held: string | null = null;

    constructor(private readonly admin: FenceRpcClient, readonly fenceCase: FenceCase, readonly keyCap: number) {}

    /** Before the first feedback write. True only when the fence is confirmed open for this run-owned account. */
    async open(owner: string, binding: RunBinding | null): Promise<boolean> {
        if (!binding) { this.held = 'no run binding (a local run binds nothing)'; return false; }
        try {
            this.runKey = await openFeedbackFence(this.admin, owner, binding, this.fenceCase, this.keyCap);
            return true;
        } catch (error) {
            this.held = error instanceof Error ? error.message : 'open failed';
            return false;
        }
    }

    get writable(): boolean { return this.runKey !== null && !this.stopped; }
    get isOpen(): boolean { return this.runKey !== null; }
    /** Why no fence is open (for a HOLD row), or null. */
    get heldReason(): string | null { return this.held; }

    /** The open's own row: PASS when confirmed; HOLD otherwise, and the journey then writes no feedback. */
    openRow(sink: FenceReceiptSink): void {
        if (this.isOpen) sink.row('feedback fence open', 'PASS', `the run's feedback fence is confirmed open (cap ${this.keyCap} key(s)) before any feedback write`);
        else sink.row('feedback fence open', 'HOLD', `HOLD before any feedback write: ${this.held ?? 'not opened'}`);
    }

    /** The writer is stopped (every owned page closed, in-flight route handlers drained): no later write may be sent. */
    stopWriter(): void { this.stopped = true; }

    /** Close, acknowledged. Waits in the database for every in-flight insert of the account, then refuses all later ones. */
    async close(sink: FenceReceiptSink): Promise<FenceClose | null> {
        this.stopped = true;
        if (!this.runKey) return null;
        try {
            this.closed = await closeFeedbackFence(this.admin, this.runKey);
            sink.row('feedback fence close', 'PASS', `closed with ${this.closed.reports} recorded report(s) under ${this.closed.keys} key(s)`,
                { reports: this.closed.reports, keys: this.closed.keys });
        } catch (error) {
            sink.row('feedback fence close', 'FAIL', `close was not acknowledged (${error instanceof Error ? error.message : 'error'}); cleanup is not attempted`);
        }
        return this.closed;
    }

    /**
     * After the journey's account deletion (and its retention-after-deletion proof): delete exactly the fence-recorded reports,
     * then verify zero with a separate read-only readback. Never runs without an acknowledged close.
     */
    async cleanRow(sink: FenceReceiptSink, rowName = 'feedback fence cleanup'): Promise<'PASS' | 'FAIL' | 'HOLD'> {
        if (!this.runKey) { sink.row(rowName, 'HOLD', 'no fence was opened, so no feedback was written'); return 'HOLD'; }
        if (!this.closed) {
            sink.row(rowName, 'FAIL', 'the fence was not acknowledged closed; cleanup was not attempted (recovery closes and cleans it by run key)');
            return 'FAIL';
        }
        try {
            const { cleaned, readback } = await cleanAndVerifyFeedbackFence(this.admin, this.runKey);
            const v = fenceCleanupVerdict(this.closed, cleaned, readback);
            sink.row(rowName, v.verdict, v.detail,
                { recorded: this.closed.reports, deleted: cleaned.deleted, remaining: readback.remaining ?? null, foreign: readback.foreign ?? null });
            return v.verdict;
        } catch (error) {
            sink.row(rowName, 'FAIL', `cleanup could not be verified (${error instanceof Error ? error.message : 'error'}); recovery closes and cleans it by run key`);
            return 'FAIL';
        }
    }
}
