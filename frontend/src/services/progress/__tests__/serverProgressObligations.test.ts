/* @vitest-environment jsdom */
// #1476 — the SERVER owns per-session Progress obligations (`get_progress_obligations`). A device loads them into its own
// queue, so debt recorded by another device — or hidden from a browser by an old tab's v1 overwrite — is still owed here
// and runs through the existing bounded retry. The RPC is injected; content-free synthetic identifiers only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

const OWNER = 'owner-1476';
const OTHER = 'owner-1476-other';
const NOW = '2026-09-23T12:00:00.000Z';

async function load() {
    vi.resetModules();
    const queue = await import('../progressReconcileQueue');
    const { hydrateServerProgressObligations } = await import('../serverProgressObligations');
    return { queue, hydrateServerProgressObligations };
}
const idsFor = (queue: Awaited<ReturnType<typeof load>>['queue'], owner = OWNER) => {
    const r = queue.getQueueEntriesForUser(owner);
    if (!r.ok) throw new Error(r.failure);
    return r.entries.map((e) => e.sessionId).sort();
};

beforeEach(() => { localStorage.clear(); });

describe('#1476 hydrateServerProgressObligations', () => {
    it('CASUALTY (another device\'s debt): owed AND pending server obligations are queued on this device', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        const rpc = vi.fn(async () => ({ data: [{ session_id: 's-owed', state: 'owed' }, { session_id: 's-pending', state: 'pending' }], error: null }));
        await expect(hydrateServerProgressObligations(OWNER, NOW, rpc)).resolves.toEqual({ ok: true, queued: 2, authority: 'server' });
        expect(rpc).toHaveBeenCalledWith('get_progress_obligations', { p_limit: 20 });
        expect(idsFor(queue)).toEqual(['s-owed', 's-pending']);
    });

    it('CASUALTY (old-tab overwrite): a debt erased from this browser by an old tab\'s v1 write comes back from the server', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        localStorage.setItem('ss_progress_reconcile_queue_v1', JSON.stringify([])); // the old tab's stale write-back
        expect(idsFor(queue), 'this browser alone sees nothing').toEqual([]);
        await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [{ session_id: 's-erased', state: 'owed' }], error: null }));
        expect(idsFor(queue)).toEqual(['s-erased']);
    });

    it('idempotent: an obligation already queued is not duplicated and keeps its original state', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        expect(queue.enqueueProgressReconcile('s-1', OWNER, '2026-09-23T11:00:00.000Z').ok).toBe(true);
        await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [{ session_id: 's-1', state: 'owed' }], error: null }));
        const r = queue.getQueueEntriesForUser(OWNER);
        expect(r.ok && r.entries).toEqual([expect.objectContaining({ sessionId: 's-1', enqueuedAtIso: '2026-09-23T11:00:00.000Z' })]);
    });

    it('CONTROL (owner isolation): obligations are queued only under the signed-in owner', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [{ session_id: 's-1', state: 'owed' }], error: null }));
        expect(idsFor(queue, OTHER)).toEqual([]);
    });

    it('an unavailable server changes nothing and says so (no fabricated clean state)', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        await expect(hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: null, error: { message: 'down' } })))
            .resolves.toEqual({ ok: false, queued: 0, authority: 'server' });
        expect(idsFor(queue)).toEqual([]);
    });

    it('CONTROL (merge before apply): a server without the RPC yet (PGRST202) is an explicit CAPABILITY GAP — never "no debt"', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        await expect(hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })))
            .resolves.toEqual({ ok: true, queued: 0, authority: 'unavailable' });
        expect(idsFor(queue)).toEqual([]);
    });

    it('a malformed server row is ignored, never queued under a guessed id', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [{ session_id: '', state: 'owed' }, { state: 'owed' }, { session_id: 's-ok', state: 'owed' }], error: null }));
        expect(idsFor(queue)).toEqual(['s-ok']);
    });
});
