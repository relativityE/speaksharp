// @vitest-environment node
/**
 * AHT-02..15 run on 2026-11-12 (rc-gates runs 43156311609 … 43156426616): eight of eleven run-owned accounts stopped at
 * `delete_user`. The cause is the #1643 deletion guard (`account_save_delete_guard`, BEFORE DELETE ON auth.users), which
 * refuses while any `account_save_obligations` row of the account is not `completed`. These controls drive the REAL cleanup
 * against a fake admin that models that guard, the two obligation triggers and the #1476 fence exactly as the migrations
 * write them (a leased take closed as `failed` refuses every later save), plus saves that were sent before the pages closed and
 * are admitted only later (no timer bounds that; Sam's review of v2). A second block
 * drives the settlement through the REAL supabase-js query builder over a fake fetch. Nothing reaches Supabase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { RunBinding } from '../live/helpers/runBinding';
import {
    classifyTakes, cleanupFailureStep, cleanupRunOwnedAccount, leaseOnlyTakes, settleRunOwnedTakes, writerAfter,
    type StoppedTakeProof, type TakeRow,
} from '../live/helpers/runOwnedCleanup';
import { RWT_ACCOUNT_PREFIX } from '../live/helpers/rwtJourney';

const ENV = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '42800000001', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main' };
const B: RunBinding = { repository: ENV.GITHUB_REPOSITORY, workflow: ENV.GITHUB_WORKFLOW_REF, runId: ENV.GITHUB_RUN_ID, runAttempt: '1', role: 'rwt-journey' };
const EMAIL = `${RWT_ACCOUNT_PREFIX}open-mic-1794310000000-42800000001@example.com`;
const UID = '00000000-0000-4000-8000-000000000001';
const L1 = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const S1 = '20000000-0000-4000-8000-000000000001';
const S2 = '20000000-0000-4000-8000-000000000002';

/** The harness clock: pages close at T0, takes were made before it. */
const T0 = Date.parse('2026-11-12T04:45:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Session = TakeRow & { user_id: string; transcript: string | null };
type Lease = { lease_id: string; heartbeat_at: string };

/**
 * A fake production account. `obligations` follows 20261020230653 exactly: a held lease writes `admitted`; a session writes
 * `completed` when completed, or failed under a lease or fence, else keeps the identity's phase. A released lease leaves its
 * obligation behind. `deleteUser` raises the guard's generic auth error while any is unsettled. `save()` is the product's
 * completion under `_ss_fence_session_writes_1476`: a leased take already `failed` refuses it (the save is LOST).
 * `delayedSaves` were sent before the pages closed and never answered: the server admits them only when deletion is tried,
 * after every cleanup write (the worst order). `raceOnUpdate` lands a save just before the cleanup's write.
 */
function account(o: { sessions?: Session[]; heldLeases?: Lease[]; releasedLeases?: string[]; email?: string; meta?: Record<string, unknown>;
    delayedSaves?: string[]; raceOnUpdate?: string } = {}) {
    const sessions = (o.sessions ?? []).map((s) => ({ ...s }));
    const held = (o.heldLeases ?? []).map((l) => ({ ...l }));
    const obligations = new Map<string, 'admitted' | 'completed'>();
    for (const l of [...held.map((h) => h.lease_id), ...(o.releasedLeases ?? [])]) obligations.set(l, 'admitted');
    const phaseOf = (s: Session): 'admitted' | 'completed' =>
        s.status === 'completed' || (s.status === 'failed' && (s.lease_id !== null || s.recording_fenced_at !== null)) ? 'completed' : 'admitted';
    const bind = (s: Session) => {
        const identity = s.lease_id ?? s.id;
        obligations.set(identity, phaseOf(s) === 'completed' ? 'completed' : (obligations.get(identity) ?? 'admitted'));
    };
    sessions.forEach(bind);
    const saves = { landed: 0, lost: 0 };
    const save = (id: string) => {
        const s = sessions.find((x) => x.id === id);
        if (!s) return;
        if (s.status === 'failed' && (s.lease_id !== null || s.recording_fenced_at !== null)) { saves.lost += 1; return; } // lease_revoked
        s.status = 'completed'; bind(s); saves.landed += 1;
    };
    const delayed = [...(o.delayedSaves ?? [])];
    let raced = false;
    let deleted = false;
    const updates: Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }> = [];
    const meta = o.meta ?? { provider: 'email', ct_run: B };
    const admin = {
        auth: { admin: {
            listUsers: async () => ({ data: { users: [] }, error: null }),
            getUserById: async () => (deleted
                ? { data: null, error: { status: 404, code: 'user_not_found', message: 'User not found' } }
                : { data: { user: { id: UID, email: o.email ?? EMAIL, app_metadata: meta, created_at: '2026-01-01T00:00:00Z' } }, error: null }),
            deleteUser: vi.fn(async () => {
                while (delayed.length) save(delayed.shift()!);
                if ([...obligations.values()].some((p) => p !== 'completed')) return { error: { message: 'Database error deleting user' } };
                deleted = true; return { error: null };
            }),
        } },
        from: (table: string) => ({
            delete: () => ({ eq: async () => ({ error: null }) }),
            select: (columns: string) => ({ eq: async (_c: string, uid: unknown) => {
                if (table === 'sessions' && columns === 'id,status,lease_id,recording_fenced_at,created_at,expires_at,updated_at') {
                    return { data: sessions.filter((s) => s.user_id === uid)
                        .map(({ id, status, lease_id, recording_fenced_at, created_at, expires_at, updated_at }) => ({ id, status, lease_id, recording_fenced_at, created_at, expires_at, updated_at })), count: null, error: null };
                }
                if (table === 'active_recording_lease' && columns === 'lease_id,heartbeat_at') return { data: held.map((l) => ({ ...l })), count: null, error: null };
                return { count: 0, error: null };
            } }),
            update(this: unknown, values: Record<string, unknown>) {
                // Like the real builder, `update` needs its receiver: a detached call has no table to write to.
                if (!this || (this as { table?: string }).table !== table) throw new TypeError("Cannot read properties of undefined (reading 'url')");
                const filters: Record<string, unknown> = {};
                const chain = {
                    eq: (c: string, v: unknown) => { filters[c] = v; return chain; },
                    // Like PostgREST's `return=representation`: only the rows this write changed come back.
                    select: async (columns: string) => {
                        if (o.raceOnUpdate && !raced) { raced = true; save(o.raceOnUpdate); }
                        updates.push({ values, filters: { ...filters } });
                        const changed: Array<Record<string, unknown>> = [];
                        for (const s of sessions) {
                            if (Object.entries(filters).every(([k, v]) => (s as unknown as Record<string, unknown>)[k] === v)) {
                                Object.assign(s, values); bind(s); changed.push({ [columns]: s.id });
                            }
                        }
                        return { data: changed, error: null };
                    },
                };
                return chain;
            },
            table,
        }),
    };
    const proof = (closedAt: number | null = T0, unsettled: { sessionIds: string[]; unnamed: number } | null = { sessionIds: [...(o.delayedSaves ?? [])], unnamed: 0 }): StoppedTakeProof =>
        ({ writersClosedAt: () => closedAt, unsettledSaves: () => unsettled });
    return { admin, updates, sessions, obligations, saves, proof, deleteUser: admin.auth.admin.deleteUser };
}

const run = (admin: unknown, stoppedTakes?: StoppedTakeProof, recovery?: Parameters<typeof cleanupRunOwnedAccount>[0]['recovery']) =>
    cleanupRunOwnedAccount({ admin: admin as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: RWT_ACCOUNT_PREFIX, stoppedTakes, recovery });
const stepOf = async (p: Promise<unknown>) => p.then(() => 'resolved', (e) => cleanupFailureStep(e));
const take = (id: string, status: string, lease: string | null, fenced: string | null = null, createdAt = T0 - 120_000): Session =>
    ({ id, user_id: UID, status, lease_id: lease, recording_fenced_at: fenced, created_at: iso(createdAt), transcript: 'kept' });
const stale = (lease: string): Lease => ({ lease_id: lease, heartbeat_at: iso(T0 - 1_000) });

beforeEach(() => { for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v); vi.spyOn(console, 'log').mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('run-owned cleanup closes only STOPPED takes of a run-bound synthetic journey before the #1643 guard', () => {
    it('AHT-10 shape: a take left active under its lease (tab closed) is closed as failed with no wait, then the account deletes', async () => {
        const a = account({ sessions: [take(S1, 'completed', L1), take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.updates).toEqual([{ values: { status: 'failed' }, filters: { id: S2, user_id: UID, status: 'active' } }]);
        expect(a.sessions.find((s) => s.id === S2)?.transcript).toBe('kept');
        expect(a.sessions.find((s) => s.id === S1)?.status).toBe('completed');
        expect(console.log).toHaveBeenCalledWith('RUN_TAKE_SETTLEMENT closed=1 not_stopped=0 unsettleable=0 lease_only=0');
    });

    it('AHT-05/06 shape: a fenced take still open is closed; an already failed leased take is left alone', async () => {
        const a = account({ sessions: [take(S1, 'failed', L1), take(S2, 'active', null, iso(T0 - 60_000))] });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.updates.map((u) => u.filters.id)).toEqual([S2]);
    });

    it('AHT-03/09/11 shape (every take saved): no write, and the account deletes as before', async () => {
        const a = account({ sessions: [take(S1, 'completed', L1), take(S2, 'completed', L2)] });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.updates).toEqual([]);
    });

    it('CONTROL (Sam, v2 review): a save sent before the close and admitted LATE is never closed first, and it lands', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)], delayedSaves: [S2] });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.updates).toEqual([]);
        expect(a.saves).toEqual({ landed: 1, lost: 0 });
        expect(a.sessions[0].status).toBe('completed');
    });

    it('CONTROL: the same delayed save IS lost if the cleanup closes its take first (why an unanswered save blocks its close)', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)], delayedSaves: [S2] });
        await expect(run(a.admin, a.proof(T0, { sessionIds: [], unnamed: 0 }))).resolves.toBe(UID); // a tap that missed it
        expect(a.saves).toEqual({ landed: 0, lost: 1 });
    });

    it('a delayed save of one take leaves the other stopped take closable', async () => {
        const a = account({ sessions: [take(S1, 'active', L1), take(S2, 'active', L2)], heldLeases: [stale(L1), stale(L2)], delayedSaves: [S2] });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.updates.map((u) => u.filters.id)).toEqual([S1]);
        expect(a.saves).toEqual({ landed: 1, lost: 0 });
    });

    it('an unanswered save whose take cannot be read from its request refuses every close', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        expect(await stepOf(run(a.admin, a.proof(T0, { sessionIds: [], unnamed: 1 })))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('saves that were never observed (no tap) refuse every close', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        expect(await stepOf(run(a.admin, a.proof(T0, null)))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('RACE: a save that lands between the read and the close still wins, and closed counts 0 rows changed', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)], raceOnUpdate: S2 });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.saves).toEqual({ landed: 1, lost: 0 });
        expect(a.sessions[0].status).toBe('completed');
        expect(a.updates).toHaveLength(1); // the write was sent, matched nothing
        expect(console.log).toHaveBeenCalledWith('RUN_TAKE_SETTLEMENT closed=0 not_stopped=0 unsettleable=0 lease_only=0');
    });

    it.each([
        ['1 s after the close', T0 + 1_000],
        ['60 s after the close (Sam\'s repro: older than any quiet window before the read)', T0 + 60_000],
        ['10 minutes after the close', T0 + 600_000],
    ])('NOT STOPPED: a lease heartbeat %s refuses every close', async (_n, at) => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [{ lease_id: L2, heartbeat_at: iso(at) }] });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('a lease heartbeat at the close itself, or before it, is the stopped page\'s own and allows the close', async () => {
        for (const at of [T0, T0 - 600_000]) {
            const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [{ lease_id: L2, heartbeat_at: iso(at) }] });
            await expect(run(a.admin, a.proof())).resolves.toBe(UID);
            expect(a.updates).toHaveLength(1);
        }
    });

    it('NOT STOPPED: a session heartbeat after the close (expiry past close + 5 min) refuses every close', async () => {
        const a = account({ sessions: [{ ...take(S2, 'active', L2), expires_at: iso(T0 + 5 * 60_000 + 1_000) }], heldLeases: [stale(L2)] });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('a session heartbeat just before the close (expiry before close + 5 min) allows the close', async () => {
        const a = account({ sessions: [{ ...take(S2, 'active', L2), expires_at: iso(T0 - 1_000 + 5 * 60_000) }], heldLeases: [stale(L2)] });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.updates).toHaveLength(1);
    });

    it('NOT STOPPED: without the pages-closed proof nothing is written, and the open take is named', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        expect(await stepOf(run(a.admin, a.proof(null)))).toBe('delete_user_unsettled_take');
        await expect(run(account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] }).admin, a.proof(null)))
            .rejects.toThrow(/unsettleable=0 lease_only=0 not_stopped=1/);
        expect(a.updates).toEqual([]);
    });

    it('NOT STOPPED: a caller that does not opt in (every non-RWT proof) only reads', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        expect(await stepOf(run(a.admin))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('NOT STOPPED: a page reopened before the fresh read withdraws the proof, and nothing is written', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        let reads = 0;
        const proof: StoppedTakeProof = { ...a.proof(), writersClosedAt: () => (reads++ === 0 ? T0 : null) };
        expect(await stepOf(run(a.admin, proof))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('NOT STOPPED: a close moment that moved (pages reopened and closed again) withdraws the proof', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        let reads = 0;
        const proof: StoppedTakeProof = { ...a.proof(), writersClosedAt: () => (reads++ === 0 ? T0 : T0 + 5) };
        expect(await stepOf(run(a.admin, proof))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('NOT RUN-OWNED: a take created after the pages closed is not this journey\'s, and nothing is written', async () => {
        const a = account({ sessions: [take(S1, 'active', L1), take(S2, 'active', L2, null, T0 + 30_000)] });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('NOT RUN-BOUND: an unbound (local) account never has a take closed, even with the proof', async () => {
        vi.stubEnv('GITHUB_ACTIONS', undefined as unknown as string);
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)], meta: { provider: 'email' } });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('AHT-04/12/13/14 shape: a held lease with no take is NOT settled from here and is named, not hidden', async () => {
        const a = account({ heldLeases: [stale(L1)] });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user_unsettled_take');
        await expect(run(account({ heldLeases: [stale(L1)] }).admin, a.proof())).rejects.toThrow(/unsettleable=0 lease_only=1 not_stopped=0/);
        expect(a.updates).toEqual([]);
    });

    it('a RELEASED lease with no take is invisible to service_role: the generic delete_user code stays (no false diagnosis)', async () => {
        const a = account({ releasedLeases: [L1] });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user');
    });

    it('a legacy take with no lease and no fence cannot be settled by a status write: no write, named as unsettleable', async () => {
        const a = account({ sessions: [take(S1, 'active', null)] });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
    });

    it('CASUALTY: an account whose email is not the run-owned one is refused before any take is touched', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], email: 'someone@example.test' });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('uid_email_disagreement');
        expect(a.updates).toEqual([]);
        expect(a.deleteUser).not.toHaveBeenCalled();
    });

    it('CASUALTY: an account bound to another run is refused before any take is touched', async () => {
        const a = account({ sessions: [take(S2, 'active', L2)], meta: { provider: 'email', ct_run: { ...B, runId: '42800000009' } } });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('run_binding_mismatch');
        expect(a.updates).toEqual([]);
    });

    it('NOT STOPPED (security review of v3, low 1): an open take written after the close (an at-cap heartbeat writes only updated_at) refuses', async () => {
        const a = account({ sessions: [{ ...take(S2, 'active', L2), updated_at: iso(T0 + 2_000) }], heldLeases: [stale(L2)] });
        expect(await stepOf(run(a.admin, a.proof()))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
        expect(console.log).toHaveBeenCalledWith('RUN_TAKE_SETTLEMENT closed=0 not_stopped=1 unsettleable=0 lease_only=0 refused=writer_after_close');
    });

    it('a SETTLED take written after the close (for example coaching on a saved take) is not a writer to the open one', async () => {
        const a = account({ sessions: [{ ...take(S1, 'completed', L1), updated_at: iso(T0 + 60_000) }, { ...take(S2, 'active', L2), updated_at: iso(T0 - 1_000) }], heldLeases: [stale(L2)] });
        await expect(run(a.admin, a.proof())).resolves.toBe(UID);
        expect(a.updates.map((u) => u.filters.id)).toEqual([S2]);
    });

    it.each([
        ['pages_open', (a: ReturnType<typeof account>) => a.proof(null)],
        ['saves_unobserved', (a: ReturnType<typeof account>) => a.proof(T0, null)],
        ['save_unnamed', (a: ReturnType<typeof account>) => a.proof(T0, { sessionIds: [], unnamed: 2 })],
    ])('a refused close names its reason, counts only: %s', async (reason, proofOf) => {
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        await stepOf(run(a.admin, proofOf(a)));
        expect(console.log).toHaveBeenCalledWith(`RUN_TAKE_SETTLEMENT closed=0 not_stopped=1 unsettleable=0 lease_only=0 refused=${reason}`);
        expect(a.updates).toEqual([]);
    });

    it('an unanswered save naming its take in UPPER case still keeps that take open (ids compare case-insensitively)', async () => {
        const HEX = 'abcdef00-0000-4000-8000-0000000000ab'; // ids with letters, so case can differ
        const a = account({ sessions: [take(HEX, 'active', L2)], heldLeases: [stale(L2)], delayedSaves: [HEX] });
        await expect(run(a.admin, a.proof(T0, { sessionIds: [HEX.toUpperCase()], unnamed: 0 }))).resolves.toBe(UID);
        expect(a.updates).toEqual([]);
        expect(a.saves).toEqual({ landed: 1, lost: 0 });
    });

    it('RECOVERY (info 6): the interrupted-run recovery path never closes a take, even when handed a stopped proof', async () => {
        const sha = 'a'.repeat(40);
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: Number(B.runId), run_attempt: 1,
            repository: { full_name: B.repository }, path: '.github/workflows/rc-gates.yml', status: 'completed', conclusion: 'cancelled' }) })));
        for (const [k, v] of Object.entries({ GITHUB_RUN_ID: '42800000009', GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main' })) vi.stubEnv(k, v);
        const a = account({ sessions: [take(S2, 'active', L2)], heldLeases: [stale(L2)] });
        const recovery = { originalBinding: B, dispatchSha: sha, deleteAck: `RWT-INTERRUPTED-RUN-RECOVERY-DELETE@${sha}`, minAgeMs: 135 * 60_000 };
        expect(await stepOf(run(a.admin, a.proof(), recovery))).toBe('delete_user_unsettled_take');
        expect(a.updates).toEqual([]);
        expect(a.deleteUser).toHaveBeenCalledTimes(1); // it reached deletion: the refusal is the guard's, not an eligibility stop
    });

    const unreadable = (a: ReturnType<typeof account>) => {
        const from = a.admin.from;
        (a.admin as { from: unknown }).from = (t: string) => (t === 'sessions'
            ? { ...from(t), select: (columns: string) => (columns.startsWith('id,status,')
                ? { eq: async () => ({ data: null, count: null, error: { message: 'x' } }) } : from(t).select(columns)) }
            : from(t));
    };

    it('an opted-in caller whose sessions read fails stops as settle_takes, before deletion', async () => {
        const a = account();
        unreadable(a);
        expect(await stepOf(run(a.admin, a.proof()))).toBe('settle_takes');
        expect(a.deleteUser).not.toHaveBeenCalled();
    });

    it('a caller that does not opt in only reads to name a refusal: its read failing never blocks the deletion (low 2)', async () => {
        const a = account({ sessions: [take(S1, 'completed', L1)] });
        unreadable(a);
        await expect(run(a.admin)).resolves.toBe(UID);
        expect(a.deleteUser).toHaveBeenCalledTimes(1);
        expect(console.log).not.toHaveBeenCalledWith(expect.stringMatching(/^RUN_TAKE_SETTLEMENT/));
    });
});

describe('the settlement through the REAL supabase-js query builder (fake fetch, nothing leaves the process)', () => {
    function realClient(rows: Array<Record<string, unknown>>, leases: Array<Record<string, unknown>>) {
        const requests: Array<{ method: string; path: string; params: Record<string, string>; body: unknown }> = [];
        const fetchFake = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
            const method = (init?.method ?? 'GET').toUpperCase();
            const params = Object.fromEntries(url.searchParams.entries());
            const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
            requests.push({ method, path: url.pathname, params, body });
            let data: unknown = [];
            if (url.pathname.endsWith('/sessions') && method === 'GET') data = rows.map((r) => ({ ...r }));
            if (url.pathname.endsWith('/active_recording_lease') && method === 'GET') data = leases;
            if (url.pathname.endsWith('/sessions') && method === 'PATCH') {
                const changed: Array<Record<string, unknown>> = [];
                for (const r of rows) {
                    if (`eq.${r.id}` === params.id && `eq.${r.user_id}` === params.user_id && `eq.${r.status}` === params.status) { Object.assign(r, body); changed.push({ id: r.id }); }
                }
                data = changed;
            }
            return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
        };
        const client = createClient('http://127.0.0.1:54321', 'offline-test-key', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchFake as typeof fetch },
        });
        return { client, requests };
    }

    const stopped: StoppedTakeProof = { writersClosedAt: () => T0, unsettledSaves: () => ({ sessionIds: [], unnamed: 0 }) };

    it('sends exactly one PATCH sessions?id=eq.<take>&user_id=eq.<uid>&status=eq.active&select=id with {status: failed}, and no TypeError', async () => {
        const row = { id: S2, user_id: UID, status: 'active', lease_id: L2, recording_fenced_at: null, created_at: iso(T0 - 120_000), expires_at: iso(T0 + 60_000) };
        const { client, requests } = realClient([row], [stale(L2)]);
        const out = await settleRunOwnedTakes(client as never, UID, { runBound: true, stopped });
        const patches = requests.filter((r) => r.method === 'PATCH');
        expect(patches).toEqual([{ method: 'PATCH', path: '/rest/v1/sessions',
            params: { id: `eq.${S2}`, user_id: `eq.${UID}`, status: 'eq.active', select: 'id' }, body: { status: 'failed' } }]);
        expect(out).toEqual({ closed: 1, unsettleable: 0, leaseOnly: 0, notStopped: 0 });
        expect(row.status).toBe('failed');
    });

    it('CONTROL: the detached form the first patch used throws a TypeError before any request', async () => {
        const { client, requests } = realClient([], []);
        const update = client.from('sessions').update;
        expect(() => update({ status: 'failed' })).toThrow(TypeError);
        expect(requests).toEqual([]);
    });

    it('a PATCH that changes no row (a save landed first) counts 0 closed and leaves the take as the save left it', async () => {
        const row = { id: S2, user_id: UID, status: 'active', lease_id: L2, recording_fenced_at: null, created_at: iso(T0 - 120_000), expires_at: null };
        const { client, requests } = realClient([row], [stale(L2)]);
        const fetchCount = requests.length;
        // The save lands after the fresh read and before the write: the write's status=eq.active then matches nothing.
        const proof: StoppedTakeProof = { ...stopped, writersClosedAt: () => { if (requests.length > fetchCount + 2) row.status = 'completed'; return T0; } };
        const out = await settleRunOwnedTakes(client as never, UID, { runBound: true, stopped: proof });
        expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
        expect(out.closed).toBe(0);
        expect(row.status).toBe('completed');
    });

    it('without the stopped proof the real client only reads', async () => {
        const row = { id: S2, user_id: UID, status: 'active', lease_id: L2, recording_fenced_at: null, created_at: iso(T0 - 120_000) };
        const { client, requests } = realClient([row], [stale(L2)]);
        expect(await settleRunOwnedTakes(client as never, UID, { runBound: true })).toEqual({ closed: 0, unsettleable: 0, leaseOnly: 0, notStopped: 1 });
        expect(requests.every((r) => r.method === 'GET')).toBe(true);
    });
});

describe('classifyTakes / leaseOnlyTakes (pure)', () => {
    const row = (status: string | null, lease: string | null, fenced: string | null = null): TakeRow => ({ id: S1, status, lease_id: lease, recording_fenced_at: fenced });
    it.each([
        ['completed, leased', row('completed', L1), 'settled'],
        ['completed, legacy', row('completed', null), 'settled'],
        ['failed under a lease', row('failed', L1), 'settled'],
        ['failed under a fence', row('failed', null, 'x'), 'settled'],
        ['active under a lease', row('active', L1), 'closable'],
        ['active, fenced', row('active', null, 'x'), 'closable'],
        ['any other status under a lease', row('expired', L1), 'unsettleable'],
        ['failed, no lease, no fence', row('failed', null), 'unsettleable'],
        ['active, no lease, no fence', row('active', null), 'unsettleable'],
    ])('%s is %s', (_n, r, want) => {
        const c = classifyTakes([r]);
        const got = c.settled ? 'settled' : c.closable.length ? 'closable' : 'unsettleable';
        expect(got).toBe(want);
    });
    it('writerAfter: a heartbeat, a creation or an expiry past what a pre-close heartbeat sets is a writer; unparseable refuses', () => {
        const rows = (r: Partial<TakeRow>): { rows: TakeRow[]; leases: [] } => ({ rows: [{ ...row('active', L1), ...r }], leases: [] });
        const leases = (h: string | null) => ({ rows: [], leases: [{ lease_id: L1, heartbeat_at: h }] });
        expect(writerAfter(T0, leases(iso(T0)))).toBe(false);
        expect(writerAfter(T0, leases(iso(T0 + 1)))).toBe(true);
        expect(writerAfter(T0, leases(null))).toBe(true);
        expect(writerAfter(T0, leases('not a time'))).toBe(true);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1) }))).toBe(false);
        expect(writerAfter(T0, rows({ created_at: iso(T0 + 1) }))).toBe(true);
        expect(writerAfter(T0, rows({ created_at: undefined }))).toBe(true);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1), expires_at: iso(T0 + 5 * 60_000) }))).toBe(false);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1), expires_at: iso(T0 + 5 * 60_000 + 1) }))).toBe(true);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1), expires_at: null }))).toBe(false);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1), expires_at: 'garbage' }))).toBe(true);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1), updated_at: iso(T0) }))).toBe(false);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1), updated_at: iso(T0 + 1) }))).toBe(true);
        expect(writerAfter(T0, rows({ created_at: iso(T0 - 1), updated_at: 'garbage' }))).toBe(true);
        expect(writerAfter(T0, { rows: [{ ...row('completed', L1), created_at: iso(T0 - 1), updated_at: iso(T0 + 1) }], leases: [] })).toBe(false);
    });

    it('counts held leases that no session was created under', () => {
        expect(leaseOnlyTakes([L1, L2, null], [row('completed', L1)])).toBe(1);
        expect(leaseOnlyTakes([], [])).toBe(0);
    });
});
