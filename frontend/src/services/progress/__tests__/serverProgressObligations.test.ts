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

/** A well-formed server obligation row: the server always returns its created_at (the keyset cursor). */
const ob = (session_id: string, state: 'owed' | 'pending' = 'owed', created_at = NOW) => ({ session_id, state, created_at });

beforeEach(() => { localStorage.clear(); });

describe('#1476 hydrateServerProgressObligations', () => {
    it('CASUALTY (another device\'s debt): owed AND pending server obligations are queued on this device', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        const rpc = vi.fn(async () => ({ data: [ob('s-owed', 'owed'), ob('s-pending', 'pending')], error: null }));
        await expect(hydrateServerProgressObligations(OWNER, NOW, rpc)).resolves.toEqual({ ok: true, queued: 2, authority: 'server' });
        expect(rpc).toHaveBeenCalledWith('get_progress_obligations', { p_limit: 50, p_before_created_at: null, p_before_id: null });
        expect(idsFor(queue)).toEqual(['s-owed', 's-pending']);
    });

    it('CASUALTY (old-tab overwrite): a debt erased from this browser by an old tab\'s v1 write comes back from the server', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        localStorage.setItem('ss_progress_reconcile_queue_v1', JSON.stringify([])); // the old tab's stale write-back
        expect(idsFor(queue), 'this browser alone sees nothing').toEqual([]);
        await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [ob('s-erased', 'owed')], error: null }));
        expect(idsFor(queue)).toEqual(['s-erased']);
    });

    it('idempotent: an obligation already queued is not duplicated and keeps its original state', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        expect(queue.enqueueProgressReconcile('s-1', OWNER, '2026-09-23T11:00:00.000Z').ok).toBe(true);
        await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [ob('s-1', 'owed')], error: null }));
        const r = queue.getQueueEntriesForUser(OWNER);
        expect(r.ok && r.entries).toEqual([expect.objectContaining({ sessionId: 's-1', enqueuedAtIso: '2026-09-23T11:00:00.000Z' })]);
    });

    it('CONTROL (owner isolation): obligations are queued only under the signed-in owner', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [ob('s-1', 'owed')], error: null }));
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

    it('CASUALTY (Codex P1 on 040da46a): a server obligation this device cannot persist fails the load closed', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        const realSet = Storage.prototype.setItem;
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key.startsWith('ss_progress_reconcile_queue_v2|e|')) throw new Error('QuotaExceededError');
            return realSet.call(this, key, value);
        });
        try {
            await expect(hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [ob('s-owed', 'owed')], error: null })))
                .resolves.toEqual({ ok: false, queued: 0, authority: 'server', failure: 'unpersisted' });
        } finally { spy.mockRestore(); }
        expect(idsFor(queue)).toEqual([]);
    });

    it('CASUALTY (PM RETURN on 040da46a): restricted storage (SecurityError) fails closed too — one stored, one not, is still not settled', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        const realSet = Storage.prototype.setItem;
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key.startsWith('ss_progress_reconcile_queue_v2|e|') && key.includes('s-blocked')) {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            }
            return realSet.call(this, key, value);
        });
        try {
            await expect(hydrateServerProgressObligations(OWNER, NOW, async () => ({
                data: [ob('s-stored', 'owed'), ob('s-blocked', 'pending')], error: null,
            }))).resolves.toEqual({ ok: false, queued: 1, authority: 'server', failure: 'unpersisted' });
        } finally { spy.mockRestore(); }
        expect(idsFor(queue)).toEqual(['s-stored']);
    });

    // A stub that ANSWERS THE QUERY like the server: created_at DESC, id ASC, clamped to 1..50, and a keyset cursor that
    // matches that order (older, or the same instant with a greater id). Takes come in PAIRS sharing one created_at.
    const pagedServer = (total: number, pendingNewest: number) => {
        const all = Array.from({ length: total }, (_, i) => ({
            session_id: `s-${String(total - i).padStart(4, '0')}`,
            state: (i < pendingNewest ? 'pending' : 'owed') as 'owed' | 'pending',
            created_at: new Date(Date.parse(NOW) - Math.floor(i / 2) * 60_000).toISOString(),
        })).sort((a, b) => (a.created_at === b.created_at ? (a.session_id < b.session_id ? -1 : 1) : (a.created_at < b.created_at ? 1 : -1)));
        return vi.fn(async (_fn: string, args: Record<string, unknown>) => {
            const limit = Math.min(Math.max(Number(args.p_limit ?? 20), 1), 50);
            const at = args.p_before_created_at as string | null | undefined;
            const id = args.p_before_id as string | null | undefined;
            const after = at == null ? all : all.filter((r) => r.created_at < at || (r.created_at === at && r.session_id > String(id)));
            return { data: after.slice(0, limit), error: null };
        });
    };

    it('CASUALTY (Codex P1 on 4ceaccf44): debt OLDER than the newest page is reached — 120 obligations, the newest 50 stuck pending', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        const rpc = pagedServer(120, 50);
        await expect(hydrateServerProgressObligations(OWNER, NOW, rpc)).resolves.toEqual({ ok: true, queued: 120, authority: 'server' });
        const ids = idsFor(queue);
        expect(ids).toHaveLength(120);
        expect(ids, 'the oldest owed obligation is queued').toContain('s-0001');
        expect(rpc).toHaveBeenCalledTimes(3); // 50 + 50 + 20 (short page ends the walk)
        // Tied pairs straddle the page boundaries: every row is served exactly once — none lost, none repeated.
        const served = (await Promise.all(rpc.mock.results.map((r) => r.value))).flatMap((r) => r.data.map((o: { session_id: string }) => o.session_id));
        expect(served).toHaveLength(120);
        expect(new Set(served).size).toBe(120);
    });

    it('CONTROL: an exact multiple of the page size ends on the empty page', async () => {
        const { hydrateServerProgressObligations } = await load();
        const rpc = pagedServer(100, 0);
        await expect(hydrateServerProgressObligations(OWNER, NOW, rpc)).resolves.toEqual({ ok: true, queued: 100, authority: 'server' });
        expect(rpc).toHaveBeenCalledTimes(3);
    });

    it('fails CLOSED when the debt does not end within the page bound — never a partial list presented as the whole', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        const { OBLIGATIONS_MAX_PAGES, OBLIGATIONS_PAGE_SIZE } = await import('../serverProgressObligations');
        const rpc = pagedServer(OBLIGATIONS_MAX_PAGES * OBLIGATIONS_PAGE_SIZE + 1, 0);
        await expect(hydrateServerProgressObligations(OWNER, NOW, rpc)).resolves.toEqual({ ok: false, queued: 0, authority: 'server' });
        expect(rpc).toHaveBeenCalledTimes(OBLIGATIONS_MAX_PAGES);
        expect(idsFor(queue)).toEqual([]);
    });

    it('fails CLOSED on a full page whose last row carries no cursor, and on an error in a later page', async () => {
        const { hydrateServerProgressObligations } = await load();
        const full = Array.from({ length: 50 }, (_, i) => ({ session_id: `s-${i}`, state: 'owed' }));
        await expect(hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: full, error: null })))
            .resolves.toEqual({ ok: false, queued: 0, authority: 'server' });
        const server = pagedServer(80, 0);
        let calls = 0;
        const flaky = vi.fn(async (fn: string, args: Record<string, unknown>) => (++calls === 2
            ? { data: null, error: { code: 'PGRST202', message: 'gone mid-walk' } } : server(fn, args)));
        await expect(hydrateServerProgressObligations(OWNER, NOW, flaky)).resolves.toEqual({ ok: false, queued: 0, authority: 'server' });
    });

    it.each<[string, Record<string, unknown> | null]>([
        ['empty session_id', { session_id: '', state: 'owed', created_at: NOW }],
        ['missing session_id', { state: 'owed', created_at: NOW }],
        ['unrecognized state', { session_id: 's-x', state: 'settled', created_at: NOW }],
        ['missing created_at', { session_id: 's-x', state: 'owed' }],
        ['unparseable created_at', { session_id: 's-x', state: 'owed', created_at: 'not-a-time' }],
        ['null row', null],
    ])('CASUALTY (PM pre-push return): a malformed row (%s) on a SHORT final page is HOLD, never exhaustion — nothing queued', async (_label, row) => {
        const { queue, hydrateServerProgressObligations } = await load();
        const result = await hydrateServerProgressObligations(OWNER, NOW, async () => ({ data: [ob('s-ok'), row], error: null }));
        expect(result).toEqual({ ok: false, queued: 0, authority: 'server' });
        expect(idsFor(queue)).toEqual([]); // the valid row on the same page is not queued either
    });

    it('CASUALTY (PM pre-push return): a malformed row on a LATER short page fails the whole scan — earlier valid pages are not queued', async () => {
        const { queue, hydrateServerProgressObligations } = await load();
        const server = pagedServer(60, 0);
        const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
            const res = await server(fn, args);
            return args.p_before_created_at == null ? res : { data: [...res.data.slice(0, 5), { session_id: '', state: 'owed', created_at: NOW }], error: null };
        });
        await expect(hydrateServerProgressObligations(OWNER, NOW, rpc)).resolves.toEqual({ ok: false, queued: 0, authority: 'server' });
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(idsFor(queue)).toEqual([]);
    });
});
