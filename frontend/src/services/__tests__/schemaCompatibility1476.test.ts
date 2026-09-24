/* @vitest-environment jsdom */
// #1476 PM directive (point 3): the NEW client against BOTH schemas. Merge deploys the client before the separately
// authorized migration apply, so the client must be correct against Production as it is today AND after the apply.
// A missing server capability is reported as a gap — never as proof that there is no cross-device debt.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const server: { rpc: Rpc } = { rpc: async () => ({ data: null, error: null }) };
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc: (fn: string, args: Record<string, unknown>) => server.rpc(fn, args) }) }));

const MISSING = { code: 'PGRST202', message: 'Could not find the function' };
const NEW_SESSION = { id: 'sess-1', user_id: 'owner-1476', status: 'active' };

/** Production today: lease RPCs from 20260607 exist; creation ignores `lease_id`; no obligations RPC. */
function preApplySchema(opts: { leaseFunctions: boolean } = { leaseFunctions: true }) {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    server.rpc = async (fn, args) => {
        calls.push({ fn, args });
        if (fn.endsWith('_recording_lease')) {
            if (!opts.leaseFunctions) return { data: null, error: MISSING };
            if (fn === 'acquire_recording_lease') return { data: { acquired: true, took_over: false }, error: null };
            return { data: { valid: true, released: true }, error: null };
        }
        if (fn === 'create_session_and_update_usage') return { data: { new_session: NEW_SESSION, usage_exceeded: false }, error: null };
        if (fn === 'get_progress_obligations') return { data: null, error: MISSING };
        return { data: null, error: null };
    };
    return calls;
}

/** After the PO-authorized apply: the fence refuses a take whose lease is not the caller's live lease. */
function postApplySchema(liveLease: () => string | null) {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    server.rpc = async (fn, args) => {
        calls.push({ fn, args });
        if (fn === 'acquire_recording_lease') return { data: { acquired: true, took_over: false }, error: null };
        if (fn.endsWith('_recording_lease')) return { data: { valid: true, released: true }, error: null };
        if (fn === 'create_session_and_update_usage') {
            const lease = (args.p_session_data as Record<string, unknown>).lease_id;
            return lease && lease === liveLease()
                ? { data: { new_session: NEW_SESSION, usage_exceeded: false }, error: null }
                : { data: { new_session: null, usage_exceeded: false, error: 'lease_not_held' }, error: null };
        }
        if (fn === 'get_progress_obligations') return { data: [{ session_id: 'sess-remote', state: 'owed', created_at: '2026-09-23T12:00:00.000Z' }], error: null };
        return { data: null, error: null };
    };
    return calls;
}

async function load() {
    vi.resetModules();
    const lease = await import('../recordingLease');
    const storage = await import('@/lib/storage');
    const obligations = await import('../progress/serverProgressObligations');
    return { lease, storage, obligations };
}
const profile = { id: 'owner-1476' } as never;

beforeEach(() => { localStorage.clear(); });

describe('#1476 — the new client against Production BEFORE the migration apply', () => {
    it('records normally: the lease is acquired and sent, and the current server simply ignores it', async () => {
        const calls = preApplySchema();
        const { lease, storage } = await load();
        expect((await lease.acquireTakeLease()).action).toBe('start');
        const saved = await storage.saveSession({ user_id: 'owner-1476', duration: 0 }, profile, 'private');
        expect(saved.status).toBe('saved');
        const create = calls.find((c) => c.fn === 'create_session_and_update_usage');
        expect((create?.args.p_session_data as Record<string, unknown>).lease_id).toBe(lease.currentTakeLeaseId());
    });

    it('a missing obligations RPC is reported as a CAPABILITY GAP (authority unavailable), never as "nothing owed"', async () => {
        preApplySchema();
        const { obligations } = await load();
        await expect(obligations.hydrateServerProgressObligations('owner-1476', '2026-09-23T12:00:00.000Z'))
            .resolves.toEqual({ ok: true, queued: 0, authority: 'unavailable' });
    });

    it('ROLLOUT GUARD: if Production lacked the 20260607 lease functions, Start still works (no lease held), instead of failing closed for everyone', async () => {
        preApplySchema({ leaseFunctions: false });
        const { lease, storage } = await load();
        expect(await lease.acquireTakeLease()).toEqual({ action: 'start', tookOver: false });
        expect(lease.currentTakeLeaseId(), 'no lease is claimed').toBeNull();
        expect((await storage.saveSession({ user_id: 'owner-1476', duration: 0 }, profile, 'private')).status).toBe('saved');
    });

    it('CONTROL: a real outage of the lease authority still FAILS CLOSED', async () => {
        preApplySchema();
        server.rpc = async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
        const { lease } = await load();
        expect((await lease.acquireTakeLease()).action).toBe('error');
    });
});

describe('#1476 — the new client against the schema AFTER the migration apply', () => {
    it('a take under its own live lease records; the server obligation authority is used', async () => {
        const holder: { id: string | null } = { id: null };
        postApplySchema(() => holder.id);
        const { lease, storage, obligations } = await load();
        await lease.acquireTakeLease();
        holder.id = lease.currentTakeLeaseId();
        expect((await storage.saveSession({ user_id: 'owner-1476', duration: 0 }, profile, 'private')).status).toBe('saved');
        await expect(obligations.hydrateServerProgressObligations('owner-1476', '2026-09-23T12:00:00.000Z'))
            .resolves.toEqual({ ok: true, queued: 1, authority: 'server' });
    });

    it('a take whose lease was taken over is refused with its own truthful reason', async () => {
        postApplySchema(() => 'someone-else');
        const { lease, storage } = await load();
        await lease.acquireTakeLease();
        expect(await storage.saveSession({ user_id: 'owner-1476', duration: 0 }, profile, 'private'))
            .toEqual({ status: 'failed', reason: 'lease_not_held' });
    });
});
