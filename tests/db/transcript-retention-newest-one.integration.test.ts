// @vitest-environment node
//
// NEWEST-ONE TRANSCRIPT RETENTION — the corrected contract, executed against the REAL migrations.
//
// The product requirement is that a user keeps the transcript of their newest completed session only.
// The shipped implementation retained the newest TWO. This drives the forward-only correction the same
// way `retention-contract-shipped` drives the shipped one: real migration files, real functions, nothing
// simulated. A stub here would prove a rule nobody runs, which is the failure that let the newest-two
// contract ship untested through nine production-proof attempts.
//
// The correction moves five objects together, because the policy is encoded in five places and the
// coordinator hard-raises on an unexpected version. That is deliberate design — a partial change fails
// loudly rather than half-applying — and it is asserted here rather than assumed.
import { describe, it, expect, beforeEach } from 'vitest';
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
/** The correction under test. Applied AFTER the shipped ones, exactly as Production would run it. */
const NEWEST_ONE = M('20260908120000_transcript_retention_newest_one.sql');

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

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

async function seedSession(
    db: PGlite, userId: string, createdAt: string, transcript: string | null, words: number,
    status: string = 'completed',
) {
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
    await db.exec(PREFLIGHT);
    await db.exec(COMPLETE_V2);
    // ...and then the correction, in migration order.
    await db.exec(NEWEST_ONE);
    return db;
}

/**
 * Durable terminal evidence, which the coordinator requires before it will expire anything.
 *
 * `eligible = false` deliberately. The coordinator's gate is only that `attribution_status` is not
 * `'pending'` — it asks whether the evaluation SETTLED, not whether the session qualified for comparison.
 * An eligible row would additionally have to carry a full engine identity and verified attribution under
 * `spe_eligible_payload`, which is a different subject and would make this helper assert things the
 * retention contract does not depend on.
 */
async function giveTerminalEvidence(db: PGlite, sessionIds: string[], userId: string) {
    for (const id of sessionIds) {
        await db.query(
            `INSERT INTO public.session_progress_evaluations
               (session_id, user_id, formula_version, attribution_status,
                duration_seconds, word_count, clarity_evidence_available, eligible, exclusion_reasons)
             VALUES ($1, $2, 'clarity_v1', 'attributed', 60, 100, true, false,
                     ARRAY['unverified_attribution'])`,
            [id, userId],
        );
    }
}

type Row = { id: string; transcript_state: string; has_text: boolean; total_words: number | null; filler_counts: unknown };
const readAll = async (db: PGlite, userId: string) => (await db.query<Row>(
    `SELECT id, transcript_state, (transcript IS NOT NULL) AS has_text, total_words, filler_counts
     FROM public.sessions WHERE user_id = $1 ORDER BY created_at ASC`, [userId],
)).rows;

describe('newest-ONE transcript retention, executed against the real migrations', () => {
    let db: PGlite;
    let oldest: string; let middle: string; let newest: string;

    beforeEach(async () => {
        db = await freshDb();
        oldest = await seedSession(db, U, '2026-08-01T10:00:00Z', 'the first session transcript', 100);
        middle = await seedSession(db, U, '2026-08-02T10:00:00Z', 'the second session transcript', 200);
        newest = await seedSession(db, U, '2026-08-03T10:00:00Z', 'the third session transcript', 300);
    });

    it('the policy marker moved, and every pinning check moved with it', async () => {
        // The marker is pinned by two independent fail-closed checks. If only the threshold had changed,
        // the coordinator and the preflight would RAISE — which is the design working, and is why the
        // correction cannot be a one-line edit.
        const v = await db.query<{ v: string }>('SELECT public.transcript_retention_policy_version() AS v');
        expect(v.rows[0].v).toBe('newest_one_v1');

        // Neither pinning caller raises on the new version.
        await expect(db.query('SELECT public.converge_transcript_retention($1)', [U])).resolves.toBeTruthy();
        await expect(db.query(`SELECT public.transcript_retention_preflight('single_user', $1)`, [U]))
            .resolves.toBeTruthy();
    });

    it('CASUALTY: the read helper selects the second-newest AND the oldest', async () => {
        // Under newest-two this returned the oldest alone. The second-newest joining it IS the change.
        const res = await db.query<{ session_id: string }>(
            'SELECT session_id FROM public.transcript_sessions_to_expire($1)', [U],
        );
        expect(new Set(res.rows.map((r) => r.session_id))).toEqual(new Set([oldest, middle]));
    });

    it('CASUALTY: after convergence only the NEWEST transcript remains readable', async () => {
        await giveTerminalEvidence(db, [oldest, middle], U);
        await db.query('SELECT public.converge_transcript_retention($1)', [U]);

        const rows = await readAll(db, U);
        expect(rows.map((r) => ({ state: r.transcript_state, text: r.has_text }))).toEqual([
            { state: 'expired', text: false },   // oldest
            { state: 'expired', text: false },   // second-newest — the behaviour change
            { state: 'available', text: true },  // newest
        ]);
    });

    it('CASUALTY: history and derived metrics survive the expiry', async () => {
        await giveTerminalEvidence(db, [oldest, middle], U);
        await db.query('SELECT public.converge_transcript_retention($1)', [U]);

        const rows = await readAll(db, U);
        // Three session rows still exist, and each keeps the numbers the product shows in Analytics.
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.total_words)).toEqual([100, 200, 300]);
        expect(rows.every((r) => r.filler_counts !== null)).toBe(true);
    });

    it('CASUALTY: an expired session exposes no transcript to open or export', async () => {
        await giveTerminalEvidence(db, [oldest, middle], U);
        await db.query('SELECT public.converge_transcript_retention($1)', [U]);

        // The schema is the enforcement, not the UI: expired rows carry NULL, and the sticky CHECK from
        // #1131 refuses to put text back. An Open/PDF action has nothing to read by construction.
        const res = await db.query<{ transcript: string | null }>(
            'SELECT transcript FROM public.sessions WHERE id = ANY($1)', [[oldest, middle]],
        );
        expect(res.rows.every((r) => r.transcript === null)).toBe(true);

        // Resurrection is prevented by COERCION, not rejection: the #1131 trigger forces an expired row's
        // transcript back to NULL on any later write. An ordinary re-save therefore cannot reintroduce
        // retention-removed text, and it does not need to fail loudly to be safe.
        await db.query(`UPDATE public.sessions SET transcript = 'put it back' WHERE id = $1`, [middle]);
        const after = await db.query<{ transcript: string | null; transcript_state: string }>(
            'SELECT transcript, transcript_state FROM public.sessions WHERE id = $1', [middle],
        );
        expect({ text: after.rows[0].transcript, state: after.rows[0].transcript_state })
            .toEqual({ text: null, state: 'expired' });
    });

    it('CASUALTY: per-user isolation — one user converging does not touch another', async () => {
        const otherOld = await seedSession(db, OTHER, '2026-08-01T09:00:00Z', 'other user oldest', 10);
        const otherNew = await seedSession(db, OTHER, '2026-08-04T09:00:00Z', 'other user newest', 20);

        await giveTerminalEvidence(db, [oldest, middle], U);
        await db.query('SELECT public.converge_transcript_retention($1)', [U]);

        const other = await readAll(db, OTHER);
        expect(other.map((r) => ({ state: r.transcript_state, text: r.has_text }))).toEqual([
            { state: 'available', text: true },   // otherOld — untouched, still readable
            { state: 'available', text: true },   // otherNew
        ]);
        expect([otherOld, otherNew]).toHaveLength(2);
    });

    it('CASUALTY: convergence is idempotent, and it is EVIDENCE that triggers it', async () => {
        // Worth stating because it surprised this test: persisting the evaluation rows is itself what
        // converges. `trg_spe_converge_retention` fires on insert into `session_progress_evaluations`, so
        // by the time anything calls the coordinator explicitly the work is already done. That is how
        // production behaves — retention follows the evidence that licenses it — and a test that assumed
        // its own explicit call did the expiring would have been describing a path nobody takes.
        await giveTerminalEvidence(db, [oldest, middle], U);

        // Already converged by the trigger.
        const afterEvidence = await readAll(db, U);
        expect(afterEvidence.map((r) => r.transcript_state)).toEqual(['expired', 'expired', 'available']);

        // An explicit run afterwards is a no-op: no candidates, nothing expired, no backlog. Running it
        // twice more changes nothing either.
        const first = await db.query<{ r: { expired_count: number; has_more: boolean; status: string } }>(
            'SELECT public.converge_transcript_retention($1) AS r', [U],
        );
        const second = await db.query<{ r: { expired_count: number; has_more: boolean; status: string } }>(
            'SELECT public.converge_transcript_retention($1) AS r', [U],
        );

        expect({
            first: { expired: first.rows[0].r.expired_count, more: first.rows[0].r.has_more, status: first.rows[0].r.status },
            second: { expired: second.rows[0].r.expired_count, more: second.rows[0].r.has_more, status: second.rows[0].r.status },
        }).toEqual({
            first: { expired: 0, more: false, status: 'converged' },
            second: { expired: 0, more: false, status: 'converged' },
        });

        // ...and the surviving state is unchanged by those extra runs.
        expect((await readAll(db, U)).map((r) => r.transcript_state)).toEqual(['expired', 'expired', 'available']);
    });

    it('CASUALTY: a NEW completion re-ranks — yesterday\'s newest expires when today\'s arrives', async () => {
        // The determinism question for overlapping completions: whichever row is newest by
        // (created_at DESC, id DESC) is the one kept, and the previous holder loses its text.
        await giveTerminalEvidence(db, [oldest, middle], U);
        await db.query('SELECT public.converge_transcript_retention($1)', [U]);

        const newer = await seedSession(db, U, '2026-08-04T10:00:00Z', 'a fourth, newer transcript', 400);
        await giveTerminalEvidence(db, [newest], U);
        await db.query('SELECT public.converge_transcript_retention($1)', [U]);

        const rows = await readAll(db, U);
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
        expect({
            previousNewest: byId[newest].transcript_state,
            currentNewest: byId[newer].transcript_state,
            currentHasText: byId[newer].has_text,
        }).toEqual({ previousNewest: 'expired', currentNewest: 'available', currentHasText: true });
    });

    it('CONTROL: the coordinator still DEFERS while evidence is pending', async () => {
        // The evidence gate is not part of this change and must not be weakened by it: a candidate
        // without a durable terminal evaluation is never expired, whatever the rank threshold says.
        const res = await db.query<{ r: { status: string; expired_count: number } }>(
            'SELECT public.converge_transcript_retention($1) AS r', [U],
        );
        expect(res.rows[0].r.status).toBe('pending');
        expect(res.rows[0].r.expired_count).toBe(0);

        const rows = await readAll(db, U);
        expect(rows.every((r) => r.has_text)).toBe(true);
    });

    it('the superseded newest-two mutation is gone, not merely unused', async () => {
        // Left in place it would keep the old rule reachable under its own name.
        const res = await db.query<{ exists: boolean }>(
            `SELECT to_regprocedure('public.expire_transcripts_newest_two(uuid, integer)') IS NOT NULL AS exists`,
        );
        expect(res.rows[0].exists).toBe(false);
    });
});
