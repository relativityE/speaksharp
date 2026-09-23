/**
 * #1476 — PROGRESS IS OWED PER COMPLETED SESSION, AND THE SERVER OWNS THE TRUTH.
 *
 * `get_progress_obligations()` lists this account's completed takes with no Progress evaluation, as `owed` (attribution
 * terminal: settle it now) or `pending` (attribution not terminal: `record_progress_evaluation` returns NULL, which is
 * NOT settlement). Loading them into this device's own queue means debt recorded on another device — or erased from
 * this browser by an old tab's v1 write — is still owed here, and runs through the existing bounded retry and release
 * (RWT-20). Idempotent: an obligation already queued keeps its original entry.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import { enqueueProgressReconcile } from './progressReconcileQueue';

export type ObligationsRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const defaultRpc: ObligationsRpc = async (fn, args) => {
    const { data, error } = await getSupabaseClient().rpc(fn, args);
    return { data, error };
};

export async function hydrateServerProgressObligations(
    userId: string,
    nowIso: string,
    rpc: ObligationsRpc = defaultRpc,
): Promise<{ ok: boolean; queued: number; authority: 'server' | 'unavailable'; failure?: 'unpersisted' }> {
    let rows: unknown = null;
    try {
        const { data, error } = await rpc('get_progress_obligations', { p_limit: 20 });
        if (error) {
            // Between the #1476 merge and its PO-authorized apply the RPC does not exist yet (PostgREST PGRST202). The
            // caller proceeds (blocking every Start until an apply would be a deadlock), but only local debt is known.
            // It is a CAPABILITY GAP — the result says so — never evidence that no cross-device debt exists.
            if ((error as { code?: string } | null)?.code === 'PGRST202') return { ok: true, queued: 0, authority: 'unavailable' };
            logger.warn('[progress] server obligations unavailable (non-fatal)');
            return { ok: false, queued: 0, authority: 'server' };
        }
        rows = data;
    } catch {
        return { ok: false, queued: 0, authority: 'server' };
    }
    if (!Array.isArray(rows)) return { ok: false, queued: 0, authority: 'server' };

    let queued = 0;
    let unpersisted = 0;
    for (const row of rows) {
        const sessionId = (row as { session_id?: unknown } | null)?.session_id;
        if (typeof sessionId !== 'string' || sessionId === '') continue;
        if (enqueueProgressReconcile(sessionId, userId, nowIso).ok) queued++;
        else unpersisted++;
    }
    // #1476 Codex P1 on 040da46a: a server-confirmed obligation this device could not persist (quota, blocked storage)
    // is NOT settled — the durable-queue check at Start would not see it. Fail closed.
    if (unpersisted > 0) {
        logger.warn({ unpersisted }, '[progress] server obligations could not be persisted locally');
        return { ok: false, queued, authority: 'server', failure: 'unpersisted' };
    }
    return { ok: true, queued, authority: 'server' };
}
