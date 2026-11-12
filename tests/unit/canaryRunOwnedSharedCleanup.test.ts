// @vitest-environment node
/**
 * #1826 composition control: a canary run-owned account, created by the canary's own code, must be deletable by the REAL shared
 * zero-residue cleanup (tests/live/helpers/runOwnedCleanup.ts) inside a GitHub Actions run — including after the RWT run binding
 * (`app_metadata.ct_run`, enforced by that cleanup) exists. A canary binding written under `ct_run` would be refused there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupRunOwnedAccount } from '../live/helpers/runOwnedCleanup';
import { __resetCreateGuardForTests, createRunOwnedTrialAccount, currentCanaryBinding } from '../../scripts/lib/canaryRunOwnedAccount.mjs';
import { BINDING_KEY, RUN_OWNED_PREFIX } from '../../scripts/lib/canaryRunOwnedSweep.mjs';

const ACTIONS_ENV = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000007', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main',
};

type User = { id: string; email: string; app_metadata: Record<string, unknown>; created_at: string };
/** Supabase admin double: one auth user table plus empty residue tables, recording every delete. */
function fakeAdmin() {
    const users = new Map<string, User>();
    const deletes: string[] = [];
    const notFound = { status: 404, code: 'user_not_found', message: 'User not found' };
    const query = (table: string) => {
        const chain = {
            delete: () => ({ eq: async () => { deletes.push(table); return { error: null }; } }),
            select: () => ({ eq: async () => ({ count: 0, data: [], error: null }) }),
        };
        return chain;
    };
    return {
        users, deletes,
        auth: { admin: {
            createUser: vi.fn(async ({ email, app_metadata }: { email: string; app_metadata: Record<string, unknown> }) => {
                users.set('uid-1', { id: 'uid-1', email, app_metadata, created_at: new Date().toISOString() });
                return { data: { user: { id: 'uid-1' } }, error: null };
            }),
            getUserById: vi.fn(async (id: string) => {
                const u = users.get(id);
                return u ? { data: { user: u }, error: null } : { data: { user: null }, error: notFound };
            }),
            deleteUser: vi.fn(async (id: string) => { users.delete(id); deletes.push('auth.users'); return { error: null }; }),
            listUsers: vi.fn(async () => ({ data: { users: [...users.values()] }, error: null })),
        } },
        from: (table: string) => query(table),
    };
}

describe('canary account × shared runOwnedCleanup (#1826)', () => {
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

    it('the canary binds under its own key, never the RWT `ct_run` key', async () => {
        const admin = fakeAdmin();
        const r = await createRunOwnedTrialAccount(admin, { binding: currentCanaryBinding(process.env), domain: 'example.test' });
        expect(r.status).toBe('created');
        const meta = admin.users.get('uid-1')!.app_metadata;
        expect(Object.keys(meta)).toEqual([BINDING_KEY]);
        expect(BINDING_KEY).not.toBe('ct_run');
    });

    it('the real shared cleanup deletes the canary account inside an Actions run and proves it gone', async () => {
        const admin = fakeAdmin();
        const r = await createRunOwnedTrialAccount(admin, { binding: currentCanaryBinding(process.env), domain: 'example.test' });
        if (r.status !== 'created') throw new Error('setup');
        await expect(cleanupRunOwnedAccount({ admin: admin as never, capturedUid: r.userId, createdEmail: r.email, runOwnedPrefix: RUN_OWNED_PREFIX }))
            .resolves.toBe('uid-1');
        expect(admin.users.size).toBe(0);
        expect(admin.deletes).toContain('trial_entitlements');
        expect(admin.deletes).toContain('auth.users');
    });
});
