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
        const { cleaned, readback } = await cleanAndVerifyFeedbackFence(admin, runKey);
        total.fences += 1;
        total.deleted += cleaned.deleted;
        // The independent readback decides: a fence it cannot see, or one still holding reports, is residue.
        total.residue += Math.max(cleaned.residue, readback.exists ? (readback.remaining ?? 1) : 1);
        total.foreign += Math.max(cleaned.foreign, readback.foreign ?? 0);
    }
    return total;
}
