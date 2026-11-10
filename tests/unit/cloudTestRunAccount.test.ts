// @vitest-environment node
/**
 * Stripped-harness run account (PO plan step 3, option C; #1258): a fresh account per run, bound to the run by server-written
 * app_metadata (not a pattern), deleted through the existing fail-closed cleanup with a CLOSED failing-step code, and recovered
 * for an interrupted run only by that binding.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    LEGACY_FALLBACK_DOMAIN, RUN_ACCOUNT_PREFIX, cleanupRunAccount, cleanupStep, createRunAccount, findRunAccounts, runAccountDomain, runAccountEmail,
    runBindingFrom, sameBinding, type AccountAdmin, type RunBinding,
} from '../../tools/cloud-test/scripts/run_account';
import { PRE_DELETE_TABLES, RESIDUE_CHECKS } from '../live/helpers/runOwnedCleanup';

const B: RunBinding = { repository: 'relativityE/speaksharp', runId: '42800000001', runAttempt: '1', workflow: 'relativityE/speaksharp/.github/workflows/cloud-test-aht.yml@refs/heads/main' };
const UID = '0b9c5e2a-1111-4222-8333-444455556666';
const bytes = (n: number) => Buffer.alloc(n, 0xab);

const adminWith = (over: Partial<AccountAdmin['auth']['admin']> = {}) => {
    const createUser = vi.fn(async (a: { email: string }) => ({ data: { user: { id: UID, email: a.email } }, error: null }));
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    return { auth: { admin: { createUser, listUsers, ...over } } } as unknown as AccountAdmin & { auth: { admin: { createUser: typeof createUser } } };
};

describe('binding and address', () => {
    it('the binding comes only from a well-formed GitHub Actions run', () => {
        const env = { GITHUB_REPOSITORY: B.repository, GITHUB_RUN_ID: B.runId, GITHUB_RUN_ATTEMPT: '1', GITHUB_WORKFLOW_REF: B.workflow };
        expect(runBindingFrom(env)).toEqual(B);
        for (const bad of [{ GITHUB_RUN_ID: '' }, { GITHUB_RUN_ID: '0123' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_REPOSITORY: 'no-slash' }, { GITHUB_WORKFLOW_REF: '' }]) {
            expect(runBindingFrom({ ...env, ...bad })).toBeNull();
        }
    });
    it('an explicit valid domain is used; otherwise the generators\' fallback', () => {
        expect(runAccountDomain('Tests.SpeakSharp.dev ')).toBe('tests.speaksharp.dev');
        for (const raw of [undefined, '', 'not a domain', 'a@b.c']) expect(runAccountDomain(raw)).toBe(LEGACY_FALLBACK_DOMAIN);
    });
    it('the address is unique per creation and carries the run, but ownership is the binding', () => {
        expect(runAccountEmail(B, 'example.com', 1794310000000, 'abababab')).toBe(`${RUN_ACCOUNT_PREFIX}cloud-1794310000000-42800000001-1-abababab@example.com`);
    });
});

describe('create', () => {
    it('creates ONE confirmed account whose app_metadata binds it to this run; password is random and never in the binding', async () => {
        const admin = adminWith();
        const a = await createRunAccount({ admin, binding: B, domain: 'example.com', nowMs: 1794310000000, random: bytes });
        expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
        const arg = admin.auth.admin.createUser.mock.calls[0][0];
        expect(arg).toEqual({ email: a.email, password: a.password, email_confirm: true, app_metadata: { ct_run: B } });
        expect([a.uid, a.password.length >= 32, JSON.stringify(arg.app_metadata).includes(a.password)]).toEqual([UID, true, false]);
    });
    it('CASUALTY: a provider error, a non-UUID id or a different returned email refuses (no account handed to the harness)', async () => {
        const cases = [
            async () => ({ data: null, error: { message: 'x' } }),
            async () => ({ data: { user: { id: 'not-a-uuid', email: 'x' } }, error: null }),
            async () => ({ data: { user: { id: UID, email: 'someone-else@example.com' } }, error: null }),
        ];
        for (const createUser of cases) {
            await expect(createRunAccount({ admin: adminWith({ createUser: createUser as never }), binding: B, domain: 'example.com', nowMs: 1, random: bytes }))
                .rejects.toThrow('create_user');
        }
    });
});

describe('cleanup', () => {
    it('deletes exactly the created UID/email through the existing fail-closed cleanup with the run-owned prefix', async () => {
        const cleanup = vi.fn(async () => UID);
        const r = await cleanupRunAccount({ admin: {}, account: { uid: UID, email: 'rwt-journey-cloud-1-2-1-ab@example.com' }, cleanup });
        expect(r).toEqual({ status: 'deleted' });
        expect(cleanup).toHaveBeenCalledWith({ admin: {}, capturedUid: UID, createdEmail: 'rwt-journey-cloud-1-2-1-ab@example.com', runOwnedPrefix: RUN_ACCOUNT_PREFIX });
    });
    it('the failing step is a CLOSED code for every cleanup throw site; free text and unknown tables are `unknown`', () => {
        const t = RESIDUE_CHECKS[0].table;
        const cases: [string, string][] = [
            ['cleanup getUserById failed (fail closed): boom', 'get_user'],
            ['cleanup_uid_email_disagreement (fail closed)', 'uid_email_disagreement'],
            ['cleanup_refused_non_run_owned_account (fail closed)', 'non_run_owned'],
            ['cleanup requires admin client (fail closed)', 'no_admin'],
            [`cleanup ${PRE_DELETE_TABLES[0]} pre-delete failed (fail closed): denied`, `pre_delete:${PRE_DELETE_TABLES[0]}`],
            ['cleanup deleteUser failed (fail closed): Customer Alice', 'delete_user'],
            ['post-delete verify returned a non-not-found error — deletion UNPROVEN (fail closed): x', 'post_delete_verify'],
            ['auth user must be gone after cleanup (returned a user)', 'post_delete_verify'],
            [`cleanup residue query on ${t} failed (fail closed): x`, `residue_query:${t}`],
            [`cleanup found run-owned residue in ${t} (fail closed): count=2`, `residue_found:${t}`],
            [`cleanup residue count on ${t} was not a counted integer — residue UNPROVEN (fail closed)`, `residue_unproven:${t}`],
            ['cleanup found run-owned residue in customer_alice_secrets (fail closed): count=2', 'unknown'],
            ['Customer Alice private account information', 'unknown'],
            ['sk_live_secret_value', 'unknown'],
        ];
        for (const [message, code] of cases) expect({ message, code: cleanupStep(new Error(message)) }).toEqual({ message, code });
        for (const thrown of [null, undefined, 'a string', 42, { message: 7 }]) expect(cleanupStep(thrown)).toBe('unknown');
    });
    it('a failed cleanup reports its step and never its text', async () => {
        const cleanup = vi.fn(async () => { throw new Error('cleanup deleteUser failed (fail closed): Customer Alice'); });
        const r = await cleanupRunAccount({ admin: {}, account: { uid: UID, email: 'e' }, cleanup });
        expect(r).toEqual({ status: 'failed', step: 'delete_user' });
    });
});

describe('recover (interrupted run): only the server-written binding selects', () => {
    const page = (users: unknown[]) => adminWith({ listUsers: vi.fn(async () => ({ data: { users }, error: null })) as never });
    const bound = (id: string, runId = B.runId, repository = B.repository) =>
        ({ id, email: `${RUN_ACCOUNT_PREFIX}cloud-1-${runId}-1-ab@example.com`, app_metadata: { ct_run: { repository, runId, runAttempt: '1', workflow: B.workflow } } });
    it('selects the bound account; CASUALTY: a lookalike address WITHOUT the binding, another run or another repository is never selected', async () => {
        const lookalike = { id: '0b9c5e2a-1111-4222-8333-444455556667', email: `${RUN_ACCOUNT_PREFIX}cloud-1-${B.runId}-1-ab@example.com`, app_metadata: {} };
        const userWritten = { ...lookalike, id: '0b9c5e2a-1111-4222-8333-444455556668', user_metadata: { ct_run: { repository: B.repository, runId: B.runId } } };
        const admin = page([bound(UID), lookalike, userWritten, bound('0b9c5e2a-1111-4222-8333-444455556669', '42800000002'),
            bound('0b9c5e2a-1111-4222-8333-44445555666a', B.runId, 'someone/speaksharp')]);
        expect(await findRunAccounts(admin, B)).toEqual({ accounts: [{ uid: UID, email: bound(UID).email }], complete: true });
        expect(sameBinding(undefined, B)).toBe(false);
    });
    it('CASUALTY: a provider error or a malformed page fails closed; a full page at the cap is incomplete', async () => {
        await expect(findRunAccounts(adminWith({ listUsers: vi.fn(async () => ({ data: null, error: { message: 'x' } })) as never }), B)).rejects.toThrow('list_users');
        await expect(findRunAccounts(adminWith({ listUsers: vi.fn(async () => ({ data: { users: null }, error: null })) as never }), B)).rejects.toThrow('list_users');
        const full = page([bound(UID)]);
        expect((await findRunAccounts(full, B, 1, 1)).complete).toBe(false);
    });
});

describe('CLI hygiene', () => {
    it('the CLI masks the email and password, writes the private record 0600 exclusively, and prints no account value', () => {
        const src = readFileSync(resolve(__dirname, '../../tools/cloud-test/scripts/run_account.ts'), 'utf8');
        expect(src).toContain('console.log(`::add-mask::${account.email}`);');
        expect(src).toContain('console.log(`::add-mask::${account.password}`);');
        expect(src).toContain("{ mode: 0o600, flag: 'wx' }");
        expect(src).not.toMatch(/JSON\.stringify\(\{[^}]*password/);
        const lines = [...src.matchAll(/line\(([^;]*)\);/g)].map((m) => m[1]);
        for (const l of lines) expect(l).not.toMatch(/uid|email|password|message/i);
    });
});
