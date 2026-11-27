// @vitest-environment node
/**
 * The disposable stack's SEEDED completion coverage (accountDeletionLocalStack.mjs coverageSql), executed against the actual
 * completion migration in PostgreSQL WASM: it covers exactly one run-owned user's pending request under the enabled scope,
 * turns the shipped status reader's `coverage_unverified` into `ready`, and inserts nothing for anything else.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { completionBootstrap } from '../db/account-completion-fixture.mjs';
import { COVERAGE_EVIDENCE, closurePhaseSql, coverageSql, localDbUrl, retainedDataSql } from '../billing/user-journey/accountDeletionLocalStack.mjs';
import { classifyRetainedData, retainedGaps } from '../billing/user-journey/accountDeletionJourney';

const scope = 'd'.repeat(64);
let db: PGlite; let serial = 0;
const one = async (text: string, args: unknown[] = [], role?: string) => {
    await db.exec('RESET ROLE'); if (role) await db.exec(`SET ROLE ${role}`);
    const rows = (await db.query<Record<string, unknown>>(text, args)).rows; await db.exec('RESET ROLE');
    return Object.values(rows[0] ?? {})[0];
};
async function pendingUser() {
    const n = ++serial; const user = `d0110000-0000-4000-8000-${String(n).padStart(12, '0')}`; const hash = String(n).padStart(64, 'e');
    await one('INSERT INTO auth.users VALUES($1,$2,now())', [user, `coverage-${n}@example.invalid`]);
    await one('SELECT issue_account_closure_pending_token($1,$2)', [user, hash], 'service_role');
    const request = await one('SELECT request_id FROM account_closure_tokens WHERE user_id=$1', [user]) as string;
    await one('SELECT begin_account_closure_pending($1,$2,true)', [user, hash], 'service_role');
    return { user, request };
}
/** One acknowledged status capability per request (the page's own path), then the shipped reader's reason. */
async function capability(user: string, request: string) {
    const hash = String(++serial).padStart(64, 'f');
    await one('SELECT issue_account_completion_status_v1($1,$2,$3,$4)', [user, request, scope, hash], 'service_role');
    expect(await one('SELECT acknowledge_account_completion_status_v1($1,$2,$3,$4)', [user, request, scope, hash], 'service_role')).toBe(true);
    return async () => (await one('SELECT read_account_completion_status_v1($1,$2,$3)', [request, hash, scope], 'service_role') as { reason?: string })?.reason;
}
const seed = async (user: string) => (await db.query<{ request_id: string }>(coverageSql(user))).rows.map((r) => r.request_id);

beforeAll(async () => {
    db = new PGlite(); await db.exec(completionBootstrap());
    await db.exec(readFileSync('backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql', 'utf8'));
}, 30_000);
beforeEach(async () => { await one('UPDATE account_completion_configuration SET enabled=true,scope_digest=$1', [scope]); });

describe('disposable completion coverage for one pending request', () => {
    it('covers exactly the user\'s pending request under the enabled scope, and the status reader then says ready', async () => {
        const { user, request } = await pendingUser();
        const reason = await capability(user, request);
        expect(await reason()).toBe('coverage_unverified');
        expect(await seed(user)).toEqual([request]);
        expect(await one('SELECT count(*)::int FROM account_completion_coverage WHERE user_id=$1 AND request_id=$2 AND scope_digest=$3', [user, request, scope])).toBe(1);
        expect(await reason()).toBe('ready');
        expect(await one('SELECT legacy_producer_evidence FROM account_completion_coverage WHERE user_id=$1', [user])).toBe(COVERAGE_EVIDENCE.legacy);
    });
    it('inserts nothing for a user with no pending request, or while completion is not enabled', async () => {
        const n = ++serial; const idle = `d0110000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        await one('INSERT INTO auth.users VALUES($1,$2,now())', [idle, `coverage-${n}@example.invalid`]);
        expect(await seed(idle)).toEqual([]);
        const { user, request } = await pendingUser();
        await one('UPDATE account_completion_configuration SET enabled=false');
        expect(await seed(user)).toEqual([]);
        await one('UPDATE account_completion_configuration SET enabled=true');
        expect(await (await capability(user, request))()).toBe('coverage_unverified');
    });
    it('inserts nothing once the attempt or its billing fence is no longer pending', async () => {
        const moved = await pendingUser();
        await one("UPDATE account_closure_attempts SET phase='processing' WHERE user_id=$1", [moved.user]);
        expect(await seed(moved.user)).toEqual([]);
        const unfenced = await pendingUser();
        await one("UPDATE account_billing_fences SET phase='closing' WHERE user_id=$1", [unfenced.user]);
        expect(await seed(unfenced.user)).toEqual([]);
    });
    it('the closure phase is unreadable as service_role (run 45407419238) and readable over the stack database', async () => {
        const { user } = await pendingUser();
        await db.exec('SET ROLE service_role');
        const denied = await db.query("SELECT phase FROM public.account_closure_attempts WHERE user_id=$1", [user]).then(() => 'read', (e: { code?: string }) => e.code);
        await db.exec('RESET ROLE');
        expect(denied).toBe('42501');
        expect((await db.query<{ phase: string }>(closurePhaseSql(user))).rows.map((r) => r.phase)).toEqual(['pending']);
    });
    it('refuses a non-uuid user and a non-loopback database', () => {
        expect(() => coverageSql("x' OR true --")).toThrow('uuid');
        expect(localDbUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toContain('127.0.0.1:54322');
        for (const url of ['postgresql://postgres:postgres@db.example.supabase.co:5432/postgres', 'http://127.0.0.1:54322', 'nonsense']) {
            expect(() => localDbUrl(url)).toThrow();
        }
    });
    it('the journey seeds it once the confirmation is pending, before any status check can ask for readiness', () => {
        const spec = readFileSync('tests/billing/user-journey/account-deletion.billing.spec.ts', 'utf8');
        const loop = spec.slice(spec.indexOf('async function confirmAndComplete'), spec.indexOf('async function runLeg'));
        const seedAt = loop.indexOf("if (terminal === 'pending' && !covered) { seedCoverage(uid); covered = true; }");
        expect(seedAt).toBeGreaterThan(0);
        expect(seedAt).toBeLessThan(loop.indexOf('deletionLoopStep({'));
        expect(spec).toContain("execFileSync('psql', [localDbUrl(process.env.LOCAL_DB_URL ?? '')");
        expect(spec).toContain('confirmAndComplete(page, account.uid)');
    });
});

/**
 * psql, as the spec runs it (`psql -X -q -tA` with the script on stdin), for this script's three statement kinds: `\\set` (skipped:
 * PGlite stops on error anyway), statements ending in `;`, and the one catalog statement ending in `\\gexec`, whose every result
 * cell is run as its own statement. Output: each result's first column, one line per row.
 */
async function psqlScript(script: string): Promise<string> {
    const out: string[] = []; let buf: string[] = [];
    const firsts = async (q: string) => (await db.query<Record<string, unknown>>(q)).rows.map((r) => String(Object.values(r)[0]));
    for (const line of script.split('\n').filter((l) => !l.startsWith('\\set'))) {
        buf.push(line); const t = line.trimEnd();
        if (t.endsWith('\\gexec')) {
            const q = buf.join('\n').replace(/\\gexec\s*$/, ''); buf = [];
            for (const generated of await firsts(q)) out.push(...await firsts(generated));
        } else if (t.endsWith(';')) { const q = buf.join('\n'); buf = []; out.push(...await firsts(q)); }
    }
    expect(buf.join('').trim(), 'every statement terminated').toBe('');
    return out.join('\n');
}

describe('retained data after deletion, counted from the live catalog (retainedDataSql) on the real closure chain', () => {
    it('validates its inputs: a uuid user and the run\'s own address shape only', () => {
        expect(() => retainedDataSql("x' OR true --", 'a@example.invalid')).toThrow('uuid');
        expect(() => retainedDataSql('d0110000-0000-4000-8000-000000000001', "a'@example.invalid")).toThrow('address');
        const sql = retainedDataSql('d0110000-0000-4000-8000-000000000001', 'A@Example.invalid');
        expect(sql).toContain('BEGIN TRANSACTION READ ONLY;');
        expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
        expect(sql).toContain("WHERE email = 'a@example.invalid'");
        expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT)\b/);
    });
    it('after the Auth user is gone: every keyed type is counted, the trial email is kept unlinked, and a kept journal is named as a GAP', async () => {
        const { user } = await pendingUser();
        const email = (await one('SELECT email FROM auth.users WHERE id=$1', [user])) as string;
        await one('INSERT INTO public.trial_entitlements(email,user_id) VALUES($1,$2) ON CONFLICT (email) DO UPDATE SET user_id=excluded.user_id', [email, user]);
        await one('DELETE FROM auth.users WHERE id=$1', [user]);
        const out = await psqlScript(retainedDataSql(user, email));
        expect(out).not.toContain(user); expect(out).not.toContain(email);
        const r = classifyRetainedData(out);
        const types = r.records.map((x) => x.type);
        // The catalog walk found the FK-keyed and the deliberately FK-less user-keyed tables alike.
        for (const t of ['auth.users.id', 'storage.owned.objects', 'public.trial_entitlements.user_id', 'public.sessions.user_id',
            'public.account_closure_attempts.user_id']) expect(types).toContain(t);
        expect(r.records.find((x) => x.type === 'public.trial_entitlements.email')?.verdict).toBe('retained_allowed');
        // The closure journal outlives Auth with the claimed address: the deletion page's notice does not name it.
        expect(r.records.find((x) => x.type === 'public.account_closure_attempts.user_id')).toEqual(
            { type: 'public.account_closure_attempts.user_id', count: 1, withEmail: 1, verdict: 'gap' });
        expect(r.verdict).toBe('GAP');
        expect(retainedGaps(r)).toContain('public.account_closure_attempts.user_id');
    });
    it('a user who still exists is FAIL (the Auth user is counted), and the read changes nothing', async () => {
        const { user } = await pendingUser();
        const email = (await one('SELECT email FROM auth.users WHERE id=$1', [user])) as string;
        const before = await one('SELECT count(*)::int FROM account_closure_attempts');
        const r = classifyRetainedData(await psqlScript(retainedDataSql(user, email)));
        expect(r.records.find((x) => x.type === 'auth.users.id')).toMatchObject({ count: 1, verdict: 'violation' });
        expect(r.verdict).toBe('FAIL');
        expect(await one('SELECT count(*)::int FROM account_closure_attempts')).toBe(before);
    });
});
