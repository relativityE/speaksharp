// @vitest-environment node
//
// #1306 Stage B — retiring the legacy `complete_session` (v1) overloads.
//
// THIS APPLIES THE SHIPPED MIGRATIONS. Three existing DB tests `CREATE FUNCTION public.complete_session(...)`
// by hand, so they exercise a handwritten substitute; a retirement proven against a substitute proves nothing
// about production, because the substitute can be dropped while the deployed function survives. Every
// statement here comes from backend/supabase/migrations, applied in shipped order.
//
// Content-free: synthetic strings only.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const sql = (f: string) => readFileSync(resolve(M, f), 'utf8');
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'transcript-retention-converge-bootstrap.sql'), 'utf8');

const M1131 = sql('20260801000000_sessions_transcript_state.sql');
const R1 = sql('20260803000000_transcript_retention_newest_two.sql');
const R2 = sql('20260804000000_transcript_retention_converge_on_save.sql');
const STAGE_A = sql('20260816223606_metrics_only_additive_1306.sql');
const ATOMIC = sql('20260819120000_complete_session_v2_atomic_retention_1314.sql');
const STAGE_B = sql('20260829120000_retire_complete_session_v1_1306.sql');

const U = '11111111-1111-4111-8111-111111111111';
const REC = JSON.stringify({
    reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
    value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
});
const sid = (k: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(k).padStart(12, '0')}`;

const EXTRA = `
  ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS subscription_status text,
    ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
    ADD COLUMN IF NOT EXISTS subscription_id text,
    ADD COLUMN IF NOT EXISTS commercial_trial_granted_at timestamptz,
    -- R2's v1 complete_session reads the private-sample entitlement surface (20260610143000). These are
    -- SCAFFOLDING columns, not the object under test: complete_session and complete_session_v2 themselves
    -- still come from the shipped migrations, which is the point of this suite.
    ADD COLUMN IF NOT EXISTS private_sample_limit_seconds int NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS private_sample_seconds_used int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS private_sample_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS private_sample_completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS private_sample_session_id uuid;
  -- BOTH arities are stubbed deliberately. R2 (20260804000000) defines the v1 complete_session against the
  -- FOUR-argument tier resolver that predates commercial_trial_granted_at; Stage A and v2 call the FIVE-argument
  -- form. Stubbing only one leaves the other unresolved, and the failure surfaces as a confusing
  -- "function ... does not exist" from inside the RPC rather than from the schema.
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  SELECT set_config('request.jwt.claim.sub', '${U}', false);
`;

/** The schema as deployed BEFORE Stage B — v1 overloads present. */
async function preStageB(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(M1131);
    await db.exec(R1);
    await db.exec(R2);
    await db.exec(EXTRA);
    await db.exec(STAGE_A);
    await db.exec(ATOMIC);
    await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [U]);
    await db.query("INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro') ON CONFLICT DO NOTHING", [U]);
    return db;
}

const overloads = async (db: PGlite, name: string): Promise<string[]> => {
    const r = await db.query<{ args: string }>(
        `SELECT pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname=$1 ORDER BY 1`, [name]);
    return r.rows.map(x => x.args);
};

async function seed(db: PGlite, k: number, dayN: number) {
    const id = sid(k);
    await db.query(
        `INSERT INTO public.sessions (id, user_id, created_at, status, duration) VALUES ($1,$2,$3,'active',0)`,
        [id, U, new Date(`2026-07-${String(dayN).padStart(2, '0')}T10:00:00Z`).toISOString()]);
    return id;
}

describe('#1306 Stage B — the legacy completion path is retired, not merely unused', () => {
    it('the pre-Stage-B schema really does expose reachable v1 overloads (the premise)', async () => {
        // If this ever fails, the rest of the suite is vacuous — it would be "proving" the removal of
        // something that was not there.
        const db = await preStageB();
        const found = await overloads(db, 'complete_session');
        expect(found.length, 'v1 overloads should exist before Stage B').toBeGreaterThan(0);
        await db.close();
    });

    it('v1 is EXECUTE-granted, not merely present (reachability, independent of the entitlement stack)', async () => {
        // Catalog-level, so it holds regardless of how much of the entitlement surface the fixture models.
        // Reachability is the claim Stage B rests on: the function exists AND carries an executable grant.
        const db = await preStageB();
        const r = await db.query<{ args: string; acl: string | null }>(
            `SELECT pg_get_function_identity_arguments(p.oid) AS args, array_to_string(p.proacl, ',') AS acl
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='complete_session'`);
        expect(r.rows.length, 'v1 overloads must exist before Stage B').toBeGreaterThan(0);
        // A NULL ACL means default privileges — EXECUTE is granted to PUBLIC, which is broader still.
        const reachable = r.rows.some(x => x.acl === null || /authenticated|service_role|=X/.test(x.acl ?? ''));
        expect(reachable, 'at least one v1 overload must be EXECUTE-reachable').toBe(true);
        await db.close();
    });

    it('a signed-in caller can persist a transcript through v1 BEFORE Stage B', async () => {
        // This is the defect Stage B closes: a second write path to transcript persistence that does not
        // go through v2's retention convergence.
        const db = await preStageB();
        const id = await seed(db, 1, 1);
        const r = await db.query<{ ok: string }>(
            `SELECT (public.complete_session($1::uuid, 'completed', 'synthetic transcript', 60, NULL))::text AS ok`,
            [id]);
        expect(r.rows[0].ok, 'v1 transcript path should be reachable pre-Stage-B').toBeTruthy();
        await db.close();
    });

    describe('after applying the shipped Stage-B migration', () => {
        let db: PGlite;
        beforeAll(async () => { db = await preStageB(); await db.exec(STAGE_B); });

        it('leaves ZERO complete_session overloads', async () => {
            // M1/M2: dropping only one overload must fail here.
            expect(await overloads(db, 'complete_session')).toEqual([]);
        });

        it('keeps exactly one complete_session_v2', async () => {
            expect(await overloads(db, 'complete_session_v2')).toHaveLength(1);
        });

        it('fails a v1 call with a NAMED error, never falling through to v2', async () => {
            // M5: a silent redirect to v2 would hide the very caller this work exists to find.
            const id = await seed(db, 2, 2);
            await expect(db.query(
                `SELECT public.complete_session($1::uuid, 'completed', 'synthetic transcript', 60, NULL)`,
                [id],
            )).rejects.toThrow(/does not exist/i);
        });

        it('still completes a session through v2, retaining the transcript', async () => {
            const id = await seed(db, 3, 3);
            const r = await db.query<{ r: { transcript_state?: string } }>(
                `SELECT public.complete_session_v2(
                    p_session_id => $1::uuid, p_status => 'completed', p_final_duration => 60,
                    p_reason => NULL, p_next_action => $2::jsonb, p_total_words => 100,
                    p_clarity_score => 80, p_wpm => 120, p_filler_counts => '{}'::jsonb,
                    p_pause_metrics => NULL, p_final_transcript => 'synthetic transcript') AS r`,
                [id, REC]);
            expect(r.rows[0].r).toBeTruthy();
            const s = await db.query<{ transcript_state: string }>(
                'SELECT transcript_state FROM public.sessions WHERE id=$1', [id]);
            expect(s.rows[0].transcript_state).toBe('available');
        });

        it('grants no EXECUTE on any complete_session to any role', async () => {
            // M3: REVOKE-without-DROP must fail. With the function gone there is nothing left to grant,
            // so this asserts the object's absence from the ACL surface, not merely a narrowed grant.
            const r = await db.query<{ n: number }>(
                `SELECT count(*)::int AS n
                 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='complete_session' AND p.proacl IS NOT NULL`);
            expect(r.rows[0].n).toBe(0);
        });
    });

    it('refuses to retire v1 when complete_session_v2 is absent', async () => {
        // Dropping the legacy path while the successor is missing would leave NO completion path at all.
        const db = new PGlite();
        await db.exec(BOOTSTRAP);
        await db.exec(M1131);
        await db.exec(R1);
        await db.exec(R2);
        await db.exec(EXTRA);
        await db.exec(STAGE_A); // v1 overloads present, but never the v2 migration
        await expect(db.exec(STAGE_B)).rejects.toThrow(/complete_session_v2 is absent/i);
        await db.close();
    });
});
