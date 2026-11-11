// @vitest-environment node
/**
 * PO option C on the original Playwright route (2026-11-10): the journey's disposable account is bound to its GitHub run by
 * service-role-written app_metadata.ct_run right after the identity check; cleanup refuses an account bound to another run; and a
 * failed cleanup reports the CLOSED step it stopped at (the AHT-01 baseline 42796353079 recorded only "deletion or residue
 * readback failed").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentRunBinding, runBindingState, sameRunBinding, type RunBinding } from '../live/helpers/runBinding';
import { RESIDUE_CHECKS, PRE_DELETE_TABLES, cleanupFailureStep, cleanupRunOwnedAccount } from '../live/helpers/runOwnedCleanup';
import { runOwnedIdentityFailures, RWT_ACCOUNT_PREFIX } from '../live/helpers/rwtJourney';
import { OwnedCleanup } from '../live/helpers/rwtWatchdog';

const ENV = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '42800000001', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main' };
const B: RunBinding = { repository: ENV.GITHUB_REPOSITORY, workflow: ENV.GITHUB_WORKFLOW_REF, runId: ENV.GITHUB_RUN_ID, runAttempt: '1', role: 'rwt-journey' };
const UID = '0b9c5e2a-1111-4222-8333-444455556666';
const EMAIL = `${RWT_ACCOUNT_PREFIX}open-mic-1794310000000-42800000001@example.com`;

const setEnv = (env: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string); };
afterEach(() => vi.unstubAllEnvs());

/** A fake service-role client with one account, a profile row, and merge semantics for app_metadata (as GoTrue). */
function fake(meta: Record<string, unknown> = { provider: 'email' }, o: { writeError?: string; dropWrite?: boolean } = {}) {
    const user = { id: UID, email: EMAIL, app_metadata: { ...meta } as Record<string, unknown> };
    const updateUserById = vi.fn(async (_id: string, attrs: { app_metadata: Record<string, unknown> }) => {
        if (o.writeError) return { error: { code: o.writeError } };
        if (!o.dropWrite) user.app_metadata = { ...user.app_metadata, ...attrs.app_metadata };
        return { error: null };
    });
    const admin = {
        auth: { admin: { getUserById: vi.fn(async () => ({ data: { user }, error: null })), updateUserById } },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: UID }, error: null }) }) }) }),
    };
    return { admin, user, updateUserById };
}

describe('the run binding', () => {
    it('exists only inside a well-formed GitHub Actions run', () => {
        expect(currentRunBinding(ENV)).toEqual(B);
        for (const bad of [{ GITHUB_ACTIONS: undefined }, { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ATTEMPT: 'x' }, { GITHUB_WORKFLOW_REF: 'x' }, { GITHUB_REPOSITORY: 'x' }]) {
            expect(currentRunBinding({ ...ENV, ...bad })).toBeNull();
        }
        expect(sameRunBinding({ ct_run: { ...B } }, B)).toBe(true);
        // review: a valid Git ref with "+" (or other non-word, non-space characters) binds; it is never mistaken for a local run
        const plus = { ...ENV, GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/elon/a+b_c~1' };
        expect(runBindingState(plus)).toEqual({ binding: { ...B, workflow: plus.GITHUB_WORKFLOW_REF } });
        expect(runBindingState({ ...ENV, GITHUB_ACTIONS: undefined })).toEqual({ local: true });
        for (const [bad, error] of [[{ GITHUB_WORKFLOW_REF: 'x' }, 'workflow'], [{ GITHUB_WORKFLOW_REF: `${ENV.GITHUB_WORKFLOW_REF} x` }, 'workflow'],
            [{ GITHUB_WORKFLOW_REF: `${ENV.GITHUB_WORKFLOW_REF}\u0007` }, 'workflow'], [{ GITHUB_RUN_ID: '0' }, 'run-id'], [{ GITHUB_RUN_ATTEMPT: 'x' }, 'run-attempt'],
            [{ GITHUB_REPOSITORY: 'x' }, 'repository']] as const) {
            expect(runBindingState({ ...ENV, ...bad })).toEqual({ error });
        }
        for (const meta of [{ ct_run: { ...B, runId: '1' } }, { ct_run: { ...B, extra: 1 } }, { ct_run: 'x' }, {}, null]) expect(sameRunBinding(meta, B)).toBe(false);
    });

    it('the identity check writes ct_run once (merging, the provider keys kept) and reads it back', async () => {
        setEnv(ENV);
        const f = fake();
        expect(await runOwnedIdentityFailures(f.admin as never, UID, EMAIL)).toEqual([]);
        expect(f.updateUserById).toHaveBeenCalledWith(UID, { app_metadata: { ct_run: B } });
        expect(f.user.app_metadata).toEqual({ provider: 'email', ct_run: B });
        expect(await runOwnedIdentityFailures(f.admin as never, UID, EMAIL)).toEqual([]);   // idempotent: already this run's
        expect(f.updateUserById).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY: another run\'s binding, a failed write or a write that does not read back is a failure; local runs bind nothing', async () => {
        setEnv(ENV);
        expect(await runOwnedIdentityFailures(fake({ ct_run: { ...B, runId: '9' } }).admin as never, UID, EMAIL)).toEqual(['the account already carries another run binding']);
        expect(await runOwnedIdentityFailures(fake({}, { writeError: 'forbidden' }).admin as never, UID, EMAIL)).toEqual(['run binding could not be written (forbidden)']);
        expect(await runOwnedIdentityFailures(fake({}, { dropWrite: true }).admin as never, UID, EMAIL)).toEqual(['run binding did not read back']);
        vi.unstubAllEnvs();
        setEnv({ ...ENV, GITHUB_RUN_ID: '0' });                                              // in Actions but unusable: a clear failure
        const unusable = fake();
        expect(await runOwnedIdentityFailures(unusable.admin as never, UID, EMAIL)).toEqual(['run binding unavailable in GitHub Actions (run-id)']);
        expect(unusable.updateUserById).not.toHaveBeenCalled();
        vi.unstubAllEnvs();
        setEnv({ ...ENV, GITHUB_ACTIONS: 'false' });
        const local = fake();
        expect(await runOwnedIdentityFailures(local.admin as never, UID, EMAIL)).toEqual([]);
        expect(local.updateUserById).not.toHaveBeenCalled();
    });
});

describe('cleanup', () => {
    const cleanupAdmin = (meta: Record<string, unknown>) => {
        const user = { id: UID, email: EMAIL, app_metadata: meta };
        let gone = false;
        return {
            auth: { admin: {
                getUserById: vi.fn(async () => (gone ? { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'x' } } : { data: { user }, error: null })),
                deleteUser: vi.fn(async () => { gone = true; return { error: null }; }),
                listUsers: vi.fn(),
            } },
            from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }), select: () => ({ eq: async () => ({ count: 0, error: null }) }) }),
        };
    };
    it('deletes an account bound to THIS run; CASUALTY: an account bound to another run is refused before any deletion', async () => {
        setEnv(ENV);
        const mine = cleanupAdmin({ ct_run: B });
        await expect(cleanupRunOwnedAccount({ admin: mine as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: RWT_ACCOUNT_PREFIX })).resolves.toBe(UID);
        expect(mine.auth.admin.deleteUser).toHaveBeenCalledTimes(1);
        const other = cleanupAdmin({ ct_run: { ...B, runId: '42800000002' } });
        await expect(cleanupRunOwnedAccount({ admin: other as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: RWT_ACCOUNT_PREFIX }))
            .rejects.toThrow('cleanup_run_binding_mismatch');
        expect(other.auth.admin.deleteUser).not.toHaveBeenCalled();
    });
    it('an unbound account (binding never written) keeps the UID/email identity as its proof', async () => {
        setEnv(ENV);
        const unbound = cleanupAdmin({ provider: 'email' });
        await expect(cleanupRunOwnedAccount({ admin: unbound as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: RWT_ACCOUNT_PREFIX })).resolves.toBe(UID);
    });
    it('a failed cleanup reports the CLOSED step it stopped at; free text and unknown tables are `unknown`', async () => {
        const t = RESIDUE_CHECKS[0].table;
        const cases: [string, string][] = [
            ['cleanup getUserById failed (fail closed): x', 'get_user'], ['cleanup recovery listUsers failed (fail closed): x', 'recovery_list_users'],
            ['cleanup_uid_email_disagreement (fail closed)', 'uid_email_disagreement'], ['cleanup_refused_non_run_owned_account (fail closed)', 'non_run_owned'],
            ['cleanup_run_binding_mismatch (fail closed)', 'run_binding_mismatch'], ['cleanup requires admin client (fail closed)', 'no_admin'],
            [`cleanup ${PRE_DELETE_TABLES[0]} pre-delete failed (fail closed): x`, `pre_delete:${PRE_DELETE_TABLES[0]}`],
            ['cleanup deleteUser failed (fail closed): Customer Alice', 'delete_user'],
            ['post-delete verify returned a non-not-found error — deletion UNPROVEN (fail closed): x', 'post_delete_verify'],
            [`cleanup residue query on ${t} failed (fail closed): x`, `residue_query:${t}`],
            [`cleanup found run-owned residue in ${t} (fail closed): count=2`, `residue_found:${t}`],
            [`cleanup residue count on ${t} was not a counted integer — residue UNPROVEN (fail closed)`, `residue_unproven:${t}`],
            ['cleanup found run-owned residue in customer_secrets (fail closed): count=1', 'unknown'], ['Customer Alice private account information', 'unknown'],
        ];
        for (const [message, code] of cases) expect({ message, code: cleanupFailureStep(new Error(message)) }).toEqual({ message, code });
        for (const thrown of [null, undefined, 'text', 7]) expect(cleanupFailureStep(thrown)).toBe('unknown');
        const owned = new OwnedCleanup(async () => { throw new Error(`cleanup residue count on ${t} was not a counted integer — residue UNPROVEN (fail closed)`); });
        expect(await owned.settle(1000)).toBe('failed');
        expect(owned.failureStep).toBe(`residue_unproven:${t}`);
        expect(new OwnedCleanup(async () => 'ok').failureStep).toBeNull();
    });
});
