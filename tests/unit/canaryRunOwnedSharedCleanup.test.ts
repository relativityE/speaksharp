// @vitest-environment node
/**
 * #1826 composition controls with the REAL shared zero-residue cleanup (tests/live/helpers/runOwnedCleanup.ts), driven through the
 * canary lane exactly as the workflow does, inside a GitHub Actions env:
 *  - the canary binds under its own key (`canary_run`), never the RWT `ct_run` key the shared cleanup enforces;
 *  - in-run cleanup and the sweep delete through the binding-guarded admin, which revalidates the exact canary binding at
 *    EVERY destructive call — a binding changed or made foreign after a valid listing deletes nothing (review return on b3436ed0);
 *  - a bind failure goes through the shared cleanup (trial_entitlements pre-delete + residue proof), never a bare deleteUser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupRunOwnedAccount } from '../live/helpers/runOwnedCleanup';
import { __resetCreateGuardForTests, currentCanaryBinding } from '../../scripts/lib/canaryRunOwnedAccount.mjs';
import { BINDING_KEY, RUN_OWNED_PREFIX } from '../../scripts/lib/canaryRunOwnedSweep.mjs';
import { cleanupLane, setupLane, sweepLane } from '../../scripts/lib/canaryRunOwnedLane.mjs';

const ACTIONS_ENV = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000007', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main', CANARY_TRIAL_EMAIL: 'trial@example.test',
};
const H = 3600_000;

type User = { id: string; email: string; app_metadata: Record<string, unknown>; created_at: string };
/**
 * Supabase admin double: auth users plus empty residue tables, recording every destructive call. `onRead(n, user)` can mutate
 * the stored user on the n-th getUserById of that uid — the adversarial "binding changed after the listing" seam.
 */
function fakeAdmin(o: { dropBinding?: boolean; onRead?: (n: number, u: User) => void } = {}) {
    const users = new Map<string, User>();
    const destructive: string[] = [];
    const reads = new Map<string, number>();
    const notFound = { status: 404, code: 'user_not_found', message: 'User not found' };
    return {
        users, destructive,
        auth: { admin: {
            createUser: vi.fn(async ({ email, app_metadata }: { email: string; app_metadata: Record<string, unknown> }) => {
                users.set('uid-new', { id: 'uid-new', email, app_metadata: o.dropBinding ? {} : app_metadata, created_at: new Date().toISOString() });
                return { data: { user: { id: 'uid-new' } }, error: null };
            }),
            getUserById: vi.fn(async (id: string) => {
                const n = (reads.get(id) ?? 0) + 1;
                reads.set(id, n);
                const u = users.get(id);
                if (u && o.onRead) o.onRead(n, u);
                return u ? { data: { user: u }, error: null } : { data: { user: null }, error: notFound };
            }),
            deleteUser: vi.fn(async (id: string) => { users.delete(id); destructive.push('auth.users'); return { error: null }; }),
            listUsers: vi.fn(async () => ({ data: { users: [...users.values()] }, error: null })),
        } },
        from: (table: string) => ({
            delete: () => ({ eq: async () => { destructive.push(table); return { error: null }; } }),
            select: () => ({ eq: async () => ({ count: 0, data: [], error: null }) }),
        }),
    };
}
const sharedCleanup = async ({ admin, uid, email }: { admin: unknown; uid: string; email: string }) => {
    await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: uid, createdEmail: email, runOwnedPrefix: RUN_OWNED_PREFIX });
};
const canaryUser = (id: string, runId: string, over: Record<string, unknown> = {}): User => ({
    id, email: `ctrial-run-${runId}-1-abcd1234@example.test`, created_at: new Date(Date.now() - 5 * H).toISOString(),
    app_metadata: { [BINDING_KEY]: { repository: ACTIONS_ENV.GITHUB_REPOSITORY, workflow: ACTIONS_ENV.GITHUB_WORKFLOW_REF, runId, runAttempt: '1', role: 'canary-active-trial', ...over } },
});
const finished = async () => ({ status: 'completed', run_attempt: 1, updated_at: new Date(Date.now() - 2 * H).toISOString() });

describe('canary lane × REAL shared runOwnedCleanup (#1826)', () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        __resetCreateGuardForTests();
        for (const [k, v] of Object.entries(ACTIONS_ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const k of Object.keys(ACTIONS_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
        vi.restoreAllMocks();
    });

    it('setup binds under the canary key only; in-run cleanup then deletes it with the shared proof', async () => {
        const admin = fakeAdmin();
        const setup = await setupLane({ admin, env: process.env, mask: () => {}, exportEnv: () => {}, cleanup: sharedCleanup });
        expect(setup).toEqual({ ok: true, code: 'created-bound' });
        expect(Object.keys(admin.users.get('uid-new')!.app_metadata)).toEqual([BINDING_KEY]);
        expect(BINDING_KEY).not.toBe('ct_run');
        expect(await cleanupLane({ admin, env: process.env, cleanup: sharedCleanup })).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1 });
        expect(admin.users.size).toBe(0);
        expect(admin.destructive).toEqual(['trial_entitlements', 'auth.users']);
    });

    it('ADVERSARIAL: in-run cleanup — valid listing, then the binding changes on the helper\'s fresh read → nothing deleted', async () => {
        const mine = canaryUser('m1', ACTIONS_ENV.GITHUB_RUN_ID);
        // From the 2nd read of this uid on (after the shared cleanup's own identity read), the binding names a foreign run.
        const admin = fakeAdmin({ onRead: (n, u) => { if (n >= 2) u.app_metadata = { [BINDING_KEY]: { ...(u.app_metadata[BINDING_KEY] as object), runId: '43000000999' } }; } });
        admin.users.set('m1', mine);
        expect(await cleanupLane({ admin, env: process.env, cleanup: sharedCleanup })).toMatchObject({ ok: false, code: 'cleanup-unproven', deleted: 0 });
        expect(admin.destructive).toEqual([]);
        expect(admin.users.has('m1')).toBe(true);
    });

    it('ADVERSARIAL: sweep — valid listing and re-check, then the ORIGINAL binding changes before the delete → nothing deleted', async () => {
        const orphan = canaryUser('p1', '43000000001');
        // Read 1 = the sweep's own re-check, read 2 = the shared cleanup's identity read; from read 3 the binding is foreign.
        const admin = fakeAdmin({ onRead: (n, u) => { if (n >= 3) u.app_metadata = { [BINDING_KEY]: { ...(u.app_metadata[BINDING_KEY] as object), workflow: 'evil/repo/.github/workflows/x.yml@refs/heads/main' } }; } });
        admin.users.set('p1', orphan);
        const r = await sweepLane({ admin, env: process.env, getRun: finished, cleanup: sharedCleanup });
        expect(r).toMatchObject({ ok: false, code: 'sweep-failed', report: { swept: 0, failures: { 'cleanup-unproven': 1 } } });
        expect(admin.destructive).toEqual([]);
        expect(admin.users.has('p1')).toBe(true);
    });

    it('ADVERSARIAL: the binding is removed (unbound) at the mutation boundary → nothing deleted', async () => {
        const mine = canaryUser('m2', ACTIONS_ENV.GITHUB_RUN_ID);
        const admin = fakeAdmin({ onRead: (n, u) => { if (n >= 2) u.app_metadata = {}; } });
        admin.users.set('m2', mine);
        expect((await cleanupLane({ admin, env: process.env, cleanup: sharedCleanup })).ok).toBe(false);
        expect(admin.destructive).toEqual([]);
    });

    it('the sweep deletes an unchanged proven orphan through the guard with the full shared proof', async () => {
        const admin = fakeAdmin();
        admin.users.set('p2', canaryUser('p2', '43000000001'));
        expect(await sweepLane({ admin, env: process.env, getRun: finished, cleanup: sharedCleanup })).toMatchObject({ ok: true, report: { swept: 1 } });
        expect(admin.destructive).toEqual(['trial_entitlements', 'auth.users']);
    });

    it('bind failure: the just-created account goes through the shared cleanup (pre-delete + proof), not a bare deleteUser', async () => {
        const admin = fakeAdmin({ dropBinding: true });
        const exportEnv = vi.fn();
        const r = await setupLane({ admin, env: process.env, mask: () => {}, exportEnv, cleanup: sharedCleanup });
        expect(r).toEqual({ ok: false, code: 'bind-failed-cleaned' });
        expect(admin.destructive).toEqual(['trial_entitlements', 'auth.users']);
        expect(admin.users.size).toBe(0);
        expect(exportEnv).not.toHaveBeenCalled();
        expect(currentCanaryBinding(process.env)).not.toBeNull();
    });
});
