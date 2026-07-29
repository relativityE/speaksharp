// @vitest-environment node
//
// #1091 SECURITY — authorization contract for public.get_analytics_summary.
//
// Kept in its OWN file, separate from analytics-summary-rpc.integration.test.ts, because this is a
// separate review finding on an authorization path and carries its own authorization line in the
// migration package. The analytics arithmetic and this security contract must be reviewable apart.
//
// THE DEFECT: `IF p_user_id != auth.uid() THEN RAISE` evaluates to NULL — not true — when auth.uid()
// is NULL. The RAISE never fired. Because the function is SECURITY DEFINER it also bypasses the RLS
// policy on public.sessions, so that guard was the only barrier. On top of that, PostgreSQL grants
// EXECUTE to PUBLIC by default at function creation and no migration ever revoked it for this
// function — although the same codebase does revoke PUBLIC on process_stripe_webhook_event,
// create_session_and_update_usage, check_usage_limit, update_user_usage and consume_formatter_quota.
// The hardening pattern existed and this function was missed.
//
// CLASSIFICATION — stated to the evidence, not beyond it:
//   * Anon-role EXECUTE reachability in production is CONFIRMED (observed independently: a request
//     carrying only the browser-visible publishable key and NO user JWT returned HTTP 200).
//   * Cross-tenant DATA DISCLOSURE against production is NOT proven — that probe used the nil UUID,
//     which owns no rows. Nothing in this suite should be read as a demonstrated production exploit.
//   * What IS proven here, in a disposable local database seeded with synthetic rows, is the
//     MECHANISM: with the superseded definition an unidentified caller receives another user's
//     aggregates. That is a mechanism proof against repo artifacts, not an attack on production.
//   * service_role is already a privileged credential. Anything it can do is not an ordinary-user
//     exploit and is never described as one here.
//
// Content-free: synthetic UUIDs only. Disposable in-memory database; nothing is applied anywhere.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const NEW_MIGRATION = readFileSync(
    resolve(migrationsDir, '20260729130000_analytics_summary_evidence_validity.sql'), 'utf8',
);
/** The definition currently deployed — what this migration replaces. */
const SUPERSEDED_MIGRATION = readFileSync(
    resolve(migrationsDir, '20260522110000_cleanup_stale_schema_lint.sql'), 'utf8',
);
const BOOTSTRAP = readFileSync(
    resolve(process.cwd(), 'tests', 'db', 'analytics-summary-bootstrap.sql'), 'utf8',
);

const VICTIM = '11111111-1111-4111-8111-111111111111';
const ATTACKER = '22222222-2222-4222-8222-222222222222';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const baseDb = async (migration: string) => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(migration);
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${VICTIM}'), ('${ATTACKER}')`);
    // Give the victim real, distinctive analytics so a disclosure is unmistakable.
    await db.exec(`
        INSERT INTO public.sessions (user_id, created_at, duration, total_words, clarity_score, wpm, accuracy, engine, filler_words)
        VALUES ('${VICTIM}', '2026-07-01T10:00:00Z', 600, 900, 91, 90, 0.95, 'private-v2', '{"um":{"count":3},"total":{"count":3}}'),
               ('${VICTIM}', '2026-07-02T10:00:00Z', 600, 900, 89, 90, 0.95, 'private-v2', '{"um":{"count":3},"total":{"count":3}}')
    `);
    return db;
};

/** Set the PostgREST-equivalent identity claim. Empty string = no resolvable identity. */
const actAs = async (db: PGlite, sub: string | null) =>
    db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);

const call = (db: PGlite, forUser: string | null) =>
    db.query('SELECT public.get_analytics_summary($1) AS r', [forUser]);

describe('#1091 SECURITY — get_analytics_summary authorization', () => {
    describe('the defect, reproduced against the SUPERSEDED definition', () => {
        it('MECHANISM PROOF: an unidentified caller receives another user\'s analytics', async () => {
            const db = await baseDb(SUPERSEDED_MIGRATION);
            await actAs(db, null); // auth.uid() IS NULL — no JWT, or no `sub` claim

            const res = await call(db, VICTIM);
            const stats = (res.rows[0] as { r: { overallStats: Record<string, unknown> } }).r.overallStats;

            // The old guard did not fire, and SECURITY DEFINER bypassed RLS. Real rows came back.
            expect(stats.totalSessions).toBe(2);
            expect(Number(stats.totalPracticeTime)).toBeGreaterThan(0);
        });

        it('explains the production observation: a nil-UUID probe returns 200 with an empty payload', async () => {
            // The independently observed production probe used the nil UUID, which owns no rows. It
            // therefore proves EXECUTION reachability, not disclosure — exactly as reproduced here.
            const db = await baseDb(SUPERSEDED_MIGRATION);
            await actAs(db, null);
            const res = await call(db, NIL_UUID);
            const stats = (res.rows[0] as { r: { overallStats: Record<string, unknown> } }).r.overallStats;
            expect(stats.totalSessions).toBe(0);
        });

        it('had EXECUTE available to PUBLIC because no migration ever revoked it', async () => {
            const db = await baseDb(SUPERSEDED_MIGRATION);
            expect(SUPERSEDED_MIGRATION).not.toMatch(/REVOKE[\s\S]*get_analytics_summary/i);
            // PostgreSQL grants EXECUTE to PUBLIC at creation, so anon inherits it.
            await db.exec('SET ROLE anon');
            await actAs(db, null);
            await expect(call(db, NIL_UUID)).resolves.toBeDefined();
        });
    });

    describe('the eight-item matrix against the NEW definition', () => {
        // 1
        it('1. an authenticated caller requesting its OWN analytics is allowed', async () => {
            const db = await baseDb(NEW_MIGRATION);
            await db.exec('SET ROLE authenticated');
            await actAs(db, VICTIM);
            const res = await call(db, VICTIM);
            const stats = (res.rows[0] as { r: { overallStats: Record<string, unknown> } }).r.overallStats;
            expect(stats.totalSessions).toBe(2);
            // The legitimate path must keep working — a guard that breaks it is not a fix.
            expect(Number(stats.avgClarity)).toBeCloseTo(90.0, 1);
        });

        // 2
        it('2. an authenticated caller requesting ANOTHER user is rejected', async () => {
            const db = await baseDb(NEW_MIGRATION);
            await db.exec('SET ROLE authenticated');
            await actAs(db, ATTACKER);
            await expect(call(db, VICTIM)).rejects.toThrow(/Unauthorized/);
        });

        // 3
        it('3. a NULL identity is rejected — the defect itself', async () => {
            const db = await baseDb(NEW_MIGRATION);
            await db.exec('SET ROLE authenticated');
            await actAs(db, null);
            await expect(call(db, VICTIM)).rejects.toThrow(/Unauthorized/);
            await expect(call(db, NIL_UUID)).rejects.toThrow(/Unauthorized/);
        });

        // 4
        it('4. a NULL p_user_id is rejected', async () => {
            const db = await baseDb(NEW_MIGRATION);
            await db.exec('SET ROLE authenticated');
            await actAs(db, VICTIM);
            await expect(call(db, null)).rejects.toThrow(/Unauthorized/);
            // And with no identity either — IS DISTINCT FROM must not let NULL = NULL through.
            await actAs(db, null);
            await expect(call(db, null)).rejects.toThrow(/Unauthorized/);
        });

        // 5
        it('5. the anonymous role cannot execute the function at all', async () => {
            const db = await baseDb(NEW_MIGRATION);
            await db.exec('SET ROLE anon');
            await actAs(db, null);
            await expect(call(db, VICTIM)).rejects.toThrow(/permission denied/i);
            // Even with a valid-looking identity, anon is not granted EXECUTE.
            await actAs(db, VICTIM);
            await expect(call(db, VICTIM)).rejects.toThrow(/permission denied/i);
        });

        it('5b. EXECUTE is revoked from PUBLIC, so a new unlisted role inherits nothing', async () => {
            const db = await baseDb(NEW_MIGRATION);
            await db.exec('CREATE ROLE some_other_role');
            await db.exec('SET ROLE some_other_role');
            await actAs(db, VICTIM);
            await expect(call(db, VICTIM)).rejects.toThrow(/permission denied/i);
        });

        // 6
        it('6. ACL matches #1096 verbatim — authenticated + service_role granted; anon + PUBLIC revoked', async () => {
            // #1096 (20260729120000, already on main) is the SOLE owner of this function's authorization
            // policy and it KEEPS service_role's grant. #1091 consumes that decision and must not narrow
            // it. Keeping the service_role grant is safe because the null-safe guard rejects a keyless
            // service_role call (proven in 6b) — the grant is not the barrier, the guard is.
            const db = await baseDb(NEW_MIGRATION);
            const grants = await db.query<{ grantee: string }>(
                `SELECT grantee FROM information_schema.role_routine_grants
                 WHERE routine_name = 'get_analytics_summary' AND privilege_type = 'EXECUTE'`,
            );
            const grantees = grants.rows.map(r => r.grantee);
            expect(grantees).toContain('authenticated');
            expect(grantees).toContain('service_role');
            expect(grantees).not.toContain('anon');
            expect(grantees).not.toContain('PUBLIC');
        });

        it('6b. even with its grant, service_role cannot read another user\'s analytics through THIS function', async () => {
            const db = await baseDb(NEW_MIGRATION);
            await db.exec('SET ROLE service_role');
            await actAs(db, null);
            // service_role holds EXECUTE (per #1096), so this passes the privilege check — and is then
            // rejected by the null-safe guard, because a keyless back-office caller has no auth.uid().
            // That guard, not the ACL, is what makes retaining the grant harmless.
            await expect(call(db, VICTIM)).rejects.toThrow(/Unauthorized/i);
        });

        // 7
        describe('7. RLS / SECURITY DEFINER interaction', () => {
            it('the function is SECURITY DEFINER and RLS is enabled on the table it reads', async () => {
                const db = await baseDb(NEW_MIGRATION);
                const fn = await db.query<{ prosecdef: boolean }>(
                    `SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND proname = 'get_analytics_summary'`,
                );
                expect(fn.rows[0].prosecdef).toBe(true);
                const rls = await db.query<{ relrowsecurity: boolean }>(
                    `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sessions'::regclass`,
                );
                expect(rls.rows[0].relrowsecurity).toBe(true);
            });

            it('RLS does NOT independently protect the data — the in-function guard is the only barrier', async () => {
                // This is why the defect mattered. Under SECURITY DEFINER the function body runs as the
                // owner and the RLS policy on public.sessions does not constrain it. Demonstrated by
                // showing the superseded definition returning another user's rows (above) while a
                // DIRECT select under the same identity returns none.
                const db = await baseDb(NEW_MIGRATION);
                await db.exec('SET ROLE authenticated');
                await actAs(db, ATTACKER);
                const direct = await db.query(
                    'SELECT count(*)::int AS c FROM public.sessions WHERE user_id = $1', [VICTIM],
                );
                expect((direct.rows[0] as { c: number }).c).toBe(0); // RLS blocks the direct read
                // ...but the RPC path is gated ONLY by the guard, which must therefore be fail-closed.
                await expect(call(db, VICTIM)).rejects.toThrow(/Unauthorized/);
            });

            it('the legitimate owner still reads their own rows through the function', async () => {
                const db = await baseDb(NEW_MIGRATION);
                await db.exec('SET ROLE authenticated');
                await actAs(db, VICTIM);
                const res = await call(db, VICTIM);
                const stats = (res.rows[0] as { r: { overallStats: Record<string, unknown> } }).r.overallStats;
                expect(stats.totalSessions).toBe(2);
            });
        });
    });

    describe('regression fence', () => {
        it('the new migration carries the REVOKE the hardening pattern requires', () => {
            expect(NEW_MIGRATION).toMatch(
                /REVOKE EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) FROM PUBLIC;/,
            );
            expect(NEW_MIGRATION).toMatch(
                /REVOKE EXECUTE ON FUNCTION public\.get_analytics_summary\(UUID\) FROM anon;/,
            );
        });

        it('uses #1096\'s null-safe guard form VERBATIM (explicit NULL checks, not IS DISTINCT FROM)', () => {
            // #1096 owns the guard. It uses explicit NULL checks plus `<>` rather than IS DISTINCT FROM;
            // #1091 must reproduce it character-for-character, never substitute an equivalent-looking form.
            expect(NEW_MIGRATION).toMatch(
                /IF auth\.uid\(\) IS NULL OR p_user_id IS NULL OR p_user_id <> auth\.uid\(\) THEN/,
            );
        });
    });
});
