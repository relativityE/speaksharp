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

async function freshDb(activate = true): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(TRANSCRIPT_STATE);
    await db.exec(NEWEST_TWO);
    await db.exec(PROGRESS_EVALS);
    await db.exec(CONVERGE);
    await db.exec(PREFLIGHT);
    await db.exec(COMPLETE_V2);
    await db.exec(NEWEST_ONE);
    // Writer-policy cases below exercise the explicitly activated state. Deployment-inertness has its own
    // casualty, which applies the same migration without invoking this service-role-only boundary.
    if (activate) await db.query('SELECT public.activate_transcript_retention_newest_one()');
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


/** A keyed at-cap create: the same authoritative completed save, carrying an idempotency key. */
const keyedCreate = (db: PGlite, key: string, transcript: string | null) => db.query<{ r: Record<string, unknown> }>(
    `SELECT public.create_session_and_update_usage($1::jsonb, 'private', $2::uuid) AS r`,
    [JSON.stringify({
        title: 'recovered take', duration: 600, total_words: 120,
        ...(transcript === null ? {} : { transcript }),
    }), key],
);

/** The `retention` verdict a call returned, or `undefined` when it never reached the coordinator. */
const verdict = (r: Record<string, unknown>) =>
    (r.retention ?? undefined) as { status?: string; reason?: string } | undefined;

const counts = async (db: PGlite) => (await db.query<{
    rows_total: number; with_text: number; checkpoints: number;
}>(`SELECT
      (SELECT COUNT(*) FROM public.sessions WHERE user_id = $1)::int AS rows_total,
      (SELECT COUNT(*) FROM public.sessions WHERE user_id = $1 AND transcript IS NOT NULL)::int AS with_text,
      (SELECT COUNT(*) FROM public.usage_checkpoints WHERE user_id = $1)::int AS checkpoints`,
[U])).rows[0];

/**
 * #1436 P1 — RETENTION IS ARMED BY A COMPLETED POST-ROLLOUT SAVE, AND BY NOTHING ELSE.
 *
 * Deploying the migration must delete nothing. A user's existing transcripts were saved under the
 * previous policy; they did not agree to lose one because we shipped a migration. Newest-one begins to
 * apply to a user only once they complete and save a NEW session after rollout.
 *
 * PRE-ROLLOUT STATE IS STAGED IN REPLICA MODE ON PURPOSE. The arming trigger fires on any completed
 * transcript-bearing session write, so a fixture seeded normally arms itself — which is why every
 * existing casualty in this file passed unchanged when the arming gate was added, and why none of them
 * exercises it. These four stage rows the way rollout actually finds them: already there, never having
 * armed anything.
 */
describe('#1436 — newest-one is armed by a post-rollout save, not by deployment', () => {
    /** Two readable transcripts with settled evidence, none of it having armed retention. */
    async function preRolloutUser(db: PGlite) {
        await db.exec("SET session_replication_role = 'replica'");
        const older = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the older take');
        const newer = await seedPriorTake(db, '2026-09-02T10:00:00Z', 'the newer take');
        await settleEvidence(db, older, 'attributed');
        // `newer` deliberately carries NO evidence yet: the late-settling case needs a pre-rollout
        // completed session whose evaluation arrives after rollout, and every session may hold only one
        // evaluation per formula version.
        // Replica mode also suppresses the trigger that OWNS `transcript_state`, so set it here — real
        // pre-rollout rows are `available`, and the migration's invariant gate correctly refuses to run
        // against text sitting on a `not_captured` row.
        await db.query(
            `UPDATE public.sessions SET transcript_state = 'available' WHERE user_id = $1 AND transcript IS NOT NULL`,
            [U]);
        await db.exec("SET session_replication_role = 'origin'");
        expect((await counts(db)).with_text, 'rollout finds two readable transcripts').toBe(2);
        return { older, newer };
    }

    it('CASUALTY A: deploying the migration deletes nothing', async () => {
        const db = await freshDb(false);
        await preRolloutUser(db);

        const result = await db.query<{ r: { status?: string; reason?: string } }>(
            'SELECT public.converge_transcript_retention($1) AS r', [U]);
        expect(result.rows[0].r?.status, 'convergence is a no-op until activation').toBe('deferred');
        expect(result.rows[0].r?.reason, 'and it says why').toBe('retention_not_activated');
        expect((await counts(db)).with_text, 'both transcripts survive deployment').toBe(2);
        await db.close();
    });

    it('CASUALTY A2: inert installation still saves a completed transcript without retiring any prior text', async () => {
        const db = await freshDb(false);
        await preRolloutUser(db);
        const active = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, created_at, total_words, duration, status)
             VALUES ($1, '2026-09-03T10:00:00Z'::timestamptz, 100, 60, 'active') RETURNING id`,
            [U],
        )).rows[0].id;

        const res = (await db.query<{ r: Record<string, unknown> }>(
            `SELECT public.complete_session_v2(p_session_id => $1::uuid, p_status => 'completed',
                 p_next_action => '{"kind":"practice_again"}'::jsonb, p_filler_counts => '{}'::jsonb,
                 p_final_transcript => 'the real-world-test take') AS r`, [active],
        )).rows[0].r;

        expect(res.transcript_outcome, 'the new transcript is truthfully retained while policy is inert')
            .toBe('retained');
        expect(verdict(res)).toEqual(expect.objectContaining({
            status: 'deferred', reason: 'retention_not_activated',
        }));
        expect((await counts(db)).with_text, 'no prior transcript was retired during the test window').toBe(3);
        expect((await db.query<{ n: number }>(
            'SELECT COUNT(*)::int AS n FROM public.transcript_retention_tombstones',
        )).rows[0].n, 'an inert policy creates no tombstones because it performs no expiry').toBe(0);
        await db.close();
    });

    it('CASUALTY B: an old evaluation settling after rollout deletes nothing', async () => {
        const db = await freshDb();
        const { newer } = await preRolloutUser(db);

        // A delayed terminal evaluation for a PRE-ROLLOUT completed session, inserted normally so the
        // convergence trigger genuinely fires. No new save has happened.
        await settleEvidence(db, newer, 'attributed');

        expect((await counts(db)).with_text, 'a late evaluation is not a new save').toBe(2);
        await db.close();
    });

    it('CASUALTY C: starting or cancelling a session deletes nothing', async () => {
        const db = await freshDb();
        await preRolloutUser(db);

        // Press record: a transcript-free placeholder create. Then abandon it.
        await lateCreate(db, null);
        expect((await counts(db)).with_text, 'pressing record costs the user nothing').toBe(2);

        const active = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, created_at, duration, status)
             VALUES ($1, '2026-09-03T11:00:00Z'::timestamptz, 0, 'active') RETURNING id`, [U])).rows[0].id;
        await db.query(`UPDATE public.sessions SET status = 'failed' WHERE id = $1`, [active]);
        expect((await counts(db)).with_text, 'cancelling costs the user nothing').toBe(2);

        /**
         * AN ACTIVE SESSION CARRYING TEXT MUST NOT ARM EITHER — the late-create recovery case.
         *
         * This is what makes the arming trigger's `status = 'completed'` clause measurable. Without it
         * the casualties above still pass, because none of them writes transcript text on a
         * non-completed row: the `transcript IS NOT NULL` clause alone was carrying them. A recovery
         * create supplies real text on an `active` row, and if that armed retention, the user's older
         * transcript would be retired by a take that has not finished — and may still fail.
         */
        const recovered = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration,
                 filler_counts, status, transcript_state)
             VALUES ($1, '2026-09-03T11:30:00Z'::timestamptz, 'a recovered but unfinished take', 40, 90,
                     '{"um": 1}'::jsonb, 'active', 'available') RETURNING id`, [U])).rows[0].id;
        await settleEvidence(db, recovered, 'attributed');

        const armed = await db.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM public.transcript_retention_arming WHERE user_id = $1', [U]);
        expect(armed.rows[0].n, 'an unfinished take does not arm retention').toBe(0);
        expect((await counts(db)).with_text,
            "both of the user's saved transcripts survive an unfinished recovery take").toBe(3);
        await db.close();
    });

    it('CASUALTY D: the first completed post-rollout save arms retention and keeps only the newest', async () => {
        const db = await freshDb();
        const { newer } = await preRolloutUser(db);
        // Settle the second pre-rollout evaluation so the whole cohort is rankable. This is itself an
        // old evaluation and deletes nothing (casualty B); it only removes the coordinator's reason to
        // defer, so what this casualty measures is the ARMING, not a pending-evidence deferral.
        await settleEvidence(db, newer, 'attributed');
        expect((await counts(db)).with_text, 'still two, still unarmed').toBe(2);

        /**
         * A REAL COMPLETED SAVE THROUGH THE RPC — not a raw INSERT.
         *
         * Arming no longer comes from a row-shape trigger, so seeding a row directly cannot arm and
         * must not: a direct write is exactly the forgery the trigger allowed. This drives the at-cap
         * branch of `create_session_and_update_usage`, which is an authoritative completed save.
         */
        await lateCreate(db, 'the first post-rollout take');

        const rows = (await db.query<{ transcript: string | null }>(
            `SELECT transcript FROM public.sessions WHERE user_id = $1 ORDER BY created_at ASC`, [U])).rows;
        expect(rows.filter(r => r.transcript !== null).length,
            'newest-one now applies: exactly one transcript remains').toBe(1);
        expect(rows[rows.length - 1].transcript,
            'and it is the post-rollout save the user just made').toBe('the first post-rollout take');
        await db.close();
    });
});

describe('#1436 — the late-create transcript writer is failure-atomic', () => {
    it('CONTROL (PM handoff `5641029573`): a designed self-healing outcome PRESERVES the new transcript', async () => {
        /**
         * This case used to require a REFUSAL. That was the defect: the coordinator's `pending` and
         * `non_converged` outcomes are designed self-healing states, not failures, and raising on them
         * destroyed a transcript the writer had already saved successfully. The save is kept and the
         * verdict is reported truthfully; only a real exception or an unrecognized status rolls back,
         * which the casualties below still prove.
         */
        const db = await freshDb();
        // The user's prior take is saved and its evaluation has NOT settled, so the coordinator cannot
        // expire it. This is the ordinary state moments after a save.
        const prior = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the first take, in the user\'s words');
        await settleEvidence(db, prior, 'pending');

        const created = (await lateCreate(db, 'the recovered second take')) as unknown as
            { rows: { r: Record<string, unknown> }[] };
        const v = verdict(created.rows[0].r);
        expect(v?.status, 'the designed outcome is reported, not raised').toMatch(/^(pending|non_converged)$/);

        const rows = (await db.query<{ id: string; transcript: string | null }>(
            'SELECT id, transcript FROM public.sessions WHERE user_id = $1', [U])).rows;
        expect(rows.some(r => r.transcript === 'the recovered second take'),
            "the save the user just made is kept").toBe(true);
        const priorText = await db.query<{ transcript: string | null }>(
            'SELECT transcript FROM public.sessions WHERE id = $1', [prior]);
        expect(priorText.rows[0].transcript, 'the take the user already had is untouched')
            .toBe('the first take, in the user\'s words');
        await db.close();
    });

    it('CONTROL (PM handoff `5641029573`): a `non_converged` backlog is also preserved, not rolled back', async () => {
        /**
         * The coordinator returns `non_converged` when a historical backlog exceeds one bounded batch
         * (`has_more`), which is a designed R3 hand-off — not a failure of this save. Seeding past the
         * 500-row batch is the only way to reach that status through the real migration, so this case
         * proves the second newly allowed status independently of the `pending` ones above.
         */
        const db = await freshDb();
        await db.query(
            `INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration, filler_counts, status)
             SELECT $1, timestamptz '2026-08-01T00:00:00Z' + (g || ' seconds')::interval,
                    'an older take ' || g, 100, 600, '{"um": 2}'::jsonb, 'completed'
             FROM generate_series(1, 502) AS g`, [U]);
        await db.query(
            `INSERT INTO public.session_progress_evaluations
               (session_id, user_id, formula_version, attribution_status, duration_seconds, word_count,
                clarity_evidence_available, eligible, exclusion_reasons)
             SELECT id, $1, 'clarity_v1', 'attributed', 600, 100, true, false, ARRAY['unverified_attribution']
             FROM public.sessions WHERE user_id = $1`, [U]);

        const created = (await lateCreate(db, 'the take that must survive a backlog')) as unknown as
            { rows: { r: Record<string, unknown> }[] };
        expect(verdict(created.rows[0].r)?.status, 'the backlog hand-off is reported, not raised')
            .toBe('non_converged');
        expect((await db.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM public.sessions
             WHERE user_id = $1 AND transcript = 'the take that must survive a backlog'`, [U],
        )).rows[0].n, 'the save the user just made is kept').toBe(1);
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

    it('CASUALTY 5: a placeholder create EXPIRES NOTHING even when convergence would act', async () => {
        /**
         * #1436 P1 — DATA LOSS. RECORDING START IS NOT A SAVE.
         *
         * The writer called the coordinator unconditionally. On first application to a user still
         * holding two legacy transcripts whose older row already has TERMINAL evidence, the ordinary
         * transcript-free create at recording start expired the older transcript before the new take
         * had captured a word. Cancel or fail that take and the user has strictly less readable text
         * than before they pressed record — contrary to this migration's own "next completed save"
         * boundary.
         *
         * CASUALTY 4 CANNOT CATCH THIS, and that is the point of adding this one. Casualty 4
         * deliberately leaves the candidate PENDING so the coordinator has nothing it is permitted to
         * expire — the destructive branch never runs there. Terminal evidence is what arms it.
         */
        const db = await freshDb();
        const older = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the older take');
        const newer = await seedPriorTake(db, '2026-09-02T10:00:00Z', 'the newer take');
        // Terminal evidence staged WITHOUT firing the on-save convergence trigger, so the user arrives
        // at this migration in the real pre-correction state: two readable transcripts, both settled,
        // nothing yet converged. Evidence inserted normally would converge them here and the casualty
        // would then be testing a cohort that no longer has anything to lose.
        await db.exec("SET session_replication_role = 'replica'");
        await settleEvidence(db, older, 'attributed');
        await settleEvidence(db, newer, 'attributed');
        await db.exec("SET session_replication_role = 'origin'");

        const before = await counts(db);
        expect(before.with_text, 'the user really is holding two readable transcripts').toBe(2);

        // Press record. This is a placeholder create — no words yet.
        await lateCreate(db, null);

        const after = await counts(db);
        expect(after.with_text, 'a placeholder took nothing away from the user').toBe(before.with_text);
        const olderRow = await db.query<{ transcript: string | null }>(
            'SELECT transcript FROM public.sessions WHERE id = $1', [older]);
        expect(olderRow.rows[0].transcript, "the older transcript survives pressing record").not.toBeNull();
        await db.close();
    });

    it('CASUALTY 6: a transcript-bearing idempotency REPLAY still owes convergence', async () => {
        /**
         * #1436 P1 — the duplicate short-circuit returned before taking the profile lock or invoking
         * retention: idempotent about the ROW, and silently idempotent about the RETENTION too. A
         * replay could therefore keep reporting success forever without the cohort ever converging.
         *
         * WHAT THIS ASSERTS, AND WHY IT IS NOT "two texts become one". Under the arming boundary an
         * armed user cannot be holding a second readable transcript in the first place — every writer
         * path either converges or withdraws its own text (casualties 1 and F). So the observable that
         * actually separates the defect from the fix is whether the replay REACHED the coordinator:
         * the corrected replay carries a `retention` verdict, the short-circuit carries none. Casualty
         * E covers the unarmed half, where the verdict is `deferred`.
         */
        const db = await freshDb();
        const key = '9f1c0f4a-6d2e-4a1b-9c7d-2b8e5a3f10cc';

        // A genuine post-rollout at-cap save under this key: it arms, and it converges.
        const first = verdict((await keyedCreate(db, key, 'the replayed take')).rows[0].r);
        expect(first?.status, 'the original save converged').toBe('converged');

        const replay = (await keyedCreate(db, key, 'the replayed take')).rows[0].r;
        expect(replay.is_duplicate, 'the replay is still recognised as a duplicate').toBe(true);
        expect(verdict(replay), 'the replay reached the coordinator instead of short-circuiting past it')
            .toBeDefined();
        expect(verdict(replay)?.status, 'and it converged').toBe('converged');
        expect((await counts(db)).with_text, 'the replay created no second text').toBe(1);
        await db.close();
    });

    it('CASUALTY E: an UNARMED legacy replay asks, is told `deferred`, and expires nothing', async () => {
        /**
         * The arming boundary meeting the replay path. A legacy user whose two transcripts predate
         * rollout retries a create. The replay must still ASK — that is casualty 6's claim — but the
         * answer is `deferred`, and the transcripts they saved under the previous policy stay readable.
         *
         * This also pins the failure mode I shipped and had to correct: the replay branch RAISED on any
         * status other than `converged`, so this legacy retry died with a hard save error instead of
         * returning duplicate success.
         */
        const db = await freshDb();
        const key = '5c2b7a90-33f1-4a6d-b0e2-7c1d9e4f2a55';
        const older = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the older take');
        await db.query(
            `INSERT INTO public.sessions (id, user_id, created_at, transcript, total_words, duration,
                 filler_counts, status, idempotency_key)
             VALUES (gen_random_uuid(), $1, '2026-09-02T10:00:00Z'::timestamptz, 'the replayed take',
                     100, 600, '{"um": 1}'::jsonb, 'completed', $2)`,
            [U, key]);
        const replayed = (await db.query<{ id: string }>(
            'SELECT id FROM public.sessions WHERE idempotency_key = $1', [key])).rows[0].id;
        // Evidence only is staged in replica mode: settling is what would trigger convergence, and the
        // point here is to arrive at the replay with both texts still readable.
        await db.exec("SET session_replication_role = 'replica'");
        await settleEvidence(db, older, 'attributed');
        await settleEvidence(db, replayed, 'attributed');
        await db.exec("SET session_replication_role = 'origin'");
        expect((await counts(db)).with_text, 'the pre-rollout state really does hold two texts').toBe(2);

        const replay = (await keyedCreate(db, key, 'the replayed take')).rows[0].r;

        expect(replay.is_duplicate, 'the retry still returns duplicate success, not an error').toBe(true);
        expect(verdict(replay)?.status, 'it asked, and was told the user is not armed').toBe('deferred');
        expect(verdict(replay)?.reason, 'for that reason and no other').toBe('retention_not_armed');
        expect((await counts(db)).with_text, 'and both pre-rollout transcripts survive').toBe(2);
        await db.close();
    });

    it('CONTROL (PM handoff `5641029573`): a `pending` completion is kept, not rolled back', async () => {
        /**
         * #1436 P1 — a save arms only if it actually kept text. `complete_session_v2` arms inside the
         * transcript subtransaction, so a RAISED convergence failure reverts the arming with it. The
         * uncovered path is the one where the coordinator RETURNS `pending`. Reporting success after
         * NULLing the new transcript loses the user's words. The whole completion must instead roll back,
         * leaving the row retryable and the controller's recovery draft authoritative.
         */
        const db = await freshDb();
        // An older readable take whose evaluation has NOT settled: convergence must defer on it.
        const older = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the older take');
        await settleEvidence(db, older, 'pending');
        const active = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, created_at, total_words, duration, status)
             VALUES ($1, '2026-09-04T10:00:00Z'::timestamptz, 100, 600, 'active') RETURNING id`,
            [U])).rows[0].id;

        const completed = (await db.query<{ r: Record<string, unknown> }>(
            `SELECT public.complete_session_v2(p_session_id => $1::uuid, p_status => 'completed',
                 p_next_action => '{"kind":"practice_again"}'::jsonb, p_filler_counts => '{}'::jsonb,
                 p_final_transcript => 'the take that must remain retryable') AS r`, [active])).rows[0].r;

        expect(verdict(completed)?.status, 'the designed outcome is reported, not raised')
            .toMatch(/^(pending|non_converged)$/);
        expect((await db.query<{ status: string; transcript: string | null }>(
            'SELECT status, transcript FROM public.sessions WHERE id = $1', [active],
        )).rows[0], 'the completion stands and the words the user just spoke are saved')
            .toEqual({ status: 'completed', transcript: 'the take that must remain retryable' });
        await db.close();
    });

    it('CASUALTY H: an ACTIVE recovery create expires nothing, even for an armed user', async () => {
        /**
         * #1436 P1 — `v_initial_at_cap` gated only whether a non-converged result RAISES; every
         * transcript-bearing create still called the coordinator. A sub-600s recovery create inserts an
         * ACTIVE row, and for an armed user whose retained transcript carries terminal evidence that
         * new row ranks first, so convergence expired the previously saved transcript on the spot.
         * Abandon the recovery take — or let its `complete_session_v2` fail — and the user is left with
         * strictly less readable text than before they started, irreversibly.
         *
         * Casualty 5 could not catch this: its create carries no transcript, so it never reaches the
         * coordinator branch at all. This one carries real text at a real sub-cap duration, which is
         * exactly the recovery shape.
         */
        const db = await freshDb();
        // A genuine post-rollout completed save: it arms, and its own text is the retained one.
        await lateCreate(db, 'the take the user already saved');
        const saved = (await db.query<{ id: string }>(
            `SELECT id FROM public.sessions WHERE user_id = $1 AND transcript IS NOT NULL`, [U])).rows[0].id;
        await settleEvidence(db, saved, 'attributed');
        expect((await counts(db)).with_text, 'one saved take, armed and settled').toBe(1);

        // The recovery create: real words, ordinary duration, so the row lands ACTIVE — not a save yet.
        const res = (await db.query<{ r: Record<string, unknown> }>(
            `SELECT public.create_session_and_update_usage($1::jsonb, 'private') AS r`,
            [JSON.stringify({ title: 'recovered take', duration: 120, total_words: 40,
                transcript: 'the words the recovery is trying to rescue' })])).rows[0].r;

        expect((res.retention as { status?: string })?.status,
            'an active create is not a completion, so it defers').toBe('deferred');
        expect((res.retention as { reason?: string })?.reason).toBe('create_not_completed');
        expect((await db.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM public.sessions
             WHERE id = $1 AND transcript IS NOT NULL AND transcript_state = 'available'`, [saved],
        )).rows[0].n, "the take the user had already saved is still readable").toBe(1);
        await db.close();
    });

    it('CASUALTY I: a completion carrying BLANK text arms nothing and expires nothing', async () => {
        /**
         * #1436 P1 — `v_wrote_transcript` meant only that a non-NULL argument was supplied. A
         * completion sending '   ' set it true, the transcript-state trigger classified the row
         * `not_captured` — nothing retained — and the user was armed anyway. Convergence then SUCCEEDED
         * and expired a legacy user's older transcript, and because the outcome was `converged` the
         * non-retained cleanup never ran, so the false arming stayed behind as well.
         *
         * Casualty F cannot reach this: its completion retains real text and fails on a PENDING
         * cohort, so it exercises the cleanup path rather than the decision to arm at all.
         */
        const db = await freshDb();
        const older = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the legacy take');
        await settleEvidence(db, older, 'attributed');
        const active = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, created_at, total_words, duration, status)
             VALUES ($1, '2026-09-04T10:00:00Z'::timestamptz, 100, 600, 'active') RETURNING id`,
            [U])).rows[0].id;

        await db.query(
            `SELECT public.complete_session_v2(p_session_id => $1::uuid, p_status => 'completed',
                 p_next_action => '{"kind":"practice_again"}'::jsonb, p_filler_counts => '{}'::jsonb,
                 p_final_transcript => '   ') AS r`, [active]);

        expect((await db.query<{ n: number }>(
            'SELECT COUNT(*)::int AS n FROM public.transcript_retention_arming WHERE user_id = $1', [U],
        )).rows[0].n, 'a save that kept no words is not the completed save that arms').toBe(0);
        expect((await db.query<{ transcript: string | null }>(
            'SELECT transcript FROM public.sessions WHERE id = $1', [older])).rows[0].transcript,
        "and the user's legacy transcript was not expired on the strength of it")
            .toBe('the legacy take');
        await db.close();
    });

    it('CASUALTY G: a completion that DOES retain its transcript arms retention', async () => {
        /**
         * The other half of casualty F, and the reason F cannot stand alone: F asserts an ABSENCE, so
         * it passes vacuously if `complete_session_v2` never arms at all. Removing the arming call
         * would then look clean while the ordinary completion path — the one most saves take — stopped
         * arming entirely, and newest-one would silently never engage for those users.
         */
        const db = await freshDb();
        const active = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, created_at, total_words, duration, status)
             VALUES ($1, '2026-09-04T10:00:00Z'::timestamptz, 100, 600, 'active') RETURNING id`,
            [U])).rows[0].id;

        const res = (await db.query<{ r: Record<string, unknown> }>(
            `SELECT public.complete_session_v2(p_session_id => $1::uuid, p_status => 'completed',
                 p_next_action => '{"kind":"practice_again"}'::jsonb, p_filler_counts => '{}'::jsonb,
                 p_final_transcript => 'the take that was kept') AS r`, [active])).rows[0].r;

        expect(res.transcript_outcome, 'the text really was retained').toBe('retained');
        expect((await db.query<{ n: number; by: string | null }>(
            `SELECT COUNT(*)::int AS n, MAX(armed_by_session::text) AS by
             FROM public.transcript_retention_arming WHERE user_id = $1`, [U],
        )).rows[0], 'and the completion armed retention, naming itself as the save that did it')
            .toEqual({ n: 1, by: active });
        await db.close();
    });

    it('CASUALTY 7: a terminal evaluation for a NON-completed session expires nothing', async () => {
        /**
         * #1436 P1 — THE SECOND DOOR. `trg_spe_converge_retention` fires on every terminal evaluation
         * insert and called the coordinator with only the user id, so inserting an evaluation for a
         * preexisting or still-active session reached the expiry path and retired a legacy transcript
         * without the completed save this migration promises as the boundary. Deferring the
         * placeholder create closed the writer door; this one was still open.
         *
         * Casualties 4 and 5 cannot catch it — they exercise the CREATE path, and this arrives through
         * the trigger.
         */
        const db = await freshDb();
        const older = await seedPriorTake(db, '2026-09-01T10:00:00Z', 'the older take');
        const newer = await seedPriorTake(db, '2026-09-02T10:00:00Z', 'the newer take');
        await db.exec("SET session_replication_role = 'replica'");
        await settleEvidence(db, older, 'attributed');
        await settleEvidence(db, newer, 'attributed');
        await db.exec("SET session_replication_role = 'origin'");
        expect((await counts(db)).with_text, 'two readable transcripts, as production enters this migration').toBe(2);

        // An ACTIVE session — the user has pressed record and captured nothing durable yet.
        const active = (await db.query<{ id: string }>(
            `INSERT INTO public.sessions (user_id, created_at, duration, status)
             VALUES ($1, '2026-09-03T10:00:00Z'::timestamptz, 0, 'active') RETURNING id`, [U])).rows[0].id;

        // Its terminal evaluation lands. Through the trigger, this used to expire the older transcript.
        await settleEvidence(db, active, 'attributed');

        expect((await counts(db)).with_text, 'a non-completed session took nothing away from the user').toBe(2);
        await db.close();
    });

    it('CASUALTY 8: a replay that OMITS the transcript is decided by the STORED row', async () => {
        /**
         * #1436 P1 — the replay guard tested the CALLER's payload. A retry that omitted `transcript`
         * (or sent it blank) took the transcript-free fast path and returned duplicate success without
         * ever reaching retention. Casualty 6 sends the transcript, so it cannot expose this: the
         * obligation comes from what was PERSISTED under that key, which the caller must not be able to
         * revoke by sending less.
         */
        const db = await freshDb();
        const key = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

        const first = verdict((await keyedCreate(db, key, 'the stored take')).rows[0].r);
        expect(first?.status, 'the original save stored text and converged').toBe('converged');

        // The retry carries NO transcript — but the stored row does.
        const replay = (await keyedCreate(db, key, null)).rows[0].r;

        expect(replay.is_duplicate, 'still a duplicate').toBe(true);
        expect(verdict(replay), 'the empty payload did not buy it the transcript-free fast path')
            .toBeDefined();
        expect(verdict(replay)?.status, 'the stored row decided, and it converged').toBe('converged');
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
