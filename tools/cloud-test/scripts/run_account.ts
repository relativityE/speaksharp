/**
 * Fresh, run-bound disposable account for one stripped-harness run (PO plan step 3, option C; #1258).
 *
 * TRUST AND PROCESS BOUNDARY. The service-role key is project-wide privileged (not account-scoped). It is read only by this
 * script's CLI, in the workflow's provisioning and cleanup steps, which run protected-source (main) code BEFORE and AFTER the
 * harness. It is never in the harness / browser steps' environment and is never written anywhere. Step-scoped environment and a
 * 0600 file in a 0700 directory are exposure reductions against other users, not isolation from processes running as the same
 * runner user; the harness runs only after provisioning has exited and cleanup only after the harness step has ended.
 *
 * - create: ONE new confirmed account per run attempt. app_metadata.ct_run (written in the create call itself, from trusted
 *   workflow context; only the service role can write app_metadata) binds it to the complete scope {project, repository,
 *   workflow, runId, runAttempt, role}. A private record {state, uid, email, scope} — never the password — is created
 *   exclusively (no link following) BEFORE the call, so a lost response is recovered by the binding, never by creating a
 *   second account. An email collision is a refusal; an existing account is never adopted or relabelled.
 * - cleanup: re-reads the exact UID, email and complete binding, then deletes through the existing fail-closed
 *   cleanupRunOwnedAccount (deletion guards and retained feedback untouched; a locked/busy account or unknown read is a
 *   failure, never bypassed). Provider error text is replaced before that helper can throw or log it; the failing step is a
 *   CLOSED code.
 * - recover (interrupted run): the complete scope, a COMPLETED run only. Absent = UNVERIFIED (deleting the auth user also
 *   deletes its binding, so absence cannot prove a clean end), never clean.
 *
 * Admin-created, email-confirmed provisioning is a fixture: it is NOT evidence of signup or email confirmation.
 * Output is content-safe: a fixed token, a status and counts; never a UID, email, password, key or provider message.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { PRE_DELETE_TABLES, RESIDUE_CHECKS, cleanupRunOwnedAccount } from '../../../tests/live/helpers/runOwnedCleanup';

export const RUN_ACCOUNT_PREFIX = 'rwt-journey-';
export const RUN_ACCOUNT_LABEL = 'cloud';
export const RUN_ACCOUNT_ROLE = 'existing-disposable';
export const LEGACY_FALLBACK_DOMAIN = 'example.com';
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID_RE = /^[1-9]\d{0,19}$/;
const ATTEMPT_RE = /^[1-9]\d{0,3}$/;
const SCOPE_KEYS = ['project', 'repository', 'workflow', 'runId', 'runAttempt', 'role'] as const;

export interface RunScope { project: string; repository: string; workflow: string; runId: string; runAttempt: string; role: string }
export interface RunAccount { uid: string; email: string; password: string; scope: RunScope }
type Meta = Record<string, unknown> | null | undefined;
type ProviderError = { status?: number; code?: string; message: string } | null;
type User = { id?: string; email?: string | null; app_metadata?: Meta };

export interface AccountAdmin {
    auth: {
        admin: {
            createUser: (a: { email: string; password: string; email_confirm: boolean; app_metadata: Record<string, unknown> }) =>
                Promise<{ data: { user?: User | null } | null; error: ProviderError }>;
            listUsers: (a: { page: number; perPage: number }) => Promise<{ data: { users?: User[] } | null; error: ProviderError }>;
            getUserById: (uid: string) => Promise<{ data: { user?: User | null } | null; error: ProviderError }>;
            deleteUser: (uid: string) => Promise<{ error: ProviderError }>;
        };
    };
    from: (table: string) => unknown;
}

/* ------------------------------------------------------------------ scope ------------------------------------------------------------------ */

/** The Supabase project ref from its API URL (`https://<ref>.supabase.co`); null otherwise. */
export function projectRefFrom(url: string | undefined): string | null {
    try {
        const host = new URL(url ?? '').hostname;
        const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

/** The complete scope from trusted workflow context; null unless every field is well-formed. */
export function runScopeFrom(env: Record<string, string | undefined>): RunScope | null {
    const project = projectRefFrom(env.SUPABASE_URL);
    const s = { project: project ?? '', repository: env.GITHUB_REPOSITORY ?? '', workflow: env.GITHUB_WORKFLOW_REF ?? '',
        runId: env.GITHUB_RUN_ID ?? '', runAttempt: env.GITHUB_RUN_ATTEMPT ?? '', role: RUN_ACCOUNT_ROLE };
    if (!project || !/^[\w.-]+\/[\w.-]+$/.test(s.repository) || !/^[\w.-]+\/[\w.-]+\/\.github\/workflows\/[\w.-]+\.ya?ml@refs\/heads\/main$/.test(s.workflow)
        || !RUN_ID_RE.test(s.runId) || !ATTEMPT_RE.test(s.runAttempt)) return null;
    return s;
}

/** 'match' only for exactly the complete scope (no extra or missing key); 'malformed' for a ct_run naming this run otherwise. */
export function scopeMatch(meta: Meta, scope: RunScope): 'match' | 'malformed' | 'other' {
    const ct = meta?.ct_run;
    if (!ct || typeof ct !== 'object' || Array.isArray(ct)) return 'other';
    const c = ct as Record<string, unknown>;
    const exact = Object.keys(c).length === SCOPE_KEYS.length && SCOPE_KEYS.every((k) => c[k] === scope[k]);
    if (exact) return 'match';
    // another attempt's well-formed binding is that attempt's own account, not this one; anything else naming this run is malformed
    const sameButAttempt = Object.keys(c).length === SCOPE_KEYS.length && SCOPE_KEYS.every((k) => k === 'runAttempt' ? ATTEMPT_RE.test(String(c[k])) : c[k] === scope[k]);
    if (sameButAttempt) return 'other';
    return c.runId === scope.runId && c.repository === scope.repository ? 'malformed' : 'other';
}

export function runAccountDomain(raw: string | undefined): string {
    const d = (raw ?? '').trim().toLowerCase();
    return d && DOMAIN_RE.test(d) ? d : LEGACY_FALLBACK_DOMAIN;
}

/** `rwt-journey-cloud-<ms>-<runId>-<attempt>-<8 hex>@<domain>`: unique per creation; the binding, not the address, proves ownership. */
export function runAccountEmail(scope: RunScope, domain: string, nowMs: number, nonce: string): string {
    return `${RUN_ACCOUNT_PREFIX}${RUN_ACCOUNT_LABEL}-${nowMs}-${scope.runId}-${scope.runAttempt}-${nonce}@${domain}`;
}

/* ------------------------------------------------------------------ provider-text sanitizing ------------------------------------------------------------------ */

/** Replace every provider error's text before the shared cleanup helper can throw or log it; status/code survive (not-found). */
const clean = (e: ProviderError): ProviderError => (e ? { status: typeof e.status === 'number' ? e.status : undefined,
    code: typeof e.code === 'string' && /^[a-z0-9_]{1,64}$/i.test(e.code) ? e.code : undefined, message: 'provider_error' } : null);

export function sanitizingAdmin(admin: AccountAdmin): AccountAdmin {
    const wrap = <T extends { error?: ProviderError }>(p: Promise<T>): Promise<T> => p.then((r) => ({ ...r, error: clean(r.error ?? null) }));
    const chain = (target: unknown): unknown => new Proxy(target as object, {
        get(t, prop) {
            const v = Reflect.get(t, prop);
            if (prop === 'then' && typeof v === 'function') {
                return (res: (x: unknown) => unknown, rej: (x: unknown) => unknown) =>
                    (v as (a: unknown, b: unknown) => unknown).call(t, (x: { error?: ProviderError }) => res(x && typeof x === 'object' ? { ...x, error: clean(x.error ?? null) } : x), rej);
            }
            return typeof v === 'function' ? (...a: unknown[]) => chain((v as (...b: unknown[]) => unknown).apply(t, a)) : v;
        },
    });
    const a = admin.auth.admin;
    return {
        auth: { admin: {
            createUser: (x) => wrap(a.createUser(x)), listUsers: (x) => wrap(a.listUsers(x)),
            getUserById: (x) => wrap(a.getUserById(x)), deleteUser: (x) => wrap(a.deleteUser(x)),
        } },
        from: (table: string) => chain(admin.from(table)),
    };
}

/* ------------------------------------------------------------------ create ------------------------------------------------------------------ */

export async function createRunAccount(p: { admin: AccountAdmin; scope: RunScope; domain: string; nowMs: number; random?: (n: number) => Buffer; email?: string }):
    Promise<RunAccount> {
    const random = p.random ?? randomBytes;
    const email = p.email ?? runAccountEmail(p.scope, p.domain, p.nowMs, random(4).toString('hex'));
    const password = random(24).toString('base64url');
    const { data, error } = await p.admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { ct_run: { ...p.scope } } });
    const u = data?.user;
    // a collision or any error is a refusal; the returned account must be exactly the one asked for, with exactly this binding
    if (error || !UUID_RE.test(u?.id ?? '') || (u?.email ?? '').toLowerCase() !== email || scopeMatch(u?.app_metadata, p.scope) !== 'match') {
        throw new Error('create_user');
    }
    return { uid: u?.id as string, email, password, scope: p.scope };
}

/* ------------------------------------------------------------------ cleanup ------------------------------------------------------------------ */

/** The cleanup's failing step as a CLOSED code. Table names come only from the reviewed inventory; anything else is `unknown`. */
const TABLES = new Set<string>([...RESIDUE_CHECKS.map((c) => c.table), ...PRE_DELETE_TABLES]);
export function cleanupStep(error: unknown): string {
    const m = String((error as { message?: unknown } | null)?.message ?? '');
    const table = (re: RegExp, code: string) => { const t = re.exec(m)?.[1]; return t && TABLES.has(t) ? `${code}:${t}` : null; };
    return (/^cleanup getUserById failed/.test(m) && 'get_user')
        || (/^cleanup_uid_email_disagreement/.test(m) && 'uid_email_disagreement')
        || (/^cleanup_refused_non_run_owned_account/.test(m) && 'non_run_owned')
        || (/^cleanup requires admin client/.test(m) && 'no_admin')
        || table(/^cleanup ([a-z_]+) pre-delete failed/, 'pre_delete')
        || (/^cleanup deleteUser failed/.test(m) && 'delete_user')
        || ((/^post-delete verify/.test(m) || /auth user must be gone/.test(m)) && 'post_delete_verify')
        || table(/^cleanup residue query on ([a-z_]+) failed/, 'residue_query')
        || table(/^cleanup found run-owned residue in ([a-z_]+)/, 'residue_found')
        || table(/^cleanup residue count on ([a-z_]+) was not a counted integer/, 'residue_unproven')
        || 'unknown';
}

export type CleanupResult = { status: 'deleted' } | { status: 'hold' | 'failed' | 'unverified'; step: string };
type Cleanup = typeof cleanupRunOwnedAccount;

/** Re-read the exact UID, email and complete binding; then the existing fail-closed cleanup through the sanitizing admin. */
export async function cleanupRunAccount(p: { admin: AccountAdmin; account: { uid: string; email: string }; scope: RunScope; cleanup?: Cleanup }): Promise<CleanupResult> {
    const admin = sanitizingAdmin(p.admin);
    if (!UUID_RE.test(p.account.uid)) return { status: 'hold', step: 'record_malformed' };
    const { data, error } = await admin.auth.admin.getUserById(p.account.uid);
    if (error) return error.status === 404 || error.code === 'user_not_found' ? { status: 'unverified', step: 'account_absent' } : { status: 'hold', step: 'reread_unknown' };
    const u = data?.user;
    if (!u) return { status: 'unverified', step: 'account_absent' };
    if ((u.email ?? '').toLowerCase() !== p.account.email.toLowerCase()) return { status: 'hold', step: 'reread_email_mismatch' };
    if (scopeMatch(u.app_metadata, p.scope) !== 'match') return { status: 'hold', step: 'reread_binding_mismatch' };
    try {
        await (p.cleanup ?? cleanupRunOwnedAccount)({ admin: admin as never, capturedUid: p.account.uid, createdEmail: p.account.email, runOwnedPrefix: RUN_ACCOUNT_PREFIX });
        return { status: 'deleted' };
    } catch (e) {
        return { status: 'failed', step: cleanupStep(e) };
    }
}

/* ------------------------------------------------------------------ binding lookup / recovery ------------------------------------------------------------------ */

export async function findBoundAccounts(admin: AccountAdmin, scope: RunScope, perPage = 200, maxPages = 50):
    Promise<{ accounts: Array<{ uid: string; email: string }>; malformed: number; complete: boolean }> {
    const accounts: Array<{ uid: string; email: string }> = [];
    let malformed = 0;
    for (let page = 1; page <= maxPages; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        const users: unknown = data?.users;
        if (error || !Array.isArray(users) || users.some((u) => typeof u !== 'object' || u === null)) throw new Error('list_users');
        for (const u of users as User[]) {
            const m = scopeMatch(u.app_metadata, scope);
            const email = (u.email ?? '').toLowerCase();
            if (m === 'malformed' || (m === 'match' && (!UUID_RE.test(u.id ?? '') || !email.startsWith(RUN_ACCOUNT_PREFIX)))) malformed += 1;
            else if (m === 'match') accounts.push({ uid: u.id as string, email });
        }
        if (users.length < perPage) return { accounts, malformed, complete: true };
    }
    return { accounts, malformed, complete: false };
}

/** GitHub's record of the run: completed, this repository and workflow file, the expected attempt. */
export function runCompleted(record: unknown, scope: RunScope): boolean {
    const r = (record ?? {}) as Record<string, unknown>;
    const path = scope.workflow.replace(/^[\w.-]+\/[\w.-]+\//, '').replace(/@refs\/heads\/main$/, '');
    return String(r.id) === scope.runId && r.status === 'completed' && String(r.run_attempt) === scope.runAttempt && r.path === path
        && (r.repository as { full_name?: unknown } | undefined)?.full_name === scope.repository;
}

export type RecoverResult = CleanupResult | { status: 'none_bound' | 'hold'; step: string };
/** One bound account of a COMPLETED run attempt, exactly; anything else HOLDs. Absent = UNVERIFIED, never clean. */
export async function recoverRunAccount(p: { admin: AccountAdmin; scope: RunScope; runRecord: unknown; cleanup?: Cleanup; perPage?: number; maxPages?: number }): Promise<RecoverResult> {
    if (!runCompleted(p.runRecord, p.scope)) return { status: 'hold', step: 'run_not_completed' };
    const { accounts, malformed, complete } = await findBoundAccounts(p.admin, p.scope, p.perPage, p.maxPages);
    if (!complete) return { status: 'hold', step: 'incomplete_listing' };
    if (malformed) return { status: 'hold', step: 'malformed_binding' };
    if (accounts.length > 1) return { status: 'hold', step: 'duplicate_binding' };
    if (accounts.length === 0) return { status: 'unverified', step: 'account_absent' };
    return cleanupRunAccount({ admin: p.admin, account: accounts[0], scope: p.scope, cleanup: p.cleanup });
}

/** After a create whose response or record write was lost: the binding decides, never a second create. */
export async function resolvePendingCreate(p: { admin: AccountAdmin; scope: RunScope; email: string; cleanup?: Cleanup }): Promise<RecoverResult> {
    const { accounts, malformed, complete } = await findBoundAccounts(p.admin, p.scope);
    if (!complete) return { status: 'hold', step: 'incomplete_listing' };
    if (malformed || accounts.length > 1) return { status: 'hold', step: malformed ? 'malformed_binding' : 'duplicate_binding' };
    if (accounts.length === 0) return { status: 'none_bound', step: 'not_created' };
    if (accounts[0].email !== p.email.toLowerCase()) return { status: 'hold', step: 'reread_email_mismatch' };
    return cleanupRunAccount({ admin: p.admin, account: accounts[0], scope: p.scope, cleanup: p.cleanup });
}

/* ------------------------------------------------------------------ live-accounts bundle ------------------------------------------------------------------ */

/**
 * The harness's account bundle (init_run_inputs.parse_live_accounts_bundle: {version:1, projectRef, accounts:{existing-disposable,
 * maintained-read-only}}) with the existing-disposable role REPLACED by this run's fresh account, so the run never falls back to
 * the shared one. maintained-read-only (AHT-15's history account) is kept as configured. Same project only; null on any mismatch.
 */
export function bundleWithRunAccount(raw: string | undefined, account: { uid: string; email: string }, scope: RunScope): string | null {
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(raw ?? ''); } catch { return null; }
    const accounts = doc?.accounts as Record<string, { email?: unknown; accountId?: unknown }> | undefined;
    const keep = accounts?.['maintained-read-only'];
    if (doc?.version !== 1 || doc.projectRef !== scope.project || !keep || typeof keep.email !== 'string' || typeof keep.accountId !== 'string'
        || Object.keys(doc).sort().join() !== 'accounts,projectRef,version' || Object.keys(accounts ?? {}).sort().join() !== 'existing-disposable,maintained-read-only'
        || keep.email.toLowerCase() === account.email.toLowerCase() || keep.accountId === account.uid) return null;
    return JSON.stringify({ version: 1, projectRef: scope.project, accounts: {
        'existing-disposable': { email: account.email, accountId: account.uid },
        'maintained-read-only': { email: keep.email, accountId: keep.accountId },
    } });
}

/* ------------------------------------------------------------------ private record ------------------------------------------------------------------ */

export const RECORD_NAME = 'run-account.json';
/** The private directory must be a real 0700 directory owned by this user (not a link). */
export function privateDirOk(dir: string): boolean {
    try {
        const s = lstatSync(dir);
        return s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && (typeof process.getuid !== 'function' || s.uid === process.getuid());
    } catch {
        return false;
    }
}
/** Exclusive create, never following a link (O_EXCL|O_NOFOLLOW); replace = write a fresh exclusive temp file, then rename. */
export function writeRecord(dir: string, record: Record<string, unknown>, replace = false): void {
    const target = join(dir, RECORD_NAME);
    const path = replace ? `${target}.next` : target;
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeSync(fd, JSON.stringify(record)); fsyncSync(fd); } finally { closeSync(fd); }
    if (replace) renameSync(path, target);
}
export function readRecord(dir: string): Record<string, unknown> | null {
    try {
        const fd = openSync(join(dir, RECORD_NAME), constants.O_RDONLY | constants.O_NOFOLLOW);
        try { return JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    } catch {
        return null;
    }
}
export function scrubRecord(dir: string): void {
    for (const n of [RECORD_NAME, `${RECORD_NAME}.next`]) { try { unlinkSync(join(dir, n)); } catch { /* absent */ } }
}

/* ------------------------------------------------------------------ CLI (GitHub Actions, protected source only) ------------------------------------------------------------------ */
function line(s: string): void { console.log(`CT_RUN_ACCOUNT ${s}`); }
const report = (cmd: string, r: RecoverResult) => line(r.status === 'deleted' ? `${cmd} status=deleted residue=0` : `${cmd} status=${r.status} step=${r.step}`);

async function main(argv: string[]): Promise<number> {
    const [command, dir, runRecordFile] = argv;
    const url = process.env.SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const scope = runScopeFrom(process.env);
    if (!url || !key || !dir || !privateDirOk(dir) || !scope) { line(`${command ?? 'none'} status=blocked step=inputs`); return 78; }
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as AccountAdmin;
    if (command === 'create') {
        if (readRecord(dir)) { line('create status=blocked step=already_provisioned'); return 78; }
        const env = process.env.GITHUB_ENV;
        if (!env) { line('create status=blocked step=github_env'); return 78; }
        const email = runAccountEmail(scope, runAccountDomain(process.env.LIVE_TEST_EMAIL_DOMAIN), Date.now(), randomBytes(4).toString('hex'));
        writeRecord(dir, { state: 'creating', email, scope });                  // before the call: a lost response is recoverable
        let account: RunAccount;
        try {
            account = await createRunAccount({ admin: sanitizingAdmin(admin), scope, domain: '', nowMs: 0, email });
        } catch {
            line('create status=failed step=create_user'); return 1;            // cleanup resolves the pending record by binding
        }
        writeRecord(dir, { state: 'created', uid: account.uid, email: account.email, scope }, true);
        console.log(`::add-mask::${account.email}`);
        console.log(`::add-mask::${account.password}`);
        console.log(`::add-mask::${account.uid}`);
        // the harness's bundle with existing-disposable = THIS account (the workflow must not also set the shared account's
        // CLOUD_TEST_LIVE_ACCOUNTS / THROWAWAY_TEST_* at step level, which would override these)
        const bundle = bundleWithRunAccount(process.env.CLOUD_TEST_LIVE_ACCOUNTS, account, scope);
        if (!bundle) { line('create status=failed step=bundle'); return 1; }                  // cleanup still deletes it by the record
        appendFileSync(env, `THROWAWAY_TEST_EMAIL=${account.email}\nTHROWAWAY_TEST_PASSWORD=${account.password}\nCT_PROVISIONED_UID=${account.uid}\n`
            + `CLOUD_TEST_LIVE_ACCOUNTS=${bundle}\n`);
        line('create status=created bound=1');
        return 0;
    }
    if (command === 'cleanup') {
        const rec = readRecord(dir);
        if (!rec) { line('cleanup status=not_required step=no_record'); return 0; }
        const recScope = rec.scope as RunScope;
        if (!recScope || SCOPE_KEYS.some((k) => recScope[k] !== scope[k])) { line('cleanup status=hold step=record_scope_mismatch'); return 1; }
        const r = rec.state === 'created'
            ? await cleanupRunAccount({ admin, account: { uid: String(rec.uid), email: String(rec.email) }, scope })
            : await resolvePendingCreate({ admin: sanitizingAdmin(admin), scope, email: String(rec.email) });
        report('cleanup', r);
        if (r.status === 'deleted' || r.status === 'none_bound') scrubRecord(dir);
        return r.status === 'deleted' || r.status === 'none_bound' ? 0 : 1;
    }
    if (command === 'recover') {
        let runRecord: unknown = null;
        try { runRecord = JSON.parse(readFileSync(runRecordFile ?? '', 'utf8')); } catch { /* run_not_completed */ }
        const target = { ...scope, runId: String((runRecord as { id?: unknown } | null)?.id ?? ''), runAttempt: String((runRecord as { run_attempt?: unknown } | null)?.run_attempt ?? '') };
        if (!RUN_ID_RE.test(target.runId) || !ATTEMPT_RE.test(target.runAttempt)) { line('recover status=blocked step=run_record'); return 78; }
        const r = await recoverRunAccount({ admin: sanitizingAdmin(admin), scope: target, runRecord });
        report('recover', r);
        return r.status === 'deleted' ? 0 : 1;
    }
    line('none status=blocked step=command');
    return 78;
}

if (process.argv[1] && /run_account\.ts$/.test(process.argv[1])) {
    main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, () => { line('status=failed step=unknown'); process.exitCode = 1; });
}
