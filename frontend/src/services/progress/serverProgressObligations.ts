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

/** Page size the server allows (it clamps to 50), and the most pages one hydration reads before failing closed. */
export const OBLIGATIONS_PAGE_SIZE = 50;
export const OBLIGATIONS_MAX_PAGES = 20;

type ObligationRow = { session_id: string; state: 'owed' | 'pending'; created_at: string };

/** A usable obligation: a nonempty session id, a recognized state, and a parseable created_at (its keyset cursor). */
function isObligationRow(row: unknown): row is ObligationRow {
    const r = row as Partial<ObligationRow> | null;
    return typeof r?.session_id === 'string' && r.session_id !== ''
        && (r.state === 'owed' || r.state === 'pending')
        && typeof r.created_at === 'string' && !Number.isNaN(Date.parse(r.created_at));
}

export async function hydrateServerProgressObligations(
    userId: string,
    nowIso: string,
    rpc: ObligationsRpc = defaultRpc,
    opts: { isLive?: () => boolean } = {},
): Promise<{ ok: boolean; queued: number; authority: 'server' | 'unavailable'; failure?: 'unpersisted' | 'cancelled' }> {
    // #1476 Codex P1 on 0200e7829: the scan is OWNED by its caller. Once the caller stops owning it (a Start that timed out,
    // a page that went away) a late answer writes nothing — a write nobody publishes would leave debt with no retry.
    const isLive = opts.isLive ?? (() => true);
    // #1476 Codex P1 on 4ceaccf44: EVERY per-session debt must be reachable. One newest-first page would re-list the same
    // newest obligations forever while they stay pending or keep failing, and never reach older ones. Page by the server's
    // keyset cursor (the last row's created_at + session_id) until a short page; an account whose debt does not end
    // within the page bound fails closed — never a partial list presented as the whole.
    const rows: ObligationRow[] = [];
    let cursor: { p_before_created_at: string; p_before_id: string } | null = null;
    for (let page = 0; ; page++) {
        if (page >= OBLIGATIONS_MAX_PAGES) {
            logger.warn('[progress] server obligations exceed the page bound; failing closed');
            return { ok: false, queued: 0, authority: 'server' };
        }
        let data: unknown;
        try {
            const res = await rpc('get_progress_obligations', {
                p_limit: OBLIGATIONS_PAGE_SIZE,
                p_before_created_at: cursor?.p_before_created_at ?? null,
                p_before_id: cursor?.p_before_id ?? null,
            });
            if (res.error) {
                // Between the #1476 merge and its PO-authorized apply the RPC does not exist yet (PostgREST PGRST202). The
                // caller proceeds (blocking every Start until an apply would be a deadlock), but only local debt is known.
                // It is a CAPABILITY GAP — the result says so — never evidence that no cross-device debt exists.
                if (page === 0 && (res.error as { code?: string } | null)?.code === 'PGRST202') return { ok: true, queued: 0, authority: 'unavailable' };
                logger.warn('[progress] server obligations unavailable (non-fatal)');
                return { ok: false, queued: 0, authority: 'server' };
            }
            if (!isLive()) return { ok: false, queued: 0, authority: 'server', failure: 'cancelled' };
            data = res.data;
        } catch {
            return { ok: false, queued: 0, authority: 'server' };
        }
        if (!Array.isArray(data)) return { ok: false, queued: 0, authority: 'server' };
        // PM pre-push return on the pagination packet: a malformed scan is HOLD, never exhaustion. Every row on every
        // page — a short final page included — is validated before the page is accepted, and nothing is enqueued
        // until the whole scan is complete and valid.
        if (!data.every(isObligationRow)) {
            logger.warn('[progress] server obligations contained a malformed row; failing closed');
            return { ok: false, queued: 0, authority: 'server' };
        }
        rows.push(...data);
        if (data.length < OBLIGATIONS_PAGE_SIZE) break;
        const last = data[data.length - 1];
        cursor = { p_before_created_at: last.created_at, p_before_id: last.session_id };
    }

    let queued = 0;
    let unpersisted = 0;
    for (const row of rows) {
        if (enqueueProgressReconcile(row.session_id, userId, nowIso).ok) queued++;
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
