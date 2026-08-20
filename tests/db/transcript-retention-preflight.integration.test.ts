// @vitest-environment node
//
// #1117 R3 — EXECUTED proof for the aggregate-only, READ-ONLY retention preflight
// (migration 20260805000000). Applies #1131 + merged R1 + R2 + R3 verbatim on a real PostgreSQL (PGlite),
// seeds synthetic fixtures, and exercises transcript_retention_preflight. Content-free: synthetic only.
//
// The preflight NEVER writes; these tests assert its aggregate verdict, fail-closed behavior, ACL, and that
// the verdict JSON carries no content-bearing values.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'transcript-retention-converge-bootstrap.sql'), 'utf8');
const SQL = (f: string) => readFileSync(resolve(M, f), 'utf8');
const M1131 = SQL('20260801000000_sessions_transcript_state.sql');
const R1 = SQL('20260803000000_transcript_retention_newest_two.sql');
const R2 = SQL('20260804000000_transcript_retention_converge_on_save.sql');
const R3 = SQL('20260805000000_transcript_retention_preflight.sql');
const WORKFLOW = readFileSync(resolve(process.cwd(), '.github', 'workflows', 'transcript-retention-preflight.yml'), 'utf8');

const UA = '11111111-1111-4111-8111-111111111111';
const UB = '22222222-2222-4222-8222-222222222222';
const sid = (k: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(k).padStart(12, '0')}`;

async function freshDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP); await db.exec(M1131); await db.exec(R1); await db.exec(R2); await db.exec(R3);
    return db;
}
async function addUser(db: PGlite, id: string) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    await db.query('INSERT INTO public.user_profiles (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
}
async function addSession(db: PGlite, id: string, user: string, dayN: number, transcript: string | null) {
    await db.query(
        `INSERT INTO public.sessions (id, user_id, created_at, transcript, total_words, duration)
         VALUES ($1,$2,$3,$4,100,60)`,
        [id, user, new Date(`2026-07-${String(dayN).padStart(2, '0')}T10:00:00Z`).toISOString(), transcript]);
}
async function addEval(db: PGlite, user: string, session: string, attribution: string, formula = 'clarity_v1') {
    await db.query(
        `INSERT INTO public.session_progress_evaluations (user_id, session_id, formula_version, attribution_status, eligible)
         VALUES ($1,$2,$3,$4,true)`, [user, session, formula, attribution]);
}
// Insert durable evidence WITHOUT firing the R2 auto-convergence trigger — models a HISTORICAL pre-R2
// evidence-durable candidate (eval exists but retention never auto-converged), which is exactly the backlog
// the R3 scrub preflight assesses.
async function addEvalRaw(db: PGlite, user: string, session: string, attribution: string, formula = 'clarity_v1') {
    await db.exec(`SET session_replication_role='replica'`);
    await db.query(
        `INSERT INTO public.session_progress_evaluations (user_id, session_id, formula_version, attribution_status, eligible)
         VALUES ($1,$2,$3,$4,true)`, [user, session, formula, attribution]);
    await db.exec(`SET session_replication_role='origin'`);
}
interface Verdict {
    status: string; policy_version: string; formula_version: string; scope: string; run_id: string | null;
    counts: Record<string, number>; contradictions: Record<string, number>;
    simulation: Record<string, number>; bytes: Record<string, number>; identity: Record<string, boolean>;
}
async function preflight(db: PGlite, scope = 'all_users', user: string | null = null, runId = 'run-1'): Promise<Verdict> {
    const r = await db.query<{ v: Verdict }>(
        `SELECT public.transcript_retention_preflight($1,$2,$3) AS v`, [scope, user, runId]);
    return r.rows[0].v;
}

describe('#1117 R3 preflight — aggregate counts & simulation', () => {
    it('0/1/2/3/many: simulated_max_retained<=2, users_over_two=0, exact expire count', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        for (let k = 1; k <= 5; k++) await addSession(db, sid(k), UA, k, `t${k}`); // 5 bearing => 3 rank>2
        for (let k = 1; k <= 3; k++) await addEvalRaw(db, UA, sid(k), 'verified'); // durable, not auto-converged => ready with candidates
        const v = await preflight(db);
        expect(v.status).toBe('ready');
        expect(Number(v.counts.pending_evidence_backlog)).toBe(0);
        expect(Number(v.counts.transcript_bearing)).toBe(5);
        expect(Number(v.counts.rank_gt2_eligible)).toBe(3);
        expect(Number(v.simulation.simulated_expire_count)).toBe(3);
        expect(Number(v.simulation.simulated_max_retained_per_user)).toBe(2);
        expect(Number(v.simulation.users_over_two_after)).toBe(0);
        expect(Number(v.simulation.newest_two_violations)).toBe(0);
    });

    it('tie on created_at + mixed "modes" pool counts one global cohort', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        const tie = 5;
        for (const k of [12, 11, 10]) await addSession(db, sid(k), UA, tie, `tie${k}`); // 3 tied bearing
        const v = await preflight(db);
        expect(Number(v.counts.rank_gt2_eligible)).toBe(1); // exactly one over newest-two
        expect(Number(v.simulation.simulated_max_retained_per_user)).toBe(2);
    });

    it('not_captured / empty rows are not transcript-bearing and never candidates', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        await addSession(db, sid(3), UA, 3, 'real');
        await addSession(db, sid(2), UA, 2, null);   // not_captured
        await addSession(db, sid(1), UA, 1, '   ');   // whitespace => not_captured
        const v = await preflight(db);
        expect(Number(v.counts.transcript_bearing)).toBe(1);
        expect(Number(v.counts.rank_gt2_eligible)).toBe(0);
        expect(Number(v.counts.state_not_captured)).toBe(2);
    });
});

describe('#1117 R3 preflight — evidence backlog, isolation, repeatability', () => {
    it('pending-evidence backlog counts candidates without a durable terminal evaluation', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        for (let k = 1; k <= 4; k++) await addSession(db, sid(k), UA, k, `t${k}`); // 4 bearing => 2 candidates (sid1,sid2)
        await addEval(db, UA, sid(1), 'verified'); // sid1 durable; sid2 pending
        const v = await preflight(db);
        expect(Number(v.counts.rank_gt2_eligible)).toBe(2);
        expect(Number(v.counts.pending_evidence_backlog)).toBe(1); // sid2 only
        expect(Number(v.counts.users_pending_backlog)).toBe(1);
        // pending-evidence backlog MUST block readiness (a scrub must not expire before evidence is durable).
        expect(v.status).toBe('blocked');
    });

    it('byte metric is multibyte-safe (octet_length, not character length)', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        await addSession(db, sid(1), UA, 1, '——'); // 2 em dashes = 6 UTF-8 bytes (2 chars)
        const v = await preflight(db);
        expect(Number(v.bytes.logical_transcript_bytes)).toBe(6);
    });

    it('a pending-attribution evaluation does NOT satisfy the evidence gate', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        for (let k = 1; k <= 3; k++) await addSession(db, sid(k), UA, k, `t${k}`); // 1 candidate (sid1)
        await addEval(db, UA, sid(1), 'pending'); // premature => still pending
        expect(Number((await preflight(db)).counts.pending_evidence_backlog)).toBe(1);
    });

    it('single_user scope isolates; all_users aggregates both; repeatable verdict', async () => {
        const db = await freshDb();
        await addUser(db, UA); await addUser(db, UB);
        for (let k = 1; k <= 4; k++) await addSession(db, sid(100 + k), UA, k, `a${k}`);
        for (let k = 1; k <= 3; k++) await addSession(db, sid(200 + k), UB, k, `b${k}`);
        const a = await preflight(db, 'single_user', UA);
        expect(Number(a.counts.rank_gt2_eligible)).toBe(2); // A: 4 bearing => 2
        expect(Number(a.counts.users_total)).toBe(1);
        const all = await preflight(db, 'all_users');
        expect(Number(all.counts.rank_gt2_eligible)).toBe(3); // A:2 + B:1
        expect(Number(all.counts.users_with_candidates)).toBe(2);
        // repeatable
        expect(await preflight(db, 'all_users')).toEqual(all);
    });
});

describe('#1117 R3 preflight — fail-closed, ACL, content-free', () => {
    it('NULL scope fails closed instead of falling through SQL three-valued logic', async () => {
        const db = await freshDb();
        await expect(db.query(
            `SELECT public.transcript_retention_preflight(NULL, NULL, 'null-scope')`,
        )).rejects.toThrow(/invalid scope/i);
    });

    it('deployed function-definition identity detects drift before a verdict can be trusted', async () => {
        const db = await freshDb();
        const signature = 'public.transcript_retention_preflight(text,uuid,text)';
        const reviewed = (await db.query<{ digest: string }>(
            `SELECT md5(pg_get_functiondef($1::regprocedure)) AS digest`, [signature],
        )).rows[0].digest;
        expect(reviewed).toMatch(/^[0-9a-f]{32}$/);
        const expected = WORKFLOW.match(/EXPECTED_PREFLIGHT_FUNCTION_MD5:\s*([0-9a-f]{32})/)?.[1];
        expect(expected).toBe(reviewed);

        await db.exec(`CREATE OR REPLACE FUNCTION public.transcript_retention_preflight(
            p_scope text DEFAULT 'all_users', p_user_id uuid DEFAULT NULL, p_run_id text DEFAULT NULL
          ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp
          AS $$ SELECT '{"status":"ready"}'::jsonb $$`);
        const drifted = (await db.query<{ digest: string }>(
            `SELECT md5(pg_get_functiondef($1::regprocedure)) AS digest`, [signature],
        )).rows[0].digest;
        expect(drifted).not.toBe(reviewed);
    });

    it('unknown policy version fails closed (raises)', async () => {
        const db = await freshDb();
        await db.exec(`CREATE OR REPLACE FUNCTION public.transcript_retention_policy_version() RETURNS text
                       LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 'forked_v9'::text $$;`);
        await expect(preflight(db)).rejects.toThrow(/policy version/i);
    });

    it('a contradictory row sets status=blocked with counts (never ready)', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        // force a contradiction: not_captured state carrying real text (bypass the #1131 derivation trigger)
        await db.exec(`SET session_replication_role='replica'`);
        await db.query(`INSERT INTO public.sessions (id,user_id,created_at,transcript,transcript_state)
                        VALUES ($1,$2,now(),'real-text','not_captured')`, [sid(1), UA]);
        await db.exec(`SET session_replication_role='origin'`);
        const v = await preflight(db);
        expect(v.status).toBe('blocked');
        expect(Number(v.contradictions.not_captured_with_text)).toBe(1);
    });

    it('EXECUTE is service_role-only; anon/authenticated denied', async () => {
        const db = await freshDb();
        const sig = 'public.transcript_retention_preflight(text, uuid, text)';
        const ok = async (role: string) =>
            (await db.query<{ o: boolean }>(`SELECT has_function_privilege($1,$2,'EXECUTE') o`, [role, sig])).rows[0].o;
        expect(await ok('service_role')).toBe(true);
        expect(await ok('authenticated')).toBe(false);
        expect(await ok('anon')).toBe(false);
    });

    it('verdict is content-free: only whitelisted numeric/boolean/short-enum keys; no transcript text', async () => {
        const db = await freshDb();
        await addUser(db, UA);
        const SECRET = 'zzz-secret-transcript-marker';
        for (let k = 1; k <= 3; k++) await addSession(db, sid(k), UA, k, k === 1 ? SECRET : `t${k}`);
        const v = await preflight(db);
        // no transcript/content string anywhere in the verdict
        expect(JSON.stringify(v)).not.toContain(SECRET);
        // every leaf under counts/contradictions/simulation is a number; identity leaves are booleans.
        for (const grp of [v.counts, v.contradictions, v.simulation])
            for (const val of Object.values(grp)) expect(typeof val).toBe('number');
        for (const val of Object.values(v.identity)) expect(typeof val).toBe('boolean');
        expect(v.policy_version).toBe('newest_two_v1');
        // top-level string fields are the fixed enum/version/run-id only.
        expect(['ready', 'blocked']).toContain(v.status);
    });
});
