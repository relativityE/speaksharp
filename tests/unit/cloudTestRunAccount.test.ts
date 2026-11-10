// @vitest-environment node
/**
 * Stripped-harness run account (PO plan step 3, option C; #1258; design review corrections): a fresh account per run attempt,
 * bound by server-written app_metadata to the COMPLETE scope; a lost create response is resolved by the binding, never a second
 * create; cleanup re-reads UID/email/binding and deletes through the existing fail-closed cleanup behind a provider-text
 * sanitizer with CLOSED failing-step codes; recovery needs a completed run; absent is UNVERIFIED, never clean.
 */
import { mkdtempSync, chmodSync, symlinkSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    LEGACY_FALLBACK_DOMAIN, RECORD_NAME, bundleWithRunAccount, RUN_ACCOUNT_PREFIX, cleanupRunAccount, cleanupStep, createRunAccount, findBoundAccounts, privateDirOk, projectRefFrom,
    readRecord, readRecordStrict, recoverRunAccount, findPendingAccount, cleanupFromRecord, runAccountDomain, runAccountEmail, runCompleted, runScopeFrom, sanitizingAdmin, scopeMatch, scrubRecord,
    writeRecord, type AccountAdmin, type RunScope,
} from '../../tools/cloud-test/scripts/run_account';
import { PRE_DELETE_TABLES, RESIDUE_CHECKS, cleanupRunOwnedAccount } from '../live/helpers/runOwnedCleanup';

const S: RunScope = { project: 'abcdefghijklmnopqrst', repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/cloud-test-aht.yml@refs/heads/main',
    runId: '42800000001', runAttempt: '1', role: 'existing-disposable' };
const ENV = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', GITHUB_REPOSITORY: S.repository, GITHUB_WORKFLOW_REF: S.workflow, GITHUB_RUN_ID: S.runId, GITHUB_RUN_ATTEMPT: '1' };
const UID = '0b9c5e2a-1111-4222-8333-444455556666';
const EMAIL = `${RUN_ACCOUNT_PREFIX}cloud-1794310000000-42800000001-1-abababab@example.com`;
const bytes = (n: number) => Buffer.alloc(n, 0xab);
const bound = (id = UID, email = EMAIL, scope: Partial<RunScope> | Record<string, unknown> = S) => ({ id, email, app_metadata: { ct_run: { ...scope } } });
const RECORD = { id: Number(S.runId), status: 'completed', run_attempt: 1, path: '.github/workflows/cloud-test-aht.yml', repository: { full_name: S.repository } };

/** A fake service-role client: one user store, provider errors carrying sensitive text, and a residue table store. */
function fakeAdmin(users: Array<Record<string, unknown>> = [], o: { createError?: string; getError?: { status?: number; code?: string; message: string } } = {}) {
    const store = [...users];
    const residue: Record<string, number | null> = {};
    const auth = { admin: {
        createUser: vi.fn(async (a: { email: string; app_metadata: Record<string, unknown> }) => {
            if (o.createError) return { data: null, error: { message: o.createError } };
            const u = { id: UID, email: a.email, app_metadata: a.app_metadata };
            store.push(u);
            return { data: { user: u }, error: null };
        }),
        listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => ({ data: { users: store.slice((page - 1) * perPage, page * perPage) }, error: null })),
        getUserById: vi.fn(async (id: string) => {
            if (o.getError) return { data: null, error: o.getError };
            const u = store.find((x) => x.id === id);
            return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: `User ${id} not found` } };
        }),
        deleteUser: vi.fn(async (id: string) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) store.splice(i, 1); return { error: null }; }),
    } };
    const from = vi.fn((table: string) => ({
        delete: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({ eq: async () => ({ count: table in residue ? residue[table] : 0, error: null }) }),
    }));
    return { admin: { auth, from } as unknown as AccountAdmin, store, residue, auth };
}

describe('scope', () => {
    it('the complete scope comes only from a well-formed protected-main GitHub run and a Supabase project URL', () => {
        expect(runScopeFrom(ENV)).toEqual(S);
        expect(projectRefFrom('https://evil.example/abcdefghijklmnopqrst.supabase.co')).toBeNull();
        for (const bad of [{ SUPABASE_URL: 'https://x.example' }, { GITHUB_RUN_ID: '0123' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_REPOSITORY: 'no-slash' },
            { GITHUB_WORKFLOW_REF: `${S.repository}/.github/workflows/cloud-test-aht.yml@refs/heads/feature` }, { GITHUB_WORKFLOW_REF: '' }]) {
            expect(runScopeFrom({ ...ENV, ...bad })).toBeNull();
        }
    });
    it('only the complete, exact scope matches; a ct_run naming this run otherwise is malformed', () => {
        expect(scopeMatch({ ct_run: { ...S } }, S)).toBe('match');
        for (const k of ['project', 'workflow', 'runAttempt', 'role'] as const) expect({ k, m: scopeMatch({ ct_run: { ...S, [k]: 'x' } }, S) }).toEqual({ k, m: 'malformed' });
        expect(scopeMatch({ ct_run: { ...S, runAttempt: '2' } }, S)).toBe('other');              // another attempt's own account
        expect(scopeMatch({ ct_run: { ...S, extra: 1 } }, S)).toBe('malformed');
        const missing: Record<string, string> = { ...S };
        delete missing.role;
        expect(scopeMatch({ ct_run: missing }, S)).toBe('malformed');
        expect(scopeMatch({ ct_run: { ...S, runId: '42800000002' } }, S)).toBe('other');
        for (const meta of [undefined, null, {}, { ct_run: 'x' }, { ct_run: [S] }]) expect(scopeMatch(meta as never, S)).toBe('other');
    });
    it('address and domain', () => {
        expect(runAccountEmail(S, 'example.com', 1794310000000, 'abababab')).toBe(EMAIL);
        expect(runAccountDomain('Tests.SpeakSharp.dev ')).toBe('tests.speaksharp.dev');
        for (const raw of [undefined, '', 'not a domain', 'a@b.c']) expect(runAccountDomain(raw)).toBe(LEGACY_FALLBACK_DOMAIN);
    });
});

describe('create', () => {
    it('ONE confirmed account whose app_metadata IS the complete scope, set in the create call; the password is never in the binding', async () => {
        const { admin, auth } = fakeAdmin();
        const a = await createRunAccount({ admin, scope: S, domain: 'example.com', nowMs: 1794310000000, random: bytes });
        expect(auth.admin.createUser).toHaveBeenCalledTimes(1);
        expect(auth.admin.createUser.mock.calls[0][0]).toEqual({ email: EMAIL, password: a.password, email_confirm: true, app_metadata: { ct_run: S } });
        expect([a.uid, a.password.length >= 32, JSON.stringify(auth.admin.createUser.mock.calls[0][0].app_metadata).includes(a.password)]).toEqual([UID, true, false]);
    });
    it('CASUALTY: a collision/provider error, a non-UUID id, another email or a returned binding that is not exactly the scope refuses', async () => {
        await expect(createRunAccount({ admin: fakeAdmin([], { createError: 'User already registered' }).admin, scope: S, domain: 'example.com', nowMs: 1, random: bytes })).rejects.toThrow('create_user');
        for (const user of [{ id: 'x', email: EMAIL, app_metadata: { ct_run: S } }, { id: UID, email: 'other@example.com', app_metadata: { ct_run: S } },
            { id: UID, email: EMAIL, app_metadata: {} }, { id: UID, email: EMAIL, app_metadata: { ct_run: { ...S, runAttempt: '2' } } }]) {
            const admin = { auth: { admin: { createUser: vi.fn(async () => ({ data: { user }, error: null })) } } } as unknown as AccountAdmin;
            await expect(createRunAccount({ admin, scope: S, domain: 'example.com', nowMs: 1794310000000, random: bytes, email: EMAIL })).rejects.toThrow('create_user');
        }
    });
    it('CASUALTY: create succeeded but the response was lost → the binding finds that ONE account; no second create', async () => {
        const f = fakeAdmin([bound()]);
        expect(await findPendingAccount({ admin: f.admin, scope: S, email: EMAIL })).toEqual({ status: 'found', account: { uid: UID, email: EMAIL } });
        expect(f.auth.admin.createUser).not.toHaveBeenCalled();
        const none = fakeAdmin([bound(UID, EMAIL, { ...S, runAttempt: '2' })]);
        expect(await findPendingAccount({ admin: none.admin, scope: S, email: EMAIL })).toEqual({ status: 'none_bound', step: 'not_created' });
        const twin = fakeAdmin([bound(), bound('0b9c5e2a-1111-4222-8333-444455556667', EMAIL.replace('abababab', 'cdcdcdcd'))]);
        expect(await findPendingAccount({ admin: twin.admin, scope: S, email: EMAIL })).toEqual({ status: 'hold', step: 'duplicate_binding' });
        const other = fakeAdmin([bound(UID, EMAIL.replace('abababab', 'cdcdcdcd'))]);
        expect(await findPendingAccount({ admin: other.admin, scope: S, email: EMAIL })).toEqual({ status: 'hold', step: 'reread_email_mismatch' });
    });
});

describe('cleanup', () => {
    it('re-reads the exact account, then deletes through the existing fail-closed cleanup (auth gone, residue counted zero)', async () => {
        const f = fakeAdmin([bound()]);
        expect(await cleanupRunAccount({ admin: f.admin, account: { uid: UID, email: EMAIL }, scope: S })).toEqual({ status: 'deleted' });
        expect(f.store).toEqual([]);
        expect(f.auth.admin.deleteUser).toHaveBeenCalledTimes(1);
    });
    it('CASUALTY: an absent account is UNVERIFIED (its binding died with it), never clean; an unknown read HOLDs', async () => {
        expect(await cleanupRunAccount({ admin: fakeAdmin().admin, account: { uid: UID, email: EMAIL }, scope: S })).toEqual({ status: 'unverified', step: 'account_absent' });
        const f = fakeAdmin([bound()], { getError: { status: 500, message: 'Customer Alice db timeout' } });
        expect(await cleanupRunAccount({ admin: f.admin, account: { uid: UID, email: EMAIL }, scope: S })).toEqual({ status: 'hold', step: 'reread_unknown' });
        expect(f.auth.admin.deleteUser).not.toHaveBeenCalled();
    });
    it('CASUALTY: a re-read with another email or binding (attempt, workflow, project, role, extra key) never deletes', async () => {
        for (const [name, user] of [['email', bound(UID, 'someone@example.com')], ['attempt', bound(UID, EMAIL, { ...S, runAttempt: '2' })],
            ['workflow', bound(UID, EMAIL, { ...S, workflow: 'x' })], ['project', bound(UID, EMAIL, { ...S, project: 'zzzzzzzzzzzzzzzzzzzz' })],
            ['role', bound(UID, EMAIL, { ...S, role: 'free' })], ['extra', bound(UID, EMAIL, { ...S, adopted: true })], ['none', { id: UID, email: EMAIL }]] as const) {
            const f = fakeAdmin([user as Record<string, unknown>]);
            const r = await cleanupRunAccount({ admin: f.admin, account: { uid: UID, email: EMAIL }, scope: S });
            expect({ name, status: r.status, deletes: f.auth.admin.deleteUser.mock.calls.length }).toEqual({ name, status: 'hold', deletes: 0 });
        }
        expect(await cleanupRunAccount({ admin: fakeAdmin().admin, account: { uid: 'nope', email: EMAIL }, scope: S })).toEqual({ status: 'hold', step: 'record_malformed' });
    });
    it('CASUALTY: null or malformed residue counts and found residue FAIL with a closed table code (no bypass)', async () => {
        const t = RESIDUE_CHECKS[0].table;
        for (const [count, step] of [[null, `residue_unproven:${t}`], [Number.NaN, `residue_unproven:${t}`], [2, `residue_found:${t}`]] as const) {
            const f = fakeAdmin([bound()]);
            f.residue[t] = count as number | null;
            expect(await cleanupRunAccount({ admin: f.admin, account: { uid: UID, email: EMAIL }, scope: S })).toEqual({ status: 'failed', step });
        }
    });
    it('provider text is replaced before the shared helper can throw or log it; status and code survive for not-found', async () => {
        const raw = { auth: { admin: {
            getUserById: vi.fn(async () => ({ data: null, error: { status: 404, code: 'user_not_found', message: 'User Customer Alice <a@b.c>' } })),
            deleteUser: vi.fn(async () => ({ error: { message: 'sk_live_secret Customer Alice' } })),
            createUser: vi.fn(), listUsers: vi.fn(),
        } }, from: () => ({ select: () => ({ eq: async () => ({ count: null, error: { code: '42P01', message: 'relation "Customer Alice" does not exist' } }) }) }) } as unknown as AccountAdmin;
        const s = sanitizingAdmin(raw);
        expect((await s.auth.admin.getUserById(UID)).error).toEqual({ status: 404, code: 'user_not_found', message: 'provider_error' });
        expect((await s.auth.admin.deleteUser(UID)).error).toEqual({ status: undefined, code: undefined, message: 'provider_error' });
        const q = await ((s.from('sessions') as { select: () => { eq: () => Promise<{ error: unknown }> } }).select().eq());
        expect(q.error).toEqual({ status: undefined, code: '42P01', message: 'provider_error' });
        // and through the real helper: its thrown message carries no provider text
        const f = fakeAdmin([bound()]);
        f.auth.admin.deleteUser.mockResolvedValueOnce({ error: { message: 'Customer Alice private account information' } } as never);
        const helperThrow = await cleanupRunOwnedAccount({ admin: sanitizingAdmin(f.admin) as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: RUN_ACCOUNT_PREFIX }).catch((e: Error) => e.message);
        expect(helperThrow).toBe('cleanup deleteUser failed (fail closed): provider_error');
    });
    it('the failing step is a CLOSED code for every helper throw site; free text and unknown tables are `unknown`', () => {
        const t = RESIDUE_CHECKS[0].table;
        const cases: [string, string][] = [
            ['cleanup getUserById failed (fail closed): x', 'get_user'], ['cleanup_uid_email_disagreement (fail closed)', 'uid_email_disagreement'],
            ['cleanup_refused_non_run_owned_account (fail closed)', 'non_run_owned'], ['cleanup requires admin client (fail closed)', 'no_admin'],
            [`cleanup ${PRE_DELETE_TABLES[0]} pre-delete failed (fail closed): x`, `pre_delete:${PRE_DELETE_TABLES[0]}`],
            ['cleanup deleteUser failed (fail closed): x', 'delete_user'], ['post-delete verify returned a non-not-found error — deletion UNPROVEN (fail closed): x', 'post_delete_verify'],
            ['auth user must be gone after cleanup (returned a user)', 'post_delete_verify'], [`cleanup residue query on ${t} failed (fail closed): x`, `residue_query:${t}`],
            [`cleanup found run-owned residue in ${t} (fail closed): count=2`, `residue_found:${t}`],
            [`cleanup residue count on ${t} was not a counted integer — residue UNPROVEN (fail closed)`, `residue_unproven:${t}`],
            ['cleanup found run-owned residue in customer_alice_secrets (fail closed): count=2', 'unknown'], ['Customer Alice private account information', 'unknown'], ['sk_live_x', 'unknown'],
        ];
        for (const [message, code] of cases) expect({ message, code: cleanupStep(new Error(message)) }).toEqual({ message, code });
        for (const thrown of [null, undefined, 'a string', 42, { message: 7 }]) expect(cleanupStep(thrown)).toBe('unknown');
    });
});

describe('recover (interrupted run): complete scope, completed run, exactly one', () => {
    it('deletes the ONE bound account of a completed run attempt; CASUALTY: lookalikes, user_metadata, other run/attempt/repo are never selected', async () => {
        const lookalike = { id: '0b9c5e2a-1111-4222-8333-444455556667', email: EMAIL, app_metadata: {} };
        const userWritten = { id: '0b9c5e2a-1111-4222-8333-444455556668', email: EMAIL, user_metadata: { ct_run: S } };
        const otherRun = bound('0b9c5e2a-1111-4222-8333-444455556669', EMAIL, { ...S, runId: '42800000002' });
        const otherRepo = bound('0b9c5e2a-1111-4222-8333-44445555666a', EMAIL, { ...S, repository: 'someone/speaksharp' });
        const f = fakeAdmin([lookalike, userWritten, otherRun, otherRepo, bound()]);
        expect(await recoverRunAccount({ admin: f.admin, scope: S, runRecord: RECORD })).toEqual({ status: 'deleted' });
        expect(f.store.map((u) => u.id)).toEqual([lookalike.id, userWritten.id, otherRun.id, otherRepo.id]);
    });
    it('CASUALTY: a still-active / other / re-attempted run, an incomplete listing, a malformed or duplicate binding HOLDs; absent is UNVERIFIED', async () => {
        for (const rec of [{ ...RECORD, status: 'in_progress' }, { ...RECORD, run_attempt: 2 }, { ...RECORD, id: 1 }, { ...RECORD, path: '.github/workflows/rc-gates.yml' },
            { ...RECORD, repository: { full_name: 'x/y' } }, null]) {
            const f = fakeAdmin([bound()]);
            expect(await recoverRunAccount({ admin: f.admin, scope: S, runRecord: rec })).toEqual({ status: 'hold', step: 'run_not_completed' });
            expect(f.auth.admin.deleteUser).not.toHaveBeenCalled();
        }
        const cases: [string, Array<Record<string, unknown>>, unknown][] = [
            ['malformed binding', [bound(UID, EMAIL, { ...S, role: 'pro' })], { status: 'hold', step: 'malformed_binding' }],
            ['duplicate binding', [bound(), bound('0b9c5e2a-1111-4222-8333-444455556667', EMAIL.replace('ab', 'cd'))], { status: 'hold', step: 'duplicate_binding' }],
            ['bound but non-run-owned address', [bound(UID, 'person@example.com')], { status: 'hold', step: 'malformed_binding' }],
            ['absent', [], { status: 'unverified', step: 'account_absent' }],
        ];
        for (const [name, users, expected] of cases) {
            const f = fakeAdmin(users);
            expect({ name, r: await recoverRunAccount({ admin: f.admin, scope: S, runRecord: RECORD }) }).toEqual({ name, r: expected });
            expect(f.auth.admin.deleteUser).not.toHaveBeenCalled();
        }
        const full = fakeAdmin([bound(), bound('0b9c5e2a-1111-4222-8333-444455556667', 'x@y.z', { ...S, runId: '1' })]);
        expect(await recoverRunAccount({ admin: full.admin, scope: S, runRecord: RECORD, perPage: 1, maxPages: 1 })).toEqual({ status: 'hold', step: 'incomplete_listing' });
        expect(runCompleted(RECORD, S)).toBe(true);
    });
    it('CASUALTY: a provider error or a malformed page fails closed', async () => {
        const bad = (r: unknown) => ({ auth: { admin: { listUsers: vi.fn(async () => r) } } }) as unknown as AccountAdmin;
        await expect(findBoundAccounts(bad({ data: null, error: { message: 'x' } }), S)).rejects.toThrow('list_users');
        await expect(findBoundAccounts(bad({ data: { users: null }, error: null }), S)).rejects.toThrow('list_users');
        await expect(findBoundAccounts(bad({ data: { users: [null] }, error: null }), S)).rejects.toThrow('list_users');
    });
});

describe('private record and CLI hygiene', () => {
    const dir = () => { const d = mkdtempSync(join(tmpdir(), 'ct-run-account-')); chmodSync(d, 0o700); return d; };
    it('the record is created exclusively (0600), never through a link, never holds the password, and is scrubbed', () => {
        const d = dir();
        expect(privateDirOk(d)).toBe(true);
        writeRecord(d, { state: 'creating', email: EMAIL, scope: S });
        expect(() => writeRecord(d, { state: 'creating' })).toThrow();                       // exclusive: no second provisioning
        expect(statSync(join(d, RECORD_NAME)).mode & 0o777).toBe(0o600);
        writeRecord(d, { state: 'created', uid: UID, email: EMAIL, scope: S }, true);
        expect(readRecord(d)).toEqual({ state: 'created', uid: UID, email: EMAIL, scope: S });
        scrubRecord(d);
        expect(existsSync(join(d, RECORD_NAME))).toBe(false);
        const e = dir();
        writeFileSync(join(e, 'elsewhere'), 'x');
        symlinkSync(join(e, 'elsewhere'), join(e, RECORD_NAME));
        expect(() => writeRecord(e, { state: 'creating' })).toThrow();                       // a planted link is refused
        expect(readRecord(e)).toBeNull();
        const open = mkdtempSync(join(tmpdir(), 'ct-run-account-open-'));
        chmodSync(open, 0o755);
        expect(privateDirOk(open)).toBe(false);
    });
    it('the CLI masks the email and password, keeps the password out of the record, and prints no account value', () => {
        const src = readFileSync(resolve(__dirname, '../../tools/cloud-test/scripts/run_account.ts'), 'utf8');
        expect(src).toContain('console.log(`::add-mask::${account.email}`);');
        expect(src).toContain('console.log(`::add-mask::${account.password}`);');
        for (const m of src.matchAll(/writeRecord\(dir, (\{[^}]*\})/g)) expect(m[1]).not.toMatch(/password/);
        for (const m of src.matchAll(/line\(([^;]*)\);/g)) expect(m[1]).not.toMatch(/uid|email|password|message|key/i);
        expect(src.match(/SERVICE_ROLE/g)).toHaveLength(1);
    });
});

describe('the harness bundle carries THIS run\'s account (never the shared one)', () => {
    const KEEP = { email: 'history@example.com', accountId: '1b9c5e2a-1111-4222-8333-444455556666' };
    const SHARED = { email: 'shared-throwaway@example.com', accountId: '2b9c5e2a-1111-4222-8333-444455556666' };
    const raw = (over: Record<string, unknown> = {}) => JSON.stringify({ version: 1, projectRef: S.project, accounts: { 'existing-disposable': SHARED, 'maintained-read-only': KEEP }, ...over });
    it('existing-disposable is replaced by the fresh account; maintained-read-only is kept', () => {
        const out = JSON.parse(bundleWithRunAccount(raw(), { uid: UID, email: EMAIL }, S) as string);
        expect(out).toEqual({ version: 1, projectRef: S.project, accounts: { 'existing-disposable': { email: EMAIL, accountId: UID }, 'maintained-read-only': KEEP } });
        expect(JSON.stringify(out)).not.toContain(SHARED.email);
    });
    it('CASUALTY: another project, a malformed or extra-keyed bundle, or a collision with the history account refuses', () => {
        for (const bad of [raw({ projectRef: 'zzzzzzzzzzzzzzzzzzzz' }), raw({ version: 2 }), raw({ extra: 1 }), 'not json', undefined,
            JSON.stringify({ version: 1, projectRef: S.project, accounts: { 'existing-disposable': SHARED } })]) {
            expect(bundleWithRunAccount(bad, { uid: UID, email: EMAIL }, S)).toBeNull();
        }
        expect(bundleWithRunAccount(raw(), { uid: KEEP.accountId, email: EMAIL }, S)).toBeNull();
        expect(bundleWithRunAccount(raw(), { uid: UID, email: KEEP.email }, S)).toBeNull();
    });
});

describe('record-driven cleanup (review: damaged records and partial-cleanup retries)', () => {
    const dir = () => { const d = mkdtempSync(join(tmpdir(), 'ct-run-account-rec-')); chmodSync(d, 0o700); return d; };
    it('a lost create response: the record is marked deleting with the found UID BEFORE deletion, then scrubbed once proven', async () => {
        const d = dir();
        writeRecord(d, { state: 'creating', email: EMAIL, scope: S });
        const f = fakeAdmin([bound()]);
        const seen: unknown[] = [];
        const cleanup = vi.fn(async (a: Parameters<typeof cleanupRunOwnedAccount>[0]) => { seen.push(readRecord(d)); return cleanupRunOwnedAccount(a); });
        expect(await cleanupFromRecord({ admin: f.admin, dir: d, scope: S, cleanup })).toEqual({ status: 'deleted' });
        expect(seen).toEqual([{ state: 'deleting', uid: UID, email: EMAIL, scope: S }]);
        expect(readRecordStrict(d)).toEqual({ kind: 'absent' });
    });
    it('a never-created account (complete listing, no binding) is not_created and scrubbed; no record = nothing provisioned', async () => {
        const d = dir();
        writeRecord(d, { state: 'creating', email: EMAIL, scope: S });
        expect(await cleanupFromRecord({ admin: fakeAdmin().admin, dir: d, scope: S })).toEqual({ status: 'none_bound', step: 'not_created' });
        expect(readRecordStrict(d)).toEqual({ kind: 'absent' });
        expect(await cleanupFromRecord({ admin: fakeAdmin().admin, dir: d, scope: S })).toEqual({ status: 'not_required', step: 'no_record' });
    });
    it('CASUALTY (review): a partial cleanup (auth deleted, residue unproven) then a retry stays UNVERIFIED and KEEPS the record', async () => {
        const d = dir();
        writeRecord(d, { state: 'created', uid: UID, email: EMAIL, scope: S });
        const f = fakeAdmin([bound()]);
        f.residue[RESIDUE_CHECKS[0].table] = null;                                  // auth deletion succeeds, a residue count is unknown
        const first = await cleanupFromRecord({ admin: f.admin, dir: d, scope: S });
        expect(first).toEqual({ status: 'failed', step: `residue_unproven:${RESIDUE_CHECKS[0].table}` });
        expect(f.store).toEqual([]);
        expect(readRecord(d)).toEqual({ state: 'deleting', uid: UID, email: EMAIL, scope: S });
        const retry = await cleanupFromRecord({ admin: f.admin, dir: d, scope: S });
        expect(retry).toEqual({ status: 'unverified', step: 'account_absent' });
        expect(readRecord(d)).toEqual({ state: 'deleting', uid: UID, email: EMAIL, scope: S });   // never lost, never "clean"
    });
    it('CASUALTY (review): lost create response + partial cleanup + retry never becomes not_created/scrubbed', async () => {
        const d = dir();
        writeRecord(d, { state: 'creating', email: EMAIL, scope: S });
        const f = fakeAdmin([bound()]);
        f.residue[RESIDUE_CHECKS[0].table] = 3;
        expect((await cleanupFromRecord({ admin: f.admin, dir: d, scope: S })).status).toBe('failed');
        const retry = await cleanupFromRecord({ admin: f.admin, dir: d, scope: S });
        expect([retry.status, readRecordStrict(d).kind]).toEqual(['unverified', 'ok']);
    });
    it('CASUALTY (review): a damaged record (not JSON, not an object, unknown state, bad uid, no email, a link, other scope) HOLDs', async () => {
        const cases: [string, (d: string) => void, string][] = [
            ['not JSON', (d) => writeFileSync(join(d, RECORD_NAME), '{oops', { mode: 0o600 }), 'record_damaged'],
            ['not an object', (d) => writeFileSync(join(d, RECORD_NAME), '[1]', { mode: 0o600 }), 'record_damaged'],
            ['unknown state', (d) => writeRecord(d, { state: 'done', uid: UID, email: EMAIL, scope: S }), 'record_damaged'],
            ['bad uid', (d) => writeRecord(d, { state: 'created', uid: 'x', email: EMAIL, scope: S }), 'record_damaged'],
            ['no email', (d) => writeRecord(d, { state: 'created', uid: UID, scope: S }), 'record_damaged'],
            ['other scope', (d) => writeRecord(d, { state: 'created', uid: UID, email: EMAIL, scope: { ...S, runAttempt: '2' } }), 'record_scope_mismatch'],
            ['extra scope key', (d) => writeRecord(d, { state: 'created', uid: UID, email: EMAIL, scope: { ...S, x: 1 } }), 'record_scope_mismatch'],
            ['a link', (d) => { writeFileSync(join(d, 'real'), JSON.stringify({ state: 'created', uid: UID, email: EMAIL, scope: S })); symlinkSync(join(d, 'real'), join(d, RECORD_NAME)); }, 'record_damaged'],
        ];
        for (const [name, plant, step] of cases) {
            const d = dir();
            plant(d);
            const f = fakeAdmin([bound()]);
            expect({ name, r: await cleanupFromRecord({ admin: f.admin, dir: d, scope: S }) }).toEqual({ name, r: { status: 'hold', step } });
            expect(f.auth.admin.deleteUser).not.toHaveBeenCalled();
        }
    });
});
