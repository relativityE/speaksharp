// @vitest-environment node
//
// #1352 / WS-5 "B" — the FIRST execution of the shipped newest-two retention contract, anywhere.
//
// WHY THIS FILE EXISTS. `atomic-completion-retention.integration.test.ts` hand-writes both the schema
// and `converge_transcript_retention`, as a mode-switched stub whose `'expire'` branch SIMULATES the
// sweep with its own `ORDER BY created_at ASC LIMIT 1`. That test is valid and stays: it proves CALLER
// behaviour — atomicity, rollback, and the PO ruling that a failed retention still saves the session.
//
// But the SHIPPED functions had never run in any test. Nine production-proof attempts were spent trying
// to observe this contract through a browser, and every one failed on instrumentation before reaching
// the assertion — so "newest two keep their transcripts, the oldest expires but keeps its metrics" had
// never actually been checked. The cheap proof that appeared to exist was exercising a stand-in.
//
// This loads the REAL migrations (the pattern `analytics-summary-rpc` already uses) and drives the REAL
// `transcript_sessions_to_expire` / `expire_transcripts_newest_two`. Nothing here is simulated.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
/** #1131 — `transcript_state`, the BEFORE-write derivation trigger, and the sticky/expired⇒NULL CHECKs. */
const TRANSCRIPT_STATE = M('20260801000000_sessions_transcript_state.sql');
/** #1117 R1 — the newest-two policy, its read helper, its invariant validator, and the sweep. */
const NEWEST_TWO = M('20260803000000_transcript_retention_newest_two.sql');
/** #1045 — the Progress evaluation rows `converge_transcript_retention` reads for terminal evidence. */
const PROGRESS_EVALS = M('20260731120000_session_progress_evaluations.sql');
/** R2 — `converge_transcript_retention`: the per-save path, and the function the existing test STUBS. */
const CONVERGE = M('20260804000000_transcript_retention_converge_on_save.sql');

/**
 * HELD, and asserted ABSENT. `20260812042000_trial_activation_stamp_1282` is deliberately not applied
 * to production; loading it here would prove a schema nobody runs. Its absence is asserted rather than
 * merely omitted, so a future edit that quietly adds it fails instead of silently changing the subject.
 */
const HELD_MIGRATION = '20260812042000_trial_activation_stamp_1282.sql';
/** #1314 — `complete_session_v2`: the REAL save entry point the client calls. */
const COMPLETE_V2 = M('20260819120000_complete_session_v2_atomic_retention_1314.sql');

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/**
 * The minimum real-shaped BEFORE state the migrations expect. Only scaffolding auth/roles is
 * hand-written — the retention objects under test all come from the migration files.
 */
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
  -- complete_session_v2 resolves the caller's tier through this 5-arg function before doing anything.
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz,
    transcript text,
    total_words int, duration int, filler_counts jsonb, status text,
    -- Columns complete_session_v2 reads and writes but does not itself create.
    next_action_signal jsonb, status_reason text, clarity_score double precision,
    wpm double precision, pause_metrics jsonb
  );
`;

/** Insert one session with an explicit created_at so ordering is deterministic, not clock-dependent. */
async function seedSession(
    db: PGlite, userId: string, createdAt: string, transcript: string | null, words: number,
    status: string = 'completed',
) {
    // `status` is a parameter because complete_session_v2 refuses to re-complete an already-completed
    // session with different metrics (#1306 idempotency). Rows destined for v2 must start IN PROGRESS —
    // seeding them 'completed' made v2 read the call as a conflicting replay, which is the guard working.
    const res = await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration, filler_counts, status)
         VALUES ($1, $2::timestamptz, $3, $4, 60, '{"um": 2}'::jsonb, $5) RETURNING id`,
        [userId, createdAt, transcript, words, status],
    );
    return res.rows[0].id;
}

async function freshDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(TRANSCRIPT_STATE);
    await db.exec(NEWEST_TWO);
    await db.exec(PROGRESS_EVALS);
    await db.exec(CONVERGE);
    await db.exec(COMPLETE_V2);
    return db;
}

type Row = { id: string; transcript_state: string; has_text: boolean; total_words: number | null; filler_counts: unknown };
const readAll = async (db: PGlite, userId: string) => (await db.query<Row>(
    `SELECT id, transcript_state, (transcript IS NOT NULL) AS has_text, total_words, filler_counts
     FROM public.sessions WHERE user_id = $1 ORDER BY created_at ASC`, [userId],
)).rows;

describe('#1352 the SHIPPED newest-two retention contract, executed', () => {
    let db: PGlite;
    let oldest: string; let middle: string; let newest: string;

    beforeEach(async () => {
        db = await freshDb();
        // Three completed sessions, oldest first. Distinct timestamps so `created_at DESC, id DESC`
        // ranking is unambiguous.
        oldest = await seedSession(db, U, '2026-08-01T10:00:00Z', 'the first session transcript', 100);
        middle = await seedSession(db, U, '2026-08-02T10:00:00Z', 'the second session transcript', 200);
        newest = await seedSession(db, U, '2026-08-03T10:00:00Z', 'the third session transcript', 300);
    });

    it('the derivation trigger makes all three `available` on insert — the real BEFORE state', async () => {
        const rows = await readAll(db, U);
        expect(rows.map((r) => r.transcript_state)).toEqual(['available', 'available', 'available']);
        expect(rows.every((r) => r.has_text)).toBe(true);
    });

    it('the shipped READ helper selects EXACTLY the oldest as over-retention', async () => {
        // `transcript_sessions_to_expire` ranks by (created_at DESC, id DESC) and returns rank > 2.
        const res = await db.query<{ session_id: string }>(
            'SELECT session_id FROM public.transcript_sessions_to_expire($1)', [U],
        );
        expect(res.rows.map((r) => r.session_id)).toEqual([oldest]);
    });

    it('THE CONTRACT: newest two keep transcripts; the oldest expires and KEEPS ITS METRICS', async () => {
        const result = await db.query<{ expire_transcripts_newest_two: { expired_count: number } }>(
            'SELECT public.expire_transcripts_newest_two($1, $2) AS expire_transcripts_newest_two', [U, 500],
        );
        expect(result.rows[0].expire_transcripts_newest_two.expired_count).toBe(1);

        const rows = await readAll(db, U);
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

        // Newest two: transcript retained.
        expect(byId[newest]).toMatchObject({ transcript_state: 'available', has_text: true });
        expect(byId[middle]).toMatchObject({ transcript_state: 'available', has_text: true });

        // Oldest: expired, text gone.
        expect(byId[oldest]).toMatchObject({ transcript_state: 'expired', has_text: false });

        // METRICS SURVIVE EXPIRY. This is the half a transcript-only assertion would miss: expiring the
        // text must never cost the user the measurements derived from it.
        expect(byId[oldest].total_words).toBe(100);
        expect(byId[oldest].filler_counts).toEqual({ um: 2 });
    });

    it('is IDEMPOTENT — a second sweep expires nothing further', async () => {
        await db.query('SELECT public.expire_transcripts_newest_two($1, $2)', [U, 500]);
        const second = await db.query<{ expire_transcripts_newest_two: { expired_count: number } }>(
            'SELECT public.expire_transcripts_newest_two($1, $2) AS expire_transcripts_newest_two', [U, 500],
        );
        expect(second.rows[0].expire_transcripts_newest_two.expired_count).toBe(0);
        expect((await readAll(db, U)).filter((r) => r.transcript_state === 'expired')).toHaveLength(1);
    });

    it('is OWNER-SCOPED — another account is untouched', async () => {
        const foreign = await seedSession(db, OTHER, '2026-08-01T09:00:00Z', 'another user transcript', 50);
        await seedSession(db, OTHER, '2026-08-02T09:00:00Z', 'another user transcript 2', 60);
        await seedSession(db, OTHER, '2026-08-03T09:00:00Z', 'another user transcript 3', 70);

        await db.query('SELECT public.expire_transcripts_newest_two($1, $2)', [U, 500]);

        const others = await readAll(db, OTHER);
        expect(others.every((r) => r.transcript_state === 'available' && r.has_text)).toBe(true);
        expect(others.find((r) => r.id === foreign)?.has_text).toBe(true);
    });

    it('TWO sessions expire nothing — the boundary is exactly two, not "some"', async () => {
        const two = await freshDb();
        await seedSession(two, U, '2026-08-01T10:00:00Z', 'first', 10);
        await seedSession(two, U, '2026-08-02T10:00:00Z', 'second', 20);
        const res = await two.query<{ expire_transcripts_newest_two: { expired_count: number } }>(
            'SELECT public.expire_transcripts_newest_two($1, $2) AS expire_transcripts_newest_two', [U, 500],
        );
        expect(res.rows[0].expire_transcripts_newest_two.expired_count).toBe(0);
        expect((await readAll(two, U)).every((r) => r.has_text)).toBe(true);
    });

    it('a BLANK transcript is not "retained" — it never counts toward the newest two', async () => {
        // The shipped helper requires `transcript ~ '[^[:space:]]'`. A whitespace-only row is not a
        // transcript, so it must not occupy one of the two retained slots.
        const blank = await freshDb();
        const a = await seedSession(blank, U, '2026-08-01T10:00:00Z', 'real one', 10);
        await seedSession(blank, U, '2026-08-02T10:00:00Z', '   ', 20);
        await seedSession(blank, U, '2026-08-03T10:00:00Z', 'real three', 30);
        const toExpire = await blank.query<{ session_id: string }>(
            'SELECT session_id FROM public.transcript_sessions_to_expire($1)', [U],
        );
        // Only two transcript-BEARING rows exist, so nothing is over-retention.
        expect(toExpire.rows).toHaveLength(0);
        expect(a).toBeTruthy();
    });
});

/** Record DURABLE TERMINAL Progress evidence for a session, as the product's evaluation write would. */
async function recordTerminalEvidence(db: PGlite, userId: string, sessionId: string, formula = 'clarity_v1') {
    // The REAL schema's `spe_eligible_payload` CHECK demands the full eligible payload — clarity, cohort,
    // filler/error counts, engine identity, attribution 'verified'. My first fixture omitted them and the
    // shipped constraint REJECTED it: the schema policing a test fixture is exactly why B loads real
    // migrations instead of hand-writing tables.
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

describe('#1352 converge_transcript_retention — the function attempt 9 actually hit', () => {
    let db: PGlite; let oldest: string;

    beforeEach(async () => {
        db = await freshDb();
        oldest = await seedSession(db, U, '2026-08-01T10:00:00Z', 'first', 100);
        await seedSession(db, U, '2026-08-02T10:00:00Z', 'second', 200);
        await seedSession(db, U, '2026-08-03T10:00:00Z', 'third', 300);
    });

    const converge = async (userId: string) => (await db.query<{ r: Record<string, unknown> }>(
        'SELECT public.converge_transcript_retention($1) AS r', [userId],
    )).rows[0].r;

    it('DEFERS with status `pending` when an outgoing candidate has no terminal evidence', async () => {
        // THIS IS ATTEMPT 9. Its envelope showed `retention_status: pending` on session 3 — the DB
        // behaving to ratified policy, refusing to expire a transcript whose Progress evidence was not
        // yet durable. #1354 fixed the CLIENT sequencing that produced it; this proves the server side
        // of that contract directly, which nine browser attempts never reached.
        const r = await converge(U);
        expect(r).toMatchObject({ status: 'pending', policy_version: 'newest_two_v1', expired_count: 0 });
        expect(r.pending_evidence_count).toBe(1);
        expect((await readAll(db, U)).every((row) => row.has_text)).toBe(true);
    });

    it('the TRIGGER converges the moment terminal evidence persists — no explicit call needed', async () => {
        // I first asserted that an explicit converge() after recording evidence would report
        // expired_count: 1. It reported 0 — because the shipped system is BETTER than the assertion:
        // `spe_converge_retention` (an AFTER-INSERT trigger on session_progress_evaluations) fires on any
        // non-pending evaluation and converges immediately. By the time my explicit call ran, the oldest
        // was already expired and there was nothing left to do. The test now asserts the real mechanism.
        await recordTerminalEvidence(db, U, oldest);

        // No converge() call — the trigger already did it.
        const rows = await readAll(db, U);
        const expired = rows.filter((row) => row.transcript_state === 'expired');
        expect(expired).toHaveLength(1);
        expect(expired[0].id).toBe(oldest);
        expect(expired[0].has_text).toBe(false);
        expect(expired[0].total_words).toBe(100);   // metrics survive convergence too

        // And an explicit follow-up is an idempotent no-op reporting the converged steady state.
        expect(await converge(U)).toMatchObject({ status: 'converged', eligible_candidate_count: 0, expired_count: 0 });
    });

    it('reports `converged` with nothing to do when only two sessions exist', async () => {
        const two = await freshDb();
        await seedSession(two, U, '2026-08-01T10:00:00Z', 'a', 10);
        await seedSession(two, U, '2026-08-02T10:00:00Z', 'b', 20);
        const r = (await two.query<{ r: Record<string, unknown> }>(
            'SELECT public.converge_transcript_retention($1) AS r', [U],
        )).rows[0].r;
        expect(r).toMatchObject({ status: 'converged', eligible_candidate_count: 0, expired_count: 0 });
    });

    it('evidence at a DIFFERENT formula version does not count as terminal', async () => {
        await recordTerminalEvidence(db, U, oldest, 'some_other_version');
        expect(await converge(U)).toMatchObject({ status: 'pending', pending_evidence_count: 1 });
    });

    it('PENDING attribution is not terminal evidence', async () => {
        // The schema makes `eligible=true` with pending attribution UNREPRESENTABLE (the CHECK requires
        // 'verified'), so a pending-attribution row can only exist as an EXCLUSION — which is itself a
        // fact this test learned from the real schema rather than from any doc.
        await db.query(
            `INSERT INTO public.session_progress_evaluations
               (user_id, session_id, formula_version, duration_seconds, word_count,
                clarity_evidence_available, attribution_status, eligible, exclusion_reasons)
             VALUES ($1, $2, 'clarity_v1', 60, 100, true, 'pending', false, '{attribution_pending}')`,
            [U, oldest],
        );
        expect(await converge(U)).toMatchObject({ status: 'pending', pending_evidence_count: 1 });
    });

    it('requires a user id — a null scope fails closed rather than sweeping everyone', async () => {
        await expect(db.query('SELECT public.converge_transcript_retention(NULL)')).rejects.toThrow();
    });
});

describe('#1352 the HELD migration is asserted ABSENT, not merely unloaded', () => {
    it('the held trial-activation migration exists in the repo but is NOT applied here', async () => {
        // Omission is invisible; assertion is not. If a future edit loads it, this fails rather than
        // silently proving a schema production does not run.
        expect(readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', HELD_MIGRATION), 'utf8').length)
            .toBeGreaterThan(0);
        // CORRECTED: this first asserted the ABSENCE OF A COLUMN. But 20260812042000 is a DATA
        // migration — it UPDATEs user_profiles, it does not add `commercial_trial_granted_at` (the
        // column pre-exists, and `complete_session_v2` needs it). The column check was adjacent to the
        // claim, not the claim. What the held migration controls is whether the GRANT was stamped.
        const db = await freshDb();
        const stamped = await db.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM public.user_profiles WHERE commercial_trial_granted_at IS NOT NULL',
        );
        expect(stamped.rows[0].n, 'the held trial grant must not have been applied').toBe(0);
    });
});

/**
 * Drive the REAL save entry point. Eleven named arguments, every one explicit including the nulls —
 * a defaulted argument is an argument the test did not choose.
 */
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

describe('#1352 the contract through complete_session_v2 — the entry point the client calls', () => {
    let db: PGlite; let s1: string; let s2: string; let s3: string;

    beforeEach(async () => {
        db = await freshDb();
        // Rows exist first, in progress, with distinct increasing created_at — v2 completes them.
        s1 = await seedSession(db, U, '2026-08-01T10:00:00Z', null, 0, 'recording');
        s2 = await seedSession(db, U, '2026-08-02T10:00:00Z', null, 0, 'recording');
        s3 = await seedSession(db, U, '2026-08-03T10:00:00Z', null, 0, 'recording');
    });

    it('REPRODUCES ATTEMPT 9 EXACTLY — third save forfeits its transcript on pending evidence', async () => {
        // I first asserted all three would stay `available`. The product disagreed, and the product was
        // right: with two transcript-bearing rows already present, the THIRD completion creates an
        // outgoing candidate, that candidate has no durable Progress evidence, convergence returns
        // `pending`, and v2 FORFEITS THE NEW TRANSCRIPT rather than exceed newest-two (the PO ruling —
        // the session and its metrics survive, only the new text is lost).
        //
        // The envelope below is attempt 9's, character for character:
        //   transcript_state=not_captured · transcript_outcome=retention_failed · retention.status=pending
        // Nine browser attempts were trying to observe this and never reached the assertion.
        expect(await completeViaV2(db, s1, 'first transcript', 100)).toMatchObject({
            success: true, transcript_retained: true, transcript_state: 'available',
        });
        expect(await completeViaV2(db, s2, 'second transcript', 200)).toMatchObject({
            success: true, transcript_retained: true, transcript_state: 'available',
        });

        const third = await completeViaV2(db, s3, 'third transcript', 300);
        expect(third).toMatchObject({
            success: true,
            session_saved: true,               // the user keeps the session and its metrics
            transcript_retained: false,        // only the new text is forfeited
            transcript_state: 'not_captured',
            transcript_outcome: 'retention_failed',
            retention: { status: 'pending', pending_evidence_count: 1, expired_count: 0 },
        });

        // The two earlier transcripts are untouched; nothing was expired to make room.
        const rows = await readAll(db, U);
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
        expect(byId[s1]).toMatchObject({ transcript_state: 'available', has_text: true });
        expect(byId[s2]).toMatchObject({ transcript_state: 'available', has_text: true });
        expect(byId[s3]).toMatchObject({ transcript_state: 'not_captured', has_text: false });
        expect(byId[s3].total_words, 'metrics survive the forfeited transcript').toBe(300);
    });

    it('THE CONTRACT through v2, with evidence as the product produces it', async () => {
        // The real journey: a Progress evaluation persists after each save, so by the time the third
        // completion runs, the outgoing candidate HAS durable terminal evidence and convergence expires
        // it instead of deferring. This is the three-session contract end to end, through the entry
        // point the client actually calls.
        await completeViaV2(db, s1, 'first transcript', 100);
        await recordTerminalEvidence(db, U, s1);
        await completeViaV2(db, s2, 'second transcript', 200);
        await recordTerminalEvidence(db, U, s2);
        const third = await completeViaV2(db, s3, 'third transcript', 300);

        expect(third).toMatchObject({
            success: true, transcript_retained: true, transcript_state: 'available',
            retention: { status: 'converged', expired_count: 1 },
        });

        const byId = Object.fromEntries((await readAll(db, U)).map((r) => [r.id, r]));
        expect(byId[s3]).toMatchObject({ transcript_state: 'available', has_text: true });
        expect(byId[s2]).toMatchObject({ transcript_state: 'available', has_text: true });
        expect(byId[s1]).toMatchObject({ transcript_state: 'expired', has_text: false });
        expect(byId[s1].total_words).toBe(100);
        expect(byId[s1].filler_counts).toEqual({ um: 2 });
    });

    it("another user's session id is indistinguishable from a nonexistent one", async () => {
        const foreign = await seedSession(db, OTHER, '2026-08-01T09:00:00Z', null, 0, 'recording');
        const r = await completeViaV2(db, foreign, 'not mine', 10);
        expect(r).toMatchObject({ success: false });
    });
});
