// @vitest-environment node
/**
 * #1826 (Sam's decision, option c, on Codex P1 at 079787e1): an interrupted or uncertain canary account is PRESERVED with its save
 * debt and reported (`unsettled_take` / `delete_refused`), never removed by inference and never reported as removed. These drive
 * the REAL shared cleanup (tests/live/helpers/runOwnedCleanup.ts) through the canary adapter and lane, against a fake admin that
 * models the #1643 deletion guard and the two obligation triggers as 20261020230653 writes them (the same model as
 * runOwnedCleanupSaveObligations1643.test.ts): a held or released lease writes `admitted`; a session settles it only when
 * `completed`, or `failed` under a lease or fence; `deleteUser` fails with the guard's generic error while any is unsettled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canaryCleanup } from '../../scripts/lib/canaryCleanupAdapter';
import { BINDING_KEY } from '../../scripts/lib/canaryRunOwnedSweep.mjs';
import { cleanupLane, sweepLane } from '../../scripts/lib/canaryRunOwnedLane.mjs';

const ENV = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000007', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main',
};
const H = 3600_000;
const UID = '00000000-0000-4000-8000-0000000000c1';
const L1 = '10000000-0000-4000-8000-0000000000c1';
const S1 = '20000000-0000-4000-8000-0000000000c1';
const T0 = Date.now() - 3 * H;
const iso = (ms: number) => new Date(ms).toISOString();

type Session = { id: string; status: string; lease_id: string | null; recording_fenced_at: string | null; created_at: string; expires_at: string | null; updated_at: string | null };

function canaryAccount(runId: string, o: { sessions?: Session[]; heldLeases?: string[]; releasedLeases?: string[] } = {}) {
    const email = `ctrial-run-${runId}-1-abcd1234@example.test`;
    const meta = { [BINDING_KEY]: { repository: ENV.GITHUB_REPOSITORY, workflow: ENV.GITHUB_WORKFLOW_REF, runId, runAttempt: '1', role: 'canary-active-trial' } };
    const sessions = (o.sessions ?? []).map((s) => ({ ...s }));
    const held = [...(o.heldLeases ?? [])];
    const obligations = new Map<string, 'admitted' | 'completed'>();
    for (const l of [...held, ...(o.releasedLeases ?? [])]) obligations.set(l, 'admitted');
    const settle = (s: Session) => {
        const done = s.status === 'completed' || (s.status === 'failed' && (s.lease_id !== null || s.recording_fenced_at !== null));
        const identity = s.lease_id ?? s.id;
        obligations.set(identity, done ? 'completed' : (obligations.get(identity) ?? 'admitted'));
    };
    sessions.forEach(settle);
    const state = { deleted: false, deleteCalls: 0, preDeletes: 0, writes: [] as string[] };
    const rows = (table: string) => {
        if (state.deleted) return [];
        if (table === 'sessions') return sessions;
        if (table === 'active_recording_lease') return held.map((lease_id) => ({ lease_id, heartbeat_at: iso(T0 - 60_000) }));
        return [];
    };
    const admin = {
        state,
        landSave: (id: string) => { const s = sessions.find((x) => x.id === id)!; s.status = 'completed'; settle(s); },
        auth: { admin: {
            listUsers: vi.fn(async () => ({ data: { users: state.deleted ? [] : [{ id: UID, email, app_metadata: meta, created_at: iso(Date.now() - 5 * H) }] }, error: null })),
            getUserById: vi.fn(async () => (state.deleted
                ? { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } }
                : { data: { user: { id: UID, email, app_metadata: meta, created_at: iso(Date.now() - 5 * H) } }, error: null })),
            deleteUser: vi.fn(async () => {
                state.deleteCalls += 1;
                if ([...obligations.values()].some((p) => p !== 'completed')) return { error: { message: 'Database error deleting user' } };
                state.deleted = true; return { error: null };
            }),
        } },
        // No `update`: the canary never closes a take. Any status write would throw here.
        from: (table: string) => ({
            select: () => ({ eq: async () => { const r = rows(table); return { data: r, count: r.length, error: null }; } }),
            delete: () => ({ eq: async () => { state.preDeletes += 1; state.writes.push(`delete:${table}`); return { error: null }; } }),
        }),
    };
    return admin;
}

describe('#1826 canary cleanup preserves interrupted and uncertain accounts (Sam option c)', () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
        vi.restoreAllMocks();
    });

    it('lease-only interruption (a Start that never created a take): unsettled_take, account and debt preserved, nothing written', async () => {
        const admin = canaryAccount(ENV.GITHUB_RUN_ID, { heldLeases: [L1] });
        const r = await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup });
        expect(r).toEqual({ ok: false, code: 'unsettled_take', deleted: 0, preserved: { runId: ENV.GITHUB_RUN_ID, runAttempt: '1', accountPattern: `ctrial-run-${ENV.GITHUB_RUN_ID}-1-*` } });
        expect(admin.state).toMatchObject({ deleted: false, deleteCalls: 0, preDeletes: 0 });
    });

    it('recording before the placeholder settled (an open take under its lease): unsettled_take, no close, no deletion attempt', async () => {
        const admin = canaryAccount(ENV.GITHUB_RUN_ID, { heldLeases: [L1], sessions: [{ id: S1, status: 'active', lease_id: L1, recording_fenced_at: null, created_at: iso(T0), expires_at: iso(T0 + 5 * 60_000), updated_at: iso(T0) }] });
        const r = await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup });
        expect(r).toMatchObject({ ok: false, code: 'unsettled_take', deleted: 0 });
        expect(admin.state).toMatchObject({ deleted: false, deleteCalls: 0, preDeletes: 0 });
    });

    it('uncertain save: preserved while the save is open; once the save lands, the next cleanup deletes with the full proof', async () => {
        const admin = canaryAccount(ENV.GITHUB_RUN_ID, { releasedLeases: [L1], sessions: [{ id: S1, status: 'active', lease_id: L1, recording_fenced_at: null, created_at: iso(T0), expires_at: iso(T0 + 5 * 60_000), updated_at: iso(T0) }] });
        expect(await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup })).toMatchObject({ ok: false, code: 'unsettled_take' });
        expect(admin.state).toMatchObject({ deleted: false, deleteCalls: 0 });
        admin.landSave(S1);
        expect(await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup })).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1 });
        expect(admin.state).toMatchObject({ deleted: true, deleteCalls: 1 });
    });

    it('normal settled take: deleted through the shared cleanup with the trial-entitlements pre-delete and zero residue', async () => {
        const admin = canaryAccount(ENV.GITHUB_RUN_ID, { releasedLeases: [L1], sessions: [{ id: S1, status: 'completed', lease_id: L1, recording_fenced_at: null, created_at: iso(T0), expires_at: null, updated_at: iso(T0) }] });
        expect(await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup })).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1 });
        expect(admin.state).toMatchObject({ deleted: true, deleteCalls: 1 });
        expect(admin.state.writes).toEqual(['delete:trial_entitlements']);
    });

    it('an obligation the read cannot see (a RELEASED lease with no take): the guard refuses, reported delete_refused, account preserved', async () => {
        const admin = canaryAccount(ENV.GITHUB_RUN_ID, { releasedLeases: [L1] });
        const r = await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup });
        expect(r).toMatchObject({ ok: false, code: 'delete_refused', deleted: 0, preserved: { runId: ENV.GITHUB_RUN_ID, runAttempt: '1' } });
        expect(admin.state).toMatchObject({ deleted: false, deleteCalls: 1 });
    });

    it('sweep: an unsettled orphan of a finished run is preserved and reported with its identity, never counted as removed', async () => {
        const admin = canaryAccount('43000000001', { heldLeases: [L1] });
        const finished = async () => ({ status: 'completed', run_attempt: 1, updated_at: iso(Date.now() - 2 * H) });
        const r = await sweepLane({ admin, env: process.env, getRun: finished, cleanup: canaryCleanup });
        expect(r).toMatchObject({ ok: false, code: 'sweep-failed', report: { swept: 0, failures: { unsettled_take: 1 } } });
        expect(r.preserved).toEqual([{ step: 'unsettled_take', runId: '43000000001', runAttempt: '1', accountPattern: 'ctrial-run-43000000001-1-*' }]);
        expect(admin.state).toMatchObject({ deleted: false, deleteCalls: 0, preDeletes: 0 });
    });

    it('the canary binding stays canary_run: never relabelled ct_run', async () => {
        const admin = canaryAccount(ENV.GITHUB_RUN_ID, { heldLeases: [L1] });
        await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup });
        const { data } = await admin.auth.admin.getUserById();
        expect(Object.keys(data.user!.app_metadata)).toEqual([BINDING_KEY]);
        expect(BINDING_KEY).not.toBe('ct_run');
    });
});
