// @vitest-environment node
/** Controls: one run-owned trial account per run, bound to the exact run before use (#1826). */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { __resetCreateGuardForTests, createRunOwnedTrialAccount, currentCanaryBinding } from '../../scripts/lib/canaryRunOwnedAccount.mjs';

const ENV = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000001', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main' };
const B = currentCanaryBinding(ENV);
const admin = (o = {}) => {
    const users = new Map();
    return {
        users,
        auth: { admin: {
            createUser: vi.fn(async ({ email, app_metadata }) => {
                if (o.createError) return { data: null, error: { message: 'x' } };
                users.set('u1', { id: 'u1', email, app_metadata: o.dropBinding ? {} : app_metadata });
                return { data: { user: { id: 'u1' } }, error: null };
            }),
            getUserById: vi.fn(async (id) => (o.readError ? { data: null, error: { message: 'x' } } : { data: { user: users.get(id) ?? null }, error: null })),
            deleteUser: vi.fn(async (id) => { users.delete(id); return { error: o.deleteError ? { message: 'x' } : null }; }),
        } },
    };
};
const okCleanup = async () => {};
beforeEach(() => __resetCreateGuardForTests());

describe('currentCanaryBinding', () => {
    it('exists only inside a well-formed Actions run', () => {
        expect(B).toEqual({ repository: ENV.GITHUB_REPOSITORY, workflow: ENV.GITHUB_WORKFLOW_REF, runId: '43000000001', runAttempt: '1', role: 'canary-active-trial' });
        for (const bad of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ATTEMPT: 'x' }, { GITHUB_REPOSITORY: 'x' }, { GITHUB_WORKFLOW_REF: 'x' }]) {
            expect(currentCanaryBinding({ ...ENV, ...bad })).toBeNull();
        }
    });
});

describe('createRunOwnedTrialAccount', () => {
    it('creates one prefixed, run-bound account and reads the binding back', async () => {
        const a = admin();
        const r = await createRunOwnedTrialAccount(a, { binding: B, domain: 'example.test', cleanup: okCleanup });
        expect(r.status).toBe('created');
        expect(r.email).toMatch(/^ctrial-run-43000000001-1-[0-9a-f]{8}@example\.test$/);
        expect(a.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true, app_metadata: { canary_run: B } }));
    });
    it('CASUALTY: a second create in the same run is refused (hard cap 1)', async () => {
        const a = admin();
        await createRunOwnedTrialAccount(a, { binding: B, domain: 'example.test', cleanup: okCleanup });
        expect(await createRunOwnedTrialAccount(a, { binding: B, domain: 'example.test', cleanup: okCleanup })).toEqual({ status: 'refused', code: 'second-create-in-run' });
        expect(a.auth.admin.createUser).toHaveBeenCalledTimes(1);
    });
    it('CASUALTY: no run binding, or an invalid/prohibited domain, creates nothing', async () => {
        const a = admin();
        expect((await createRunOwnedTrialAccount(a, { binding: null, domain: 'example.test', cleanup: okCleanup })).code).toBe('no-run-binding');
        expect((await createRunOwnedTrialAccount(a, { binding: B, domain: 'speaksharp.app', cleanup: okCleanup })).code).toBe('domain-invalid');
        expect(a.auth.admin.createUser).not.toHaveBeenCalled();
    });
    it('CASUALTY: a binding that does not read back goes through the SHARED cleanup, never a bare deleteUser (review return on 10c5aa80)', async () => {
        const dropped = admin({ dropBinding: true });
        const cleanup = vi.fn(async ({ uid }) => { dropped.users.delete(uid); });
        const r = await createRunOwnedTrialAccount(dropped, { binding: B, domain: 'example.test', cleanup });
        expect(r).toEqual({ status: 'failed', code: 'bind-failed-cleaned' });
        expect(cleanup).toHaveBeenCalledWith({ uid: 'u1', email: expect.stringMatching(/^ctrial-run-43000000001-1-[0-9a-f]{8}@example\.test$/) });
        expect(dropped.auth.admin.deleteUser).not.toHaveBeenCalled();
        __resetCreateGuardForTests();
        const unproven = admin({ dropBinding: true });
        expect(await createRunOwnedTrialAccount(unproven, { binding: B, domain: 'example.test', cleanup: async () => { throw new Error('residue'); } }))
            .toEqual({ status: 'failed', code: 'bind-failed-cleanup-unproven' });
        expect(unproven.auth.admin.deleteUser).not.toHaveBeenCalled();
        __resetCreateGuardForTests();
        expect((await createRunOwnedTrialAccount(admin({ readError: true }), { binding: B, domain: 'example.test', cleanup: okCleanup })).code).toBe('bind-failed-cleaned');
        __resetCreateGuardForTests();
        expect((await createRunOwnedTrialAccount(admin({ createError: true }), { binding: B, domain: 'example.test', cleanup: okCleanup })).code).toBe('create-failed');
    });
    it('CASUALTY: without the shared cleanup nothing is created', async () => {
        const a = admin();
        expect(await createRunOwnedTrialAccount(a, { binding: B, domain: 'example.test' })).toEqual({ status: 'refused', code: 'no-cleanup' });
        expect(a.auth.admin.createUser).not.toHaveBeenCalled();
    });
});
