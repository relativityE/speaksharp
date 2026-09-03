// @vitest-environment node
//
// #1306/#1258 — EXECUTED proof that newest-ONE retention reaches THE PATH THE PRODUCT ACTUALLY USES.
//
// The returned defect was not arithmetic. The first draft added a correct `expire_transcripts_newest_one`
// and stopped: the version marker, the shared predicate, the coordinator and the preflight all still said
// newest-two, and `complete_session_v2` — the only live transcript-persisting save path — reaches retention
// through the coordinator. Every unit assertion about the new function passed while the deployed product
// went on retaining two transcripts. So the tests that matter here drive `complete_session_v2` and the
// coordinator, not the new function in isolation.
//
// These execute the REAL migration chain against a real PostgreSQL (PGlite). Content-free throughout:
// synthetic uuids and synthetic transcripts, no hosted environment is touched.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');

const TRANSCRIPT_STATE = M('20260801000000_sessions_transcript_state.sql');
const NEWEST_TWO       = M('20260803000000_transcript_retention_newest_two.sql');
const PROGRESS_EVALS   = M('20260731120000_session_progress_evaluations.sql');
const RECOMMENDATIONS  = M('20260731130000_progress_recommendations.sql');
const CONVERGE         = M('20260804000000_transcript_retention_converge_on_save.sql');
const PREFLIGHT        = M('20260805000000_transcript_retention_preflight.sql');
const COMPLETE_V2      = M('20260819120000_complete_session_v2_atomic_retention_1314.sql');
const NEWEST_ONE       = M('20260903120000_transcript_retention_newest_one.sql');

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** The minimum real-shaped BEFORE state the migrations expect. Only auth/roles is hand-written. */
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users (id) VALUES ('${U}'), ('${OTHER}');
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT '${U}'::uuid $fn$;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz,
    trial_started_at timestamptz, updated_at timestamptz);
  INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${U}', 'pro'), ('${OTHER}', 'pro');
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz,
    transcript text,
    total_words int, duration int, filler_counts jsonb, status text,
    next_action_signal jsonb, status_reason text, clarity_score double precision,
    wpm double precision, pause_metrics jsonb
  );
`;

/** Everything the shipped product has, and then the policy change under test. */
async function freshDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(TRANSCRIPT_STATE);
    await db.exec(NEWEST_TWO);
    await db.exec(PROGRESS_EVALS);
    await db.exec(RECOMMENDATIONS);
    await db.exec(CONVERGE);
    await db.exec(PREFLIGHT);
    await db.exec(COMPLETE_V2);
    await db.exec(NEWEST_ONE);
    return db;
}

async function seedSession(
    db: PGlite, userId: string, createdAt: string, transcript: string | null, words: number,
    status = 'completed',
) {
    const res = await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration, filler_counts, status)
         VALUES ($1, $2::timestamptz, $3, $4, 60, '{"um": 2}'::jsonb, $5) RETURNING id`,
        [userId, createdAt, transcript, words, status],
    );
    return res.rows[0].id;
}

/** Record DURABLE TERMINAL Progress evidence, as the product's evaluation write does. The real schema's
 *  eligible-payload CHECK demands the whole payload, so a thin fixture is rejected outright. */
async function recordTerminalEvidence(db: PGlite, userId: string, sessionId: string, formula = 'clarity_v1') {
    await db.query(
        `INSERT INTO public.session_progress_evaluations
           (user_id, session_id, formula_version, duration_seconds, word_count,
            clarity_evidence_available, attribution_status, eligible,
            clarity_raw, cohort_key, filler_count, error_marker_count,
            engine, engine_version, model_name)
         VALUES ($1, $2, $3, 60, 100, true, 'verified', true,
                 0.8, 'objective', 2, 0, 'private', 'private_v2:whisper-base.en', 'whisper-base.en')`,
        [userId, sessionId, formula],
    );
}

/** Drive the REAL save entry point. Every argument explicit, including the nulls. */
async function completeViaV2(db: PGlite, sessionId: string, transcript: string, words: number) {
    const res = await db.query<{ r: Record<string, unknown> }>(
        `SELECT public.complete_session_v2(
            p_session_id      => $1,
            p_status          => 'completed',
            p_final_duration  => 60,
            p_reason          => NULL,
            p_next_action     => '{"kind":"practice_again"}'::jsonb,
            p_total_words     => $2,
            p_clarity_score   => 0.8,
            p_wpm             => 120,
            p_filler_counts   => '{"um": 2}'::jsonb,
            p_pause_metrics   => NULL,
            p_final_transcript=> $3
         ) AS r`,
        [sessionId, words, transcript],
    );
    return res.rows[0].r;
}

type Row = { id: string; transcript_state: string; has_text: boolean; total_words: number | null; filler_counts: unknown };
const readAll = async (db: PGlite, userId: string) => (await db.query<Row>(
    `SELECT id, transcript_state, (transcript IS NOT NULL) AS has_text, total_words, filler_counts
     FROM public.sessions WHERE user_id = $1 ORDER BY created_at ASC`, [userId],
)).rows;

const converge = async (db: PGlite, userId: string) => (await db.query<{ r: Record<string, unknown> }>(
    'SELECT public.converge_transcript_retention($1) AS r', [userId],
)).rows[0].r;

let db: PGlite;
beforeEach(async () => { db = await freshDb(); });

describe('#1306 the policy the LIVE save path enforces is newest-one', () => {
    it('CASUALTY: the coordinator the save path calls reports newest_one_v1', async () => {
        // The whole returned defect in one assertion. On the first draft this said `newest_two_v1`,
        // because the coordinator still pinned and called newest-two while a brand-new function sat
        // beside it uncalled.
        await seedSession(db, U, '2026-08-01T10:00:00Z', 'only one', 100);
        expect(await converge(db, U)).toMatchObject({ policy_version: 'newest_one_v1' });
    });

    it('CASUALTY: the shared predicate selects EVERY transcript but the newest', async () => {
        const a = await seedSession(db, U, '2026-08-01T10:00:00Z', 'first', 100);
        const b = await seedSession(db, U, '2026-08-02T10:00:00Z', 'second', 200);
        const res = await db.query<{ session_id: string }>(
            'SELECT session_id FROM public.transcript_sessions_to_expire($1)', [U]);
        expect(res.rows.map((r) => r.session_id), 'under newest-two this list was empty').toEqual([a]);
        expect(b).toBeTruthy();
    });

    it('the version marker every retention object pins has moved', async () => {
        const v = await db.query<{ v: string }>('SELECT public.transcript_retention_policy_version() AS v');
        expect(v.rows[0].v).toBe('newest_one_v1');
    });

    it('CASUALTY: the retired newest-two mutation is no longer callable', async () => {
        // Two executable retention policies side by side is the failure mode the version marker exists to
        // prevent; the retired one would silently retain a transcript the product says it removed.
        const exists = await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'expire_transcripts_newest_two'`);
        expect(exists.rows[0].n).toBe(0);
        await expect(db.query('SELECT public.expire_transcripts_newest_two($1, 500)', [U])).rejects.toThrow();
    });
});

describe('#1306 saving B replaces A, through complete_session_v2', () => {
    let s1: string; let s2: string;

    beforeEach(async () => {
        // Rows exist first, in progress, with distinct increasing created_at — v2 completes them.
        s1 = await seedSession(db, U, '2026-08-01T10:00:00Z', null, 0, 'recording');
        s2 = await seedSession(db, U, '2026-08-02T10:00:00Z', null, 0, 'recording');
    });

    it('CASUALTY: with A evidenced, saving B retains B and expires A — end to end', async () => {
        // The product sentence, executed: "saving a newer session replaces the retained transcript."
        expect(await completeViaV2(db, s1, 'session A words', 100)).toMatchObject({
            success: true, transcript_retained: true, transcript_state: 'available',
        });
        // A's Progress evaluation becomes durable, exactly as the client's evaluation write makes it.
        await recordTerminalEvidence(db, U, s1);

        const second = await completeViaV2(db, s2, 'session B words', 200);
        expect(second).toMatchObject({
            success: true, transcript_retained: true, transcript_state: 'available',
        });

        const rows = await readAll(db, U);
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
        expect(byId[s1], "A's transcript is replaced, not kept").toMatchObject({
            transcript_state: 'expired', has_text: false,
        });
        expect(byId[s2]).toMatchObject({ transcript_state: 'available', has_text: true });
    });

    it('CASUALTY: expiring A costs the user no metrics — only the words go', async () => {
        await completeViaV2(db, s1, 'session A words', 100);
        await recordTerminalEvidence(db, U, s1);
        await completeViaV2(db, s2, 'session B words', 200);

        const byId = Object.fromEntries((await readAll(db, U)).map((r) => [r.id, r]));
        expect(byId[s1].total_words, 'the measurement outlives the transcript').toBe(100);
        expect(byId[s1].filler_counts).toEqual({ um: 2 });
    });

    it('the session ROWS both survive — retention removes text, it never deletes a session', async () => {
        // This is the fact that made an earlier draft's three foreign-key changes unnecessary: no cascade
        // can fire, because nothing is deleted.
        await completeViaV2(db, s1, 'session A words', 100);
        await recordTerminalEvidence(db, U, s1);
        await completeViaV2(db, s2, 'session B words', 200);
        expect(await readAll(db, U)).toHaveLength(2);
    });

    it('a FIRST save keeps its transcript — there is no candidate to expire', async () => {
        expect(await completeViaV2(db, s1, 'the only transcript', 100)).toMatchObject({
            transcript_retained: true, transcript_state: 'available',
        });
    });

    it('retention is owner-scoped — another account is untouched', async () => {
        const foreign = await seedSession(db, OTHER, '2026-08-01T09:00:00Z', 'their first', 50);
        await seedSession(db, OTHER, '2026-08-02T09:00:00Z', 'their second', 60);

        await completeViaV2(db, s1, 'session A words', 100);
        await recordTerminalEvidence(db, U, s1);
        await completeViaV2(db, s2, 'session B words', 200);

        const others = await readAll(db, OTHER);
        expect(others.every((r) => r.has_text), 'another owner keeps everything').toBe(true);
        expect(others.find((r) => r.id === foreign)?.has_text).toBe(true);
    });
});

describe('#1306 the coordinator and the sweep, directly', () => {
    it('CASUALTY: a BLANK newer save never displaces a real transcript', async () => {
        const a = await seedSession(db, U, '2026-08-01T10:00:00Z', 'real words', 100);
        await seedSession(db, U, '2026-08-02T10:00:00Z', '   ', 200);
        await recordTerminalEvidence(db, U, a);
        await db.query('SELECT public.expire_transcripts_newest_one($1, 500)', [U]);
        const rows = await readAll(db, U);
        expect(rows[0].has_text, 'a whitespace-only save is not a transcript and must not rank').toBe(true);
    });

    it('CASUALTY: repeated sweeps are idempotent — exactly one transcript, however many runs', async () => {
        const a = await seedSession(db, U, '2026-08-01T10:00:00Z', 'A', 100);
        await seedSession(db, U, '2026-08-02T10:00:00Z', 'B', 200);
        await recordTerminalEvidence(db, U, a);   // the AFTER-INSERT trigger converges immediately
        const second = await db.query<{ r: { expired_count: number } }>(
            'SELECT public.expire_transcripts_newest_one($1, 500) AS r', [U]);
        expect(second.rows[0].r.expired_count, 'a retry must not expire anything again').toBe(0);
        const available = (await readAll(db, U)).filter((r) => r.transcript_state === 'available');
        expect(available).toHaveLength(1);
    });

    it('the sweep reports the newest_one policy version and terminates', async () => {
        const a = await seedSession(db, U, '2026-08-01T10:00:00Z', 'A', 100);
        await seedSession(db, U, '2026-08-02T10:00:00Z', 'B', 200);
        const r = (await db.query<{ r: { policy_version: string; expired_count: number; has_more: boolean } }>(
            'SELECT public.expire_transcripts_newest_one($1, 500) AS r', [U])).rows[0].r;
        expect(r.policy_version).toBe('newest_one_v1');
        expect(r.expired_count).toBe(1);
        expect(r.has_more).toBe(false);
        expect(a).toBeTruthy();
    });

    it('the trigger converges the moment terminal evidence persists', async () => {
        const a = await seedSession(db, U, '2026-08-01T10:00:00Z', 'A', 100);
        await seedSession(db, U, '2026-08-02T10:00:00Z', 'B', 200);
        await recordTerminalEvidence(db, U, a);
        const expired = (await readAll(db, U)).filter((r) => r.transcript_state === 'expired');
        expect(expired.map((r) => r.id)).toEqual([a]);
    });

    it('a null scope fails closed rather than sweeping everyone', async () => {
        await expect(db.query('SELECT public.converge_transcript_retention(NULL)')).rejects.toThrow();
    });
});

describe('#1306 the read-only production preflight moved with the policy', () => {
    it('CASUALTY: the preflight runs at all — a stale version pin would fail closed', async () => {
        // Moving the marker without moving the preflight does not leave it wrong, it stops it dead: the
        // preflight RAISES on any version it was not written for. Silence here is not success.
        const r = (await db.query<{ r: Record<string, unknown> }>(
            `SELECT public.transcript_retention_preflight('all_users', NULL, 'test-run') AS r`)).rows[0].r;
        expect(r.policy_version).toBe('newest_one_v1');
    });

    it('CASUALTY: the simulation counts every transcript but the newest as outgoing', async () => {
        await seedSession(db, U, '2026-08-01T10:00:00Z', 'A', 100);
        await seedSession(db, U, '2026-08-02T10:00:00Z', 'B', 200);
        const r = (await db.query<{ r: { counts: Record<string, number>; simulation: Record<string, number> } }>(
            `SELECT public.transcript_retention_preflight('single_user', '${U}', 'test-run') AS r`)).rows[0].r;
        expect(r.counts.rank_gt1_eligible, 'newest-two arithmetic would report 0 here').toBe(1);
        expect(r.simulation.simulated_max_retained_per_user).toBe(1);
        expect(r.simulation.newest_one_violations).toBe(0);
    });

    it('a pending-evidence backlog still blocks readiness', async () => {
        await seedSession(db, U, '2026-08-01T10:00:00Z', 'A', 100);
        await seedSession(db, U, '2026-08-02T10:00:00Z', 'B', 200);
        const r = (await db.query<{ r: { status: string; counts: Record<string, number> } }>(
            `SELECT public.transcript_retention_preflight('single_user', '${U}', 'test-run') AS r`)).rows[0].r;
        expect(r.counts.pending_evidence_backlog).toBe(1);
        expect(r.status, 'never scrub a transcript whose Progress evidence is not durable').toBe('blocked');
    });

    it('single_user scope without a user id fails closed', async () => {
        await expect(db.query(`SELECT public.transcript_retention_preflight('single_user', NULL, 'r')`))
            .rejects.toThrow();
    });
});

describe('#1306 the Practice Loop is untouched by retention', () => {
    it('CASUALTY: a recommendation derived from A survives A losing its transcript', async () => {
        // The coaching value of session A is the observation and the prescription, not the words. This is
        // what an earlier draft tried to protect by loosening three foreign keys to SET NULL — protection
        // that was never needed, because retention deletes no session row for a cascade to follow.
        const s1 = await seedSession(db, U, '2026-08-01T10:00:00Z', null, 0, 'recording');
        const s2 = await seedSession(db, U, '2026-08-02T10:00:00Z', null, 0, 'recording');
        await completeViaV2(db, s1, 'session A words', 100);
        await db.query(
            `INSERT INTO public.progress_recommendations
               (user_id, source_session_id, formula_version, target_metric, target_direction,
                target_value, target_units, source_metric_value, shown_text)
             VALUES ($1,$2,'clarity_v1','filler_rate','decrease',8.0,'per_100_words',12.5,
                     'Try pausing instead of filling the gap.')`,
            [U, s1]);
        await recordTerminalEvidence(db, U, s1);
        await completeViaV2(db, s2, 'session B words', 200);

        const recs = await db.query<{ source_session_id: string }>(
            'SELECT source_session_id FROM public.progress_recommendations WHERE user_id = $1', [U]);
        expect(recs.rows, "A's recommendation survives A's expiry").toHaveLength(1);
        expect(recs.rows[0].source_session_id, 'and its provenance is still A, not orphaned').toBe(s1);
    });

    it("CASUALTY: A's Progress evaluation survives A losing its transcript", async () => {
        const s1 = await seedSession(db, U, '2026-08-01T10:00:00Z', null, 0, 'recording');
        const s2 = await seedSession(db, U, '2026-08-02T10:00:00Z', null, 0, 'recording');
        await completeViaV2(db, s1, 'session A words', 100);
        await recordTerminalEvidence(db, U, s1);
        await completeViaV2(db, s2, 'session B words', 200);

        const evals = await db.query<{ session_id: string }>(
            'SELECT session_id FROM public.session_progress_evaluations WHERE user_id = $1', [U]);
        expect(evals.rows.map((r) => r.session_id)).toEqual([s1]);
    });
});

describe('#1306 KNOWN COUPLING — reported, not masked', () => {
    it('with A UNEVIDENCED, saving B forfeits B: the newest transcript is lost at save TWO', async () => {
        // NOT a passing grade. This documents a real consequence of moving the boundary, and it is the
        // reason the coupling is called out in the migration header rather than left for production to
        // find. Option A defers expiry while an outgoing candidate's terminal Progress evidence is still
        // pending; complete_session_v2 reverts any newly written transcript that did not converge. Under
        // newest-two those two rules first met at a user's THIRD save. Under newest-one they meet at the
        // SECOND — so a user whose first session has no durable evaluation saves B and keeps no words.
        //
        // Which guarantee wins — never exceed one retained transcript, or never lose the newest one — is a
        // product decision. It is not decided here, and this migration is source-only.
        const s1 = await seedSession(db, U, '2026-08-01T10:00:00Z', null, 0, 'recording');
        const s2 = await seedSession(db, U, '2026-08-02T10:00:00Z', null, 0, 'recording');

        expect(await completeViaV2(db, s1, 'session A words', 100)).toMatchObject({
            transcript_retained: true,
        });

        const second = await completeViaV2(db, s2, 'session B words', 200);
        expect(second).toMatchObject({
            success: true,
            session_saved: true,                    // the session and its metrics are kept
            transcript_retained: false,             // the new words are not
            transcript_outcome: 'retention_failed',
        });
        expect((second.retention as { status: string }).status).toBe('pending');

        // A keeps its transcript throughout: Option A never destroys evidence it still needs.
        const byId = Object.fromEntries((await readAll(db, U)).map((r) => [r.id, r]));
        expect(byId[s1].has_text, "A's transcript is deferred, never deleted").toBe(true);
        expect(byId[s2].total_words, "B's metrics survive the forfeited transcript").toBe(200);
    });
});
