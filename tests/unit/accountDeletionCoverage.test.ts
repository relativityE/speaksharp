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
import { COVERAGE_EVIDENCE, coverageSql, localDbUrl } from '../billing/user-journey/accountDeletionLocalStack.mjs';

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
