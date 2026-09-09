// @vitest-environment node
//
// #1436 P1 — THE LATE-CREATE TRANSCRIPT WRITER IS FAILURE-ATOMIC UNDER NEWEST-ONE.
//
// `create_session_and_update_usage` inserts `p_session_data->>'transcript'` and then converges
// retention. Before this correction it caught every convergence error, and also accepted a `pending`
// or `non_converged` status, without undoing the insert. The late-create recovery path supplies a REAL
// transcript, so on a user whose prior transcript had no terminal evidence yet the RPC returned success
// with BOTH texts still readable — a silent newest-one violation, produced by the recovery path that
// exists to protect the user's words.
//
// The corrected outcome is not "NULL the new transcript and report success". That would tell the user
// their session saved while discarding what they said. It is a retryable FAILURE: the row, the usage
// checkpoint and any partial retention writes roll back together, and the controller keeps its recovery
// draft.
//
// These run against the REAL migration files in real Postgres (PGlite). The writer is the one the
// migration actually redefines, not a re-declaration of it here — a stub would prove a rule nobody runs,
// which is how the newest-two contract shipped untested.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const TRANSCRIPT_STATE = M('20260801000000_sessions_transcript_state.sql');
const NEWEST_TWO = M('20260803000000_transcript_retention_newest_two.sql');
const PROGRESS_EVALS = M('20260731120000_session_progress_evaluations.sql');
const CONVERGE = M('20260804000000_transcript_retention_converge_on_save.sql');
const PREFLIGHT = M('20260805000000_transcript_retention_preflight.sql');
const COMPLETE_V2 = M('20260819120000_complete_session_v2_atomic_retention_1314.sql');
const NEWEST_ONE = M('20260908120000_transcript_retention_newest_one.sql');

const U = '11111111-1111-4111-8111-111111111111';

/**
 * Only what the REDEFINED writer reaches. Usage accounting is stubbed to SUCCEED on purpose: the
 * subject is retention atomicity, and a usage stub that could fail would give the rollback a second
 * possible cause. With it always succeeding, any absence of the new row is attributable to the
 * retention raise and nothing else.
 */
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users (id) VALUES ('${U}');
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT '${U}'::uuid $fn$;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz,
    trial_started_at timestamptz, updated_at timestamptz);
  INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${U}', 'pro');
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE TABLE public.tier_configs (tier_name text PRIMARY KEY, max_concurrent_sessions int);
  INSERT INTO public.tier_configs VALUES ('pro', 50), ('free', 1);
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz,
    title text, transcript text,
    total_words int, duration int, filler_counts jsonb, filler_words jsonb,
    accuracy double precision, ground_truth text, engine text,
    idempotency_key uuid, engine_version text, model_name text, device_type text,
    expires_at timestamptz,
    status text, next_action_signal jsonb, status_reason text,
    clarity_score double precision, wpm double precision, pause_metrics jsonb
  );
  CREATE TABLE public.usage_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid, user_id uuid, incremental_seconds int, engine_type text,
    created_at timestamptz DEFAULT now());
  CREATE OR REPLACE FUNCTION public.update_user_usage(int, text, uuid)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('success', true) $fn$;
`;

async function freshDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(TRANSCRIPT_STATE);
    await db.exec(NEWEST_TWO);
    await db.exec(PROGRESS_EVALS);
    await db.exec(CONVERGE);
    await db.exec(PREFLIGHT);
    await db.exec(COMPLETE_V2);
    await db.exec(NEWEST_ONE);
    return db;
}

/** A prior COMPLETED take that carries text. `duration = 600` is what the writer treats as completed. */
async function seedPriorTake(db: PGlite, createdAt: string, transcript: string) {
    const res = await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration,
             filler_counts, status)
         VALUES ($1, $2::timestamptz, $3, 100, 600, '{"um": 2}'::jsonb, 'completed') RETURNING id`,
        [U, createdAt, transcript],
    );
    return res.rows[0].id;
}

/** Terminal evidence: the coordinator refuses to expire anything until the evaluation has SETTLED. */
async function settleEvidence(db: PGlite, sessionId: string, status: 'attributed' | 'pending') {
    await db.query(
        `INSERT INTO public.session_progress_evaluations
           (session_id, user_id, formula_version, attribution_status,
            duration_seconds, word_count, clarity_evidence_available, eligible, exclusion_reasons)
         VALUES ($1, $2, 'clarity_v1', $3, 600, 100, true, false, ARRAY['unverified_attribution'])`,
        [sessionId, U, status],
    );
}

const lateCreate = (db: PGlite, transcript: string | null) => db.query(
    `SELECT public.create_session_and_update_usage($1::jsonb, 'private') AS r`,
    [JSON.stringify({
        title: 'recovered take', duration: 600, total_words: 120,
        ...(transcript === null ? {} : { transcript }),
    })],
);

const counts = async (db: PGlite) => (await db.query<{
    rows_total: number; with_text: number; checkpoints: number;
}>(`SELECT
      (SELECT COUNT(*) FROM public.sessions WHERE user_id = $1)::int AS rows_total,
      (SELECT COUNT(*) FROM public.sessions WHERE user_id = $1 AND transcript IS NOT NULL)::int AS with_text,
      (SELECT COUNT(*) FROM public.usage_checkpoints WHERE user_id = $1)::int AS checkpoints`,
[U])).rows[0];

describe('#1436 — the late-create transcript writer is failure-atomic', () => {
    it('CASUALTY 1: a second transcript over UNSETTLED prior evidence FAILS and rolls everything back', async () => {
        const db = await freshDb();
        // The user's prior take is saved and its evaluation has NOT settled, so the coordinator cannot
        // expire it. This is the ordinary state moments after a save.
        const prior = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the first take, in the user\'s words');
        await settleEvidence(db, prior, 'pending');
        const before = await counts(db);

        await expect(lateCreate(db, 'the recovered second take'), 'the RPC must refuse, not succeed')
            .rejects.toThrow(/retention did not converge/i);

        const after = await counts(db);
        expect(after, 'no row, no checkpoint, nothing partial').toEqual(before);
        const priorText = await db.query<{ transcript: string }>(
            'SELECT transcript FROM public.sessions WHERE id = $1', [prior]);
        expect(priorText.rows[0].transcript, 'the take the user already had is untouched')
            .toBe('the first take, in the user\'s words');
        await db.close();
    });

    it('CASUALTY 2: a convergence EXCEPTION rolls back just as completely as a refusal', async () => {
        const db = await freshDb();
        const prior = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the first take');
        await settleEvidence(db, prior, 'attributed');
        const before = await counts(db);

        // Force the coordinator itself to fail. The pre-correction code caught this and reported
        // success, which is the more dangerous half of the defect: an error that reads as a save.
        await db.exec(`
          CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid)
            RETURNS jsonb LANGUAGE plpgsql AS $fn$
            BEGIN RAISE EXCEPTION 'forced coordinator failure'; END $fn$;`);

        await expect(lateCreate(db, 'the recovered second take'), 'the exception must escape')
            .rejects.toThrow(/forced coordinator failure/i);

        expect(await counts(db), 'no row, no checkpoint').toEqual(before);
        await db.close();
    });

    it('CASUALTY 3: with SETTLED prior evidence the create succeeds and exactly one text survives', async () => {
        const db = await freshDb();
        const prior = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the first take');
        await settleEvidence(db, prior, 'attributed');

        // The control the other two need. Without it, a writer that simply refused every
        // transcript-bearing create would satisfy casualties 1 and 2 while breaking the product.
        const res = await lateCreate(db, 'the newest take');
        expect(res.rows.length, 'the RPC returned').toBe(1);

        const rows = (await db.query<{ transcript: string | null; transcript_state: string }>(
            `SELECT transcript, transcript_state FROM public.sessions
             WHERE user_id = $1 ORDER BY created_at ASC`, [U])).rows;
        expect(rows.length).toBe(2);
        expect(rows.filter((r) => r.transcript !== null).length, 'newest-one: exactly one text').toBe(1);
        expect(rows[1].transcript, 'and it is the NEWEST one').toBe('the newest take');
        expect(rows[0].transcript_state, 'the older one expired').toBe('expired');
        await db.close();
    });

    it('CASUALTY 4: a transcript-FREE placeholder create survives a NON-CONVERGED cohort', async () => {
        const db = await freshDb();
        /**
         * THE COHORT HAS TO BE GENUINELY NON-CONVERGED, and my first version of this casualty was not.
         *
         * It seeded ONE prior take with unsettled evidence and then created a placeholder. With no
         * second text there is no candidate to expire, so the coordinator converged trivially — and a
         * mutant that raises on EVERY create, transcript or not, passed. That mutant is the one that
         * matters most in the product: it breaks ordinary recording start, because every take begins
         * with a transcript-free placeholder create.
         *
         * Two prior texts with the older one's evidence unsettled gives the coordinator a candidate it
         * cannot expire, so retention really is non-converged at the moment the placeholder is written.
         * The placeholder must still succeed: it carries no words, so there is nothing to lose and
         * nothing to violate, and refusing it would take recording away from the user entirely.
         */
        const older = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the older take');
        await seedPriorTake(db, '2026-09-02T10:00:00Z', 'the newer take');
        await settleEvidence(db, older, 'pending');

        const blocked = await db.query<{ r: { status?: string } }>(
            'SELECT public.converge_transcript_retention($1) AS r', [U]);
        expect(blocked.rows[0].r?.status, 'the cohort really is non-converged').not.toBe('converged');

        const res = await lateCreate(db, null);
        expect(res.rows.length, 'the placeholder create still succeeds').toBe(1);

        const rows = (await db.query<{ transcript: string | null }>(
            'SELECT transcript FROM public.sessions WHERE user_id = $1 ORDER BY created_at ASC', [U])).rows;
        expect(rows.length, 'the placeholder row exists').toBe(3);
        expect(rows.filter((r) => r.transcript !== null).length, 'it created no additional text').toBe(2);
        await db.close();
    });
});
