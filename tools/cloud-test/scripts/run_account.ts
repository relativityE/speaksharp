/**
 * Fresh, run-bound disposable account for one stripped-harness run (PO plan step 3, option C; #1258).
 *
 * - create: a NEW confirmed account per run through the service role. `app_metadata.ct_run` binds it to this exact workflow
 *   run ({repository, runId, runAttempt, workflow}); only the service role can write app_metadata, so the binding is trusted,
 *   not a pattern. The UID, email and password go to ONE private 0600 file (never uploaded: the repository is public); the
 *   email and password are masked in the log and handed to the harness through $GITHUB_ENV.
 * - cleanup: deletes exactly that UID through the existing fail-closed cleanupRunOwnedAccount (auth deletion + every residue
 *   readback = 0; retained feedback stays by policy) and reports the failing step as a CLOSED code, never error text.
 * - recover: for an interrupted run, the accounts whose app_metadata.ct_run names that run in this repository, and nothing else.
 *
 * Content-safe output only: a fixed token, a status and counts; never a UID, email, password or provider message.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { RESIDUE_CHECKS, PRE_DELETE_TABLES, cleanupRunOwnedAccount } from '../../../tests/live/helpers/runOwnedCleanup';

export const RUN_ACCOUNT_PREFIX = 'rwt-journey-';
export const RUN_ACCOUNT_LABEL = 'cloud';
export const LEGACY_FALLBACK_DOMAIN = 'example.com';
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID_RE = /^[1-9]\d{0,19}$/;

export interface RunBinding { repository: string; runId: string; runAttempt: string; workflow: string }
export interface RunAccount { uid: string; email: string; password: string; binding: RunBinding }

type AppMetadata = Record<string, unknown> | undefined;
export interface AccountAdmin {
    auth: {
        admin: {
            createUser: (a: { email: string; password: string; email_confirm: boolean; app_metadata: Record<string, unknown> }) =>
                Promise<{ data: { user?: { id?: string; email?: string | null } | null } | null; error: { code?: string; message: string } | null }>;
            listUsers: (a: { page: number; perPage: number }) =>
                Promise<{ data: { users?: Array<{ id?: string; email?: string | null; app_metadata?: AppMetadata }> } | null; error: { code?: string; message: string } | null }>;
        };
    };
}

/** The run binding from the GitHub Actions environment; null unless every field is well-formed. */
export function runBindingFrom(env: Record<string, string | undefined>): RunBinding | null {
    const b = { repository: env.GITHUB_REPOSITORY ?? '', runId: env.GITHUB_RUN_ID ?? '', runAttempt: env.GITHUB_RUN_ATTEMPT ?? '', workflow: env.GITHUB_WORKFLOW_REF ?? '' };
    if (!/^[\w.-]+\/[\w.-]+$/.test(b.repository) || !RUN_ID_RE.test(b.runId) || !/^[1-9]\d{0,3}$/.test(b.runAttempt) || !b.workflow) return null;
    return b;
}

/** The run-owned domain: an explicit, valid LIVE_TEST_EMAIL_DOMAIN, else the generators' fallback. */
export function runAccountDomain(raw: string | undefined): string {
    const d = (raw ?? '').trim().toLowerCase();
    return d && DOMAIN_RE.test(d) ? d : LEGACY_FALLBACK_DOMAIN;
}

/** `rwt-journey-cloud-<ms>-<runId>-<attempt>-<8 hex>@<domain>`: unique per creation; the binding, not the address, proves ownership. */
export function runAccountEmail(binding: RunBinding, domain: string, nowMs: number, nonce: string): string {
    return `${RUN_ACCOUNT_PREFIX}${RUN_ACCOUNT_LABEL}-${nowMs}-${binding.runId}-${binding.runAttempt}-${nonce}@${domain}`;
}

export function sameBinding(meta: AppMetadata, binding: Pick<RunBinding, 'repository' | 'runId'>): boolean {
    const ct = (meta?.ct_run ?? null) as Record<string, unknown> | null;
    return !!ct && ct.repository === binding.repository && ct.runId === binding.runId;
}

export async function createRunAccount(p: { admin: AccountAdmin; binding: RunBinding; domain: string; nowMs: number; random?: (n: number) => Buffer }):
    Promise<RunAccount> {
    const random = p.random ?? randomBytes;
    const email = runAccountEmail(p.binding, p.domain, p.nowMs, random(4).toString('hex'));
    const password = random(24).toString('base64url');
    const { data, error } = await p.admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { ct_run: { ...p.binding } } });
    const uid = data?.user?.id ?? '';
    if (error || !UUID_RE.test(uid) || (data?.user?.email ?? '').toLowerCase() !== email) throw new Error('create_user');
    return { uid, email, password, binding: p.binding };
}

/** The cleanup's failing step as a CLOSED code. Table names come only from the reviewed lists; anything else is `unknown`. */
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

type Cleanup = typeof cleanupRunOwnedAccount;
export async function cleanupRunAccount(p: { admin: unknown; account: Pick<RunAccount, 'uid' | 'email'>; cleanup?: Cleanup }): Promise<{ status: 'deleted' } | { status: 'failed'; step: string }> {
    const cleanup = p.cleanup ?? cleanupRunOwnedAccount;
    try {
        await cleanup({ admin: p.admin as never, capturedUid: p.account.uid, createdEmail: p.account.email, runOwnedPrefix: RUN_ACCOUNT_PREFIX });
        return { status: 'deleted' };
    } catch (error) {
        return { status: 'failed', step: cleanupStep(error) };
    }
}

/** Interrupted-run recovery: ONLY the accounts whose server-written app_metadata.ct_run names exactly this run here. */
export async function findRunAccounts(admin: AccountAdmin, binding: Pick<RunBinding, 'repository' | 'runId'>, perPage = 200, maxPages = 50):
    Promise<{ accounts: Array<{ uid: string; email: string }>; complete: boolean }> {
    const accounts: Array<{ uid: string; email: string }> = [];
    for (let page = 1; page <= maxPages; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        const users: unknown = data?.users;
        if (error || !Array.isArray(users)) throw new Error('list_users');
        for (const u of users as Array<{ id?: string; email?: string | null; app_metadata?: AppMetadata }>) {
            const email = (u.email ?? '').toLowerCase();
            if (sameBinding(u.app_metadata, binding) && UUID_RE.test(u.id ?? '') && email.startsWith(RUN_ACCOUNT_PREFIX)) accounts.push({ uid: u.id as string, email });
        }
        if (users.length < perPage) return { accounts, complete: true };
    }
    return { accounts, complete: false };
}

/* ------------------------------------------------------------------ CLI (GitHub Actions only) ------------------------------------------------------------------ */
function line(s: string): void { console.log(`CT_RUN_ACCOUNT ${s}`); }

async function main(argv: string[]): Promise<number> {
    const [command, file] = argv;
    const url = process.env.SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !key || !file) { line(`${command ?? 'none'} status=blocked step=inputs`); return 78; }
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    if (command === 'create') {
        const binding = runBindingFrom(process.env);
        if (!binding) { line('create status=blocked step=binding'); return 78; }
        let account: RunAccount;
        try {
            account = await createRunAccount({ admin: admin as unknown as AccountAdmin, binding, domain: runAccountDomain(process.env.LIVE_TEST_EMAIL_DOMAIN), nowMs: Date.now() });
        } catch {
            line('create status=failed step=create_user'); return 1;
        }
        writeFileSync(file, JSON.stringify({ uid: account.uid, email: account.email, binding }), { mode: 0o600, flag: 'wx' });
        console.log(`::add-mask::${account.email}`);
        console.log(`::add-mask::${account.password}`);
        const env = process.env.GITHUB_ENV;
        if (!env) { line('create status=blocked step=github_env'); return 78; }
        appendFileSync(env, `THROWAWAY_TEST_EMAIL=${account.email}\nTHROWAWAY_TEST_PASSWORD=${account.password}\n`);
        line('create status=created bound=1');
        return 0;
    }
    if (command === 'cleanup') {
        let account: { uid: string; email: string };
        try { account = JSON.parse(readFileSync(file, 'utf8')); } catch { line('cleanup status=not_required step=no_account'); return 0; }
        const r = await cleanupRunAccount({ admin, account });
        line(r.status === 'deleted' ? 'cleanup status=deleted residue=0' : `cleanup status=failed step=${r.step}`);
        return r.status === 'deleted' ? 0 : 1;
    }
    if (command === 'recover') {
        const runId = file;
        const repository = process.env.GITHUB_REPOSITORY ?? '';
        if (!RUN_ID_RE.test(runId)) { line('recover status=blocked step=run_id'); return 78; }
        const { accounts, complete } = await findRunAccounts(admin as unknown as AccountAdmin, { repository, runId });
        if (!complete) { line(`recover status=hold step=incomplete_listing found=${accounts.length}`); return 1; }
        let deleted = 0;
        for (const account of accounts) {
            const r = await cleanupRunAccount({ admin, account });
            if (r.status !== 'deleted') { line(`recover status=failed step=${r.step} found=${accounts.length} deleted=${deleted}`); return 1; }
            deleted += 1;
        }
        line(`recover status=${accounts.length ? 'deleted' : 'none_bound'} found=${accounts.length} deleted=${deleted}`);
        return 0;
    }
    line('none status=blocked step=command');
    return 78;
}

if (process.argv[1] && /run_account\.ts$/.test(process.argv[1])) {
    main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, () => { line('status=failed step=unknown'); process.exitCode = 1; });
}
