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
import { cleanupLane, guardAdminForBinding, setupLane, sweepLane } from '../../scripts/lib/canaryRunOwnedLane.mjs';

const ACTIONS_ENV = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000007', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main', CANARY_TRIAL_EMAIL: 'trial@example.test',
};
const H = 3600_000;

/** jsonb equality: key order does not matter. */
const canon = (v: unknown): string => (v && typeof v === 'object' ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)))) : JSON.stringify(v));
type User = { id: string; email: string; app_metadata: Record<string, unknown>; created_at: string };
/**
 * Supabase admin double: auth users plus empty residue tables, recording every destructive call. `onRead(n, user)` can mutate
 * the stored user on the n-th getUserById of that uid — the adversarial "binding changed after the listing" seam.
 */
function fakeAdmin(o: { dropBinding?: boolean; onRead?: (n: number, u: User) => void } = {}) {
    const users = new Map<string, User>();
    const destructive: string[] = [];
    const reads = new Map<string, number>();
    const claims = new Map<string, string>();
    const notFound = { status: 404, code: 'user_not_found', message: 'User not found' };
    return {
        users, destructive, claims,
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
        // #1643 save journal (service_role-only functions): this account saved no take, so nothing remains.
        // The claim is checked like the database does: the account must exist and carry exactly the presented binding.
        rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
            const uid = String(args.p_user_id);
            if (fn === 'claim_account_save_journal_cleanup_v1') {
                const u = users.get(uid);
                if (!u) return { data: null, error: { code: 'P0002', message: 'account not found' } };
                if (canon(args.p_run_binding ?? null) !== canon(u.app_metadata[BINDING_KEY] ?? null)) return { data: null, error: { code: '42501', message: 'account is not owned by this run' } };
                claims.set(uid, String(args.p_token)); return { data: null, error: null };
            }
            if (fn === 'delete_deleted_account_save_journal_v1') {
                if (users.has(uid)) return { data: null, error: { code: '55000', message: 'account still exists' } };
                if (claims.get(uid) !== args.p_token) return { data: null, error: { code: '42501', message: 'account save journal not claimed by this run' } };
                claims.delete(uid); destructive.push('account_save_obligations');
            }
            return { data: 0, error: null };
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
        expect(admin.destructive).toEqual(['trial_entitlements', 'auth.users', 'account_save_obligations']);
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
        expect(admin.destructive).toEqual(['trial_entitlements', 'auth.users', 'account_save_obligations']);
    });

    it('bind failure: the just-created account goes through the shared cleanup (pre-delete + proof), not a bare deleteUser', async () => {
        const admin = fakeAdmin({ dropBinding: true });
        const exportEnv = vi.fn();
        const r = await setupLane({ admin, env: process.env, mask: () => {}, exportEnv, cleanup: sharedCleanup });
        expect(r).toEqual({ ok: false, code: 'bind-failed-cleaned' });
        expect(admin.destructive).toEqual(['trial_entitlements', 'auth.users', 'account_save_obligations']);
        expect(admin.users.size).toBe(0);
        expect(exportEnv).not.toHaveBeenCalled();
        expect(currentCanaryBinding(process.env)).not.toBeNull();
    });

    it('the guarded admin forwards only the three #1643 save-journal functions, only for its own account; the claim carries this run\'s canary binding', async () => {
        const admin = fakeAdmin();
        admin.users.set('uid-a', canaryUser('uid-a', ACTIONS_ENV.GITHUB_RUN_ID));
        const expected = { repository: ACTIONS_ENV.GITHUB_REPOSITORY, workflow: ACTIONS_ENV.GITHUB_WORKFLOW_REF };
        const guarded = guardAdminForBinding(admin, { uid: 'uid-a', email: admin.users.get('uid-a')!.email, expected, runId: ACTIONS_ENV.GITHUB_RUN_ID, runAttempt: '1' }) as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> };
        const secret = 'a'.repeat(64);
        // The shared helper claims as unbound (it knows nothing of canary_run); the guard substitutes this run's exact binding.
        await expect(guarded.rpc('claim_account_save_journal_cleanup_v1', { p_user_id: 'uid-a', p_run_binding: null, p_token: secret })).resolves.toEqual({ data: null, error: null });
        expect(admin.rpc).toHaveBeenLastCalledWith('claim_account_save_journal_cleanup_v1', { p_user_id: 'uid-a', p_token: secret,
            p_run_binding: { ...expected, role: 'canary-active-trial', runId: ACTIONS_ENV.GITHUB_RUN_ID, runAttempt: '1' } });
        expect(admin.claims.get('uid-a')).toBe(secret);
        // While the account still exists (so revalidation passes): a caller-supplied binding, even this run's own, is refused.
        const callsBefore = admin.rpc.mock.calls.length;
        for (const p_run_binding of [{ runId: '1' }, { ...expected, role: 'canary-active-trial', runId: ACTIONS_ENV.GITHUB_RUN_ID, runAttempt: '1' }])
            await expect(guarded.rpc('claim_account_save_journal_cleanup_v1', { p_user_id: 'uid-a', p_run_binding, p_token: secret })).rejects.toThrow(/canary_binding_changed_at_mutation/);
        expect(admin.rpc.mock.calls.length).toBe(callsBefore);
        await expect(guarded.rpc('count_account_save_journal_v1', { p_user_id: 'uid-a' })).resolves.toEqual({ data: 0, error: null });
        admin.users.delete('uid-a');
        await expect(guarded.rpc('delete_deleted_account_save_journal_v1', { p_user_id: 'uid-a', p_token: secret })).resolves.toEqual({ data: 0, error: null });
        const before = admin.rpc.mock.calls.length;
        for (const [fn, args] of [
            ['delete_deleted_account_save_journal_v1', { p_user_id: 'uid-b', p_token: secret }],
            ['count_account_save_journal_v1', { p_user_id: 'uid-b' }],
            ['claim_account_save_journal_cleanup_v1', { p_user_id: 'uid-b', p_run_binding: null, p_token: secret }],
            ['claim_account_save_journal_cleanup_v1', { p_user_id: 'uid-a', p_run_binding: { runId: '1' }, p_token: secret }],
            ['claim_account_save_journal_cleanup_v1', { p_user_id: 'uid-a', p_run_binding: null, p_token: secret, extra: 1 }],
            ['effective_subscription_tier', { p_user_id: 'uid-a' }],
            ['delete_deleted_account_save_journal_v1', { p_user_id: 'uid-a' }],
            ['delete_deleted_account_save_journal_v1', { p_user_id: 'uid-a', p_token: secret, extra: 1 }],
            ['count_account_save_journal_v1', { p_user_id: 'uid-a', p_token: secret }],
        ] as const) await expect(guarded.rpc(fn, args as Record<string, unknown>), `${fn} ${JSON.stringify(args)}`).rejects.toThrow(/canary_binding_changed_at_mutation/);
        expect(admin.rpc.mock.calls.length).toBe(before);
    });

    it('the claim revalidates the binding at the boundary: a changed or vanished canary binding is refused before the claim', async () => {
        for (const change of [(u: User) => { u.app_metadata = {}; }, (u: User) => { (u.app_metadata[BINDING_KEY] as Record<string, unknown>).runAttempt = '2'; }]) {
            const admin = fakeAdmin();
            admin.users.set('uid-a', canaryUser('uid-a', ACTIONS_ENV.GITHUB_RUN_ID));
            const expected = { repository: ACTIONS_ENV.GITHUB_REPOSITORY, workflow: ACTIONS_ENV.GITHUB_WORKFLOW_REF };
            const guarded = guardAdminForBinding(admin, { uid: 'uid-a', email: admin.users.get('uid-a')!.email, expected, runId: ACTIONS_ENV.GITHUB_RUN_ID, runAttempt: '1' }) as {
                rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> };
            change(admin.users.get('uid-a')!);
            await expect(guarded.rpc('claim_account_save_journal_cleanup_v1', { p_user_id: 'uid-a', p_run_binding: null, p_token: 'a'.repeat(64) })).rejects.toThrow(/canary_binding_changed_at_mutation/);
            expect(admin.rpc).not.toHaveBeenCalled();
        }
    });
});
