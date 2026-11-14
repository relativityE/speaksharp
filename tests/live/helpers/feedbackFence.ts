/**
 * #1811 AHT-02/07/08 recoverable feedback: the journey side of the transactional run fence (20261114100000).
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

export type FenceCase = 'AHT-02' | 'AHT-07' | 'AHT-08' | 'AHT-07+AHT-08';
export const FENCE_CASES: readonly FenceCase[] = Object.freeze(['AHT-02', 'AHT-07', 'AHT-08', 'AHT-07+AHT-08']);

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

/** Open the run's fence for its run-owned account. Throws (fail closed) unless the database returns the expected run key. */
export async function openFeedbackFence(
    admin: FenceRpcClient, owner: string, binding: RunBinding, fenceCase: FenceCase, keyCap: number,
): Promise<string> {
    if (!Number.isInteger(keyCap) || keyCap < 1 || keyCap > 8) throw new Error('feedback fence: key cap outside 1..8');
    const expected = fenceRunKey(binding, fenceCase);
    const { data, error } = await admin.rpc('open_rwt_feedback_fence_v1',
        { p_owner: owner, p_binding: binding, p_case: fenceCase, p_key_cap: keyCap });
    if (error) throw failure('open', error);
    if (data !== expected) throw new Error('feedback fence open returned an unexpected run key (fail closed)');
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
 * The receipt verdict for a cleaned fence. PASS only when the readback is zero, no recorded report belongs to another
 * account, the fence is `cleaned`, and the deletion matches what the closed fence recorded.
 */
export function fenceCleanupVerdict(closed: FenceClose | null, cleaned: FenceClean | null): { verdict: 'PASS' | 'FAIL'; detail: string } {
    if (!closed) return { verdict: 'FAIL', detail: 'the feedback fence was never closed' };
    if (!cleaned) return { verdict: 'FAIL', detail: 'the feedback fence was not cleaned' };
    if (cleaned.foreign !== 0) return { verdict: 'FAIL', detail: `${cleaned.foreign} recorded report(s) now belong to another account; left untouched` };
    if (cleaned.residue !== 0 || cleaned.state !== 'cleaned') return { verdict: 'FAIL', detail: `${cleaned.residue} recorded report(s) remain after clean` };
    if (cleaned.deleted > closed.reports) return { verdict: 'FAIL', detail: 'clean removed more reports than the fence recorded' };
    return { verdict: 'PASS', detail: `fence closed with ${closed.reports} recorded report(s); ${cleaned.deleted} removed, zero remain` };
}

export interface FenceRecovery { fences: number; deleted: number; residue: number; foreign: number }

/**
 * Recovery for a runner lost mid-journey: close and clean every fence this run binding could have opened (one per case
 * label; close and clean are idempotent, and an unknown run key — `P0002` — means that case opened none). Run BEFORE the
 * account deletion, so the account's reports are still owned. Counts only.
 */
export async function recoverRunFences(admin: FenceRpcClient, binding: Pick<RunBinding, 'runId' | 'runAttempt'>): Promise<FenceRecovery> {
    const total: FenceRecovery = { fences: 0, deleted: 0, residue: 0, foreign: 0 };
    for (const fenceCase of FENCE_CASES) {
        const runKey = fenceRunKey(binding, fenceCase);
        const closed = await admin.rpc('close_rwt_feedback_fence_v1', { p_run_key: runKey });
        if (closed.error?.code === 'P0002') continue;
        if (closed.error) throw failure('recovery close', closed.error);
        const cleaned = await cleanFeedbackFence(admin, runKey);
        total.fences += 1;
        total.deleted += cleaned.deleted;
        total.residue += cleaned.residue;
        total.foreign += cleaned.foreign;
    }
    return total;
}
