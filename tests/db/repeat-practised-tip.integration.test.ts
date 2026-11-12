// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Outcome 4 step 2 (D2), revision 2: the tip chosen for a repeat is copied when Practice again is pressed, bound by
 * the server to the repeat when that session completes (before the original expires), and deleted under its own
 * retention rule. Real PostgreSQL (PGlite) over the Progress, retention-purge and new migrations, verbatim.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const BOOTSTRAP = read('tests/db/progress-evaluations-bootstrap.sql');
const MIGRATIONS = [
    'backend/supabase/migrations/20260731120000_session_progress_evaluations.sql',
    'backend/supabase/migrations/20260731130000_progress_recommendations.sql',
    'backend/supabase/migrations/20260810120000_retention_purge_ai_suggestions.sql',
    'backend/supabase/migrations/20261112010000_repeat_practised_tip.sql',
].map(read);

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const C = 'aaaaaaaa-0000-4000-8000-00000000000c';
const TIP = 'Pause before you name the price.';
const review = (over: Record<string, unknown> = {}) => ({
    version: 'gemini_coaching_v1', what_worked: 'The opening was concrete.', what_to_try_next: `  ${TIP}  `, ...over,
});

let db: PGlite;

const SEQ = { n: 0 };
const sid = () => `aaaaaaaa-0000-4000-8000-${String(++SEQ.n).padStart(12, '0')}`;

/** A session that was already saved before the scenario starts (the original, or an older session). */
async function seed(id: string, minutesAgo: number, fillers: number, aiSuggestions: unknown = review(), user = USER) {
    await db.query(
        `INSERT INTO public.sessions (id, user_id, total_words, duration, wpm, filler_words, transcript, engine, engine_version,
             model_name, attribution_status, status, created_at, ai_suggestions, transcript_state)
         VALUES ($1, $2, 300, 120, 140, $3::jsonb, 'a transcript', 'private', 'whisper-base.en@v2', 'whisper-base.en',
                 'verified', 'completed', now() - make_interval(mins => $4), $5::jsonb, 'available')`,
        [id, user, JSON.stringify({ um: { count: fillers }, total: { count: fillers } }), minutesAgo,
            aiSuggestions === null ? null : JSON.stringify(aiSuggestions)],
    );
}

/** Start recording: an active session row, created now (after any earlier Practice again) unless told otherwise. */
async function start(id: string, opts: { createdAt?: string; user?: string } = {}) {
    await db.query(
        `INSERT INTO public.sessions (id, user_id, total_words, duration, wpm, filler_words, engine, engine_version,
             model_name, attribution_status, status, created_at, transcript_state)
         VALUES ($1, $2, 300, 120, 140, '{"um":{"count":2},"total":{"count":2}}'::jsonb, 'private', 'whisper-base.en@v2',
                 'whisper-base.en', 'verified', 'active', COALESCE($3::timestamptz, clock_timestamp()), 'not_captured')`,
        [id, opts.user ?? USER, opts.createdAt ?? null],
    );
}

/**
 * Save a started session in the order `complete_session_v2` (20261025021046) runs it, in ONE transaction:
 *   step (1) the metrics/status write (line 418) — `status = 'completed'`;
 *   step (2) the transcript write (line 446), then newest-one retention, which expires every older completed
 *            transcript-bearing session of the owner (`expire_transcripts_newest_one`, line 264), and the existing
 *            `trg_sessions_purge_derived_on_expire` (20260810120000, applied verbatim) nulls their reviews.
 * Only the retention function's selection is restated; every trigger under test runs for real.
 */
async function save(id: string, opts: { aiSuggestions?: unknown; transcript?: string | null } = {}) {
    await db.transaction(async (tx) => {
        await tx.query(`UPDATE public.sessions SET status = 'completed' WHERE id = $1`, [id]);
        const transcript = opts.transcript === undefined ? 'a transcript' : opts.transcript;
        await tx.query(
            `UPDATE public.sessions SET transcript = $2, transcript_state = CASE WHEN $2::text IS NULL THEN 'not_captured' ELSE 'available' END,
                 ai_suggestions = $3::jsonb WHERE id = $1`,
            [id, transcript, opts.aiSuggestions === undefined || opts.aiSuggestions === null ? null : JSON.stringify(opts.aiSuggestions)]);
        if (transcript !== null) {
            await tx.query(
                `UPDATE public.sessions s SET transcript = NULL, transcript_state = 'expired'
                   FROM public.sessions k
                  WHERE k.id = $1 AND s.user_id = k.user_id AND s.status = 'completed' AND s.transcript IS NOT NULL
                    AND (s.created_at, s.id) < (k.created_at, k.id)`, [id]);
        }
    });
}

/** Run as the signed-in user through PostgREST's role, exactly as a client RPC would. */
async function asUser<T>(user: string, run: (tx: Pick<PGlite, 'query'>) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
        await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user]);
        await tx.exec('SET LOCAL ROLE authenticated');
        return run(tx as unknown as Pick<PGlite, 'query'>);
    });
}

async function rpc<T>(user: string, sql: string, params: unknown[]): Promise<T> {
    return asUser(user, async (tx) => (await tx.query<{ v: T }>(sql, params)).rows[0].v);
}

const evaluate = (id: string) => rpc(USER, 'SELECT public.record_progress_evaluation($1) AS v', [id]);
/** A's evaluation and its recommendation, as the app records them after A's save. */
async function recommendOnA(): Promise<string> {
    await evaluate(A);
    return rpc<string>(USER, `SELECT public.record_progress_recommendation($1, 'filler_rate', 'decrease', 3, 'percent', 'Cut fillers') AS v`, [A]);
}

const accept = (rec: string, user = USER) => rpc<string>(user, 'SELECT public.record_recommendation_attempt($1) AS v', [rec]);
const advance = (attempt: string, lifecycle: string, practice: string | null = null, next: string | null = null) =>
    rpc<string>(USER, 'SELECT public.advance_recommendation_attempt($1, $2, $3, $4) AS v', [attempt, lifecycle, practice, next]);
const state = async (attempt: string) => (await db.query<{ practised_tip: string | null; tip_session_id: string | null; lifecycle: string; practice_session_id: string | null }>(
    'SELECT practised_tip, tip_session_id, lifecycle, practice_session_id FROM public.progress_recommendation_attempts WHERE id = $1', [attempt])).rows[0];
const tipOf = async (attempt: string) => (await state(attempt))?.practised_tip;
const reviewOf = async (id: string) => (await db.query<{ ai_suggestions: unknown }>('SELECT ai_suggestions FROM public.sessions WHERE id = $1', [id])).rows[0].ai_suggestions;

/** The original A (saved an hour ago, with a valid review), its recommendation, and Practice again pressed. */
async function pressPracticeAgain(): Promise<string> {
    await seed(A, 60, 6);
    return accept(await recommendOnA());
}

beforeEach(async () => {
    db = new PGlite();
    await db.exec(BOOTSTRAP);
    // Production `sessions` carries these (the bootstrap predates them).
    await db.exec(`ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS ai_suggestions jsonb,
                                              ADD COLUMN IF NOT EXISTS transcript_state text`);
    for (const sql of MIGRATIONS) await db.exec(sql);
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${USER}'), ('${OTHER}')`);
    await db.exec('GRANT authenticated TO CURRENT_USER');
});

describe('outcome 4 D2 rev 2: the tip chosen for a repeat is bound to it by the server and kept under its own rule', () => {
    it('save order: the repeat is bound when it completes, before the original expires; the tip survives the purge and the advance', async () => {
        const attempt = await pressPracticeAgain();
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: null, lifecycle: 'pending' });

        await start(B);
        await save(B, { aiSuggestions: review({ what_to_try_next: 'A different, newer tip.' }) });
        // In the same save: B is bound, A's transcript expired and its review purged, and the copy is B's.
        expect(await reviewOf(A)).toBeNull();
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: B, lifecycle: 'pending' });

        // The non-blocking advance after the save confirms the binding.
        await evaluate(B);
        expect(await advance(attempt, 'completed', B, B)).toBe('moved');
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: B, practice_session_id: B });

        // Owner-only reads through the existing RLS select.
        const own = await asUser(USER, (tx) => tx.query<{ practised_tip: string }>(
            'SELECT practised_tip FROM public.progress_recommendation_attempts WHERE practice_session_id = $1', [B]));
        expect(own.rows).toEqual([{ practised_tip: TIP }]);
        const other = await asUser(OTHER, (tx) => tx.query('SELECT practised_tip FROM public.progress_recommendation_attempts', []));
        expect(other.rows).toEqual([]);
    });

    it('any newer save deletes the copy, even when neither session has coaching or a kept transcript', async () => {
        const attempt = await pressPracticeAgain();
        await start(B);
        await save(B, { aiSuggestions: null });
        await evaluate(B);
        await advance(attempt, 'not_comparable', B);
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: B });
        // C saves with no coaching and no transcript: retention expires nothing, the copy still goes.
        await start(C);
        await save(C, { aiSuggestions: null, transcript: null });
        expect(await db.query(`SELECT transcript_state FROM public.sessions WHERE id = $1`, [B]).then((r) => r.rows[0])).toEqual({ transcript_state: 'available' });
        expect(await state(attempt)).toMatchObject({ practised_tip: null, tip_session_id: B, practice_session_id: B });
    });

    it("the repeat's own expiry deletes the copy, with no condition on its coaching", async () => {
        const attempt = await pressPracticeAgain();
        await start(B);
        await save(B, { aiSuggestions: null });
        await db.query(`UPDATE public.sessions SET transcript = NULL, transcript_state = 'expired' WHERE id = $1`, [B]);
        expect(await tipOf(attempt)).toBeNull();
    });

    it('deleting the repeat deletes the copy (SET NULL on both links), before or after the advance', async () => {
        const first = await pressPracticeAgain();
        await start(B);
        await save(B);
        await db.query('DELETE FROM public.sessions WHERE id = $1', [B]);
        expect(await state(first)).toMatchObject({ practised_tip: null, tip_session_id: null, lifecycle: 'pending' });

        await db.exec('TRUNCATE public.progress_recommendation_attempts, public.progress_recommendations, public.session_progress_evaluations, public.sessions CASCADE');
        const second = await pressPracticeAgain();
        await start(B);
        await save(B);
        await evaluate(B);
        await advance(second, 'completed', B, B);
        await db.query('DELETE FROM public.session_progress_evaluations WHERE session_id = $1', [B]);
        await db.query('DELETE FROM public.sessions WHERE id = $1', [B]);
        expect(await state(second)).toMatchObject({ practised_tip: null, tip_session_id: null, practice_session_id: null, lifecycle: 'completed' });
    });

    it('abandoning deletes the copy, before a repeat exists and after one is bound', async () => {
        const unbound = await pressPracticeAgain();
        await advance(unbound, 'abandoned');
        expect(await tipOf(unbound)).toBeNull();

        await db.exec('TRUNCATE public.progress_recommendation_attempts, public.progress_recommendations, public.session_progress_evaluations, public.sessions CASCADE');
        const bound = await pressPracticeAgain();
        await start(B);
        await save(B);
        await advance(bound, 'abandoned');
        expect(await state(bound)).toMatchObject({ practised_tip: null, tip_session_id: B, lifecycle: 'abandoned' });
    });

    it('delayed retry: a newer save before the advance deletes the copy; the late advance still binds the repeat, with no tip', async () => {
        const attempt = await pressPracticeAgain();
        await start(B);
        await save(B);
        await evaluate(B);
        // The advance after B's save failed; the user saves C before the retry.
        await start(C);
        await save(C);
        expect(await state(attempt)).toMatchObject({ practised_tip: null, tip_session_id: B, lifecycle: 'pending' });
        expect(await advance(attempt, 'completed', B, B)).toBe('moved');
        expect(await state(attempt)).toMatchObject({ practised_tip: null, practice_session_id: B });
    });

    it('resolving to a session other than the bound repeat deletes the copy', async () => {
        const attempt = await pressPracticeAgain();
        await start(B);
        await save(B);
        await evaluate(B);
        await advance(attempt, 'not_comparable', A);
        expect(await state(attempt)).toMatchObject({ practised_tip: null, tip_session_id: B, practice_session_id: A });
    });

    it('a save of a session started before Practice again cannot be the repeat, and deletes the copy', async () => {
        await seed(A, 60, 6);
        await start(B, { createdAt: new Date(Date.now() - 30 * 60_000).toISOString() });
        const attempt = await accept(await recommendOnA());
        await save(B);
        expect(await state(attempt)).toMatchObject({ practised_tip: null, tip_session_id: null });
        // A later genuine repeat finds nothing to carry.
        await start(C);
        await save(C);
        expect(await state(attempt)).toMatchObject({ practised_tip: null, tip_session_id: null });
    });

    it('a late save of a session older than the bound repeat, and a replayed completion, change nothing', async () => {
        await seed(A, 60, 6);
        const rec = await recommendOnA();
        const attempt = await accept(rec);
        await start(C);
        await start(B);
        await save(B);
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: B });
        // C started before B (both after Practice again) and saves later: older than the repeat, so no effect.
        await save(C);
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: B });
        // An idempotent replay of B's completion does not rebind or delete.
        await db.query(`UPDATE public.sessions SET status = 'completed' WHERE id = $1`, [B]);
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: B });
    });

    it('the binding is server-only, validated and immutable; the tip can only be cleared', async () => {
        const attempt = await pressPracticeAgain();
        // No client write path at all.
        await expect(asUser(USER, (tx) => tx.query(`UPDATE public.progress_recommendation_attempts SET tip_session_id = $2 WHERE id = $1`, [attempt, A])))
            .rejects.toThrow(/permission denied/);
        // Even a privileged writer cannot bind the original, an unsaved session or a session started before acceptance.
        await expect(db.query(`UPDATE public.progress_recommendation_attempts SET tip_session_id = $2 WHERE id = $1`, [attempt, A]))
            .rejects.toThrow(/cannot hold the tip/);
        await start(B);
        await expect(db.query(`UPDATE public.progress_recommendation_attempts SET tip_session_id = $2 WHERE id = $1`, [attempt, B]))
            .rejects.toThrow(/cannot hold the tip/);
        await save(B);
        await start(C);
        await db.query(`UPDATE public.sessions SET status = 'completed' WHERE id = $1`, [C]);
        // C superseded B, so the copy is gone; and the binding itself can never move.
        await expect(db.query(`UPDATE public.progress_recommendation_attempts SET tip_session_id = $2 WHERE id = $1`, [attempt, C]))
            .rejects.toThrow(/cannot change/);
        await expect(db.query(`UPDATE public.progress_recommendation_attempts SET practised_tip = 'forged' WHERE id = $1`, [attempt]))
            .rejects.toThrow(/set only when the attempt is recorded/);

        // A supplied tip or binding at insert is replaced by the server's own.
        const rec = (await db.query<{ id: string }>('SELECT id FROM public.progress_recommendations')).rows[0].id;
        const forged = await db.query<{ id: string }>(
            `INSERT INTO public.progress_recommendation_attempts (recommendation_id, user_id, practised_tip, tip_session_id)
             VALUES ($1, $2, 'forged', $3) RETURNING id`, [rec, USER, C]);
        expect(await state(forged.rows[0].id)).toMatchObject({ practised_tip: null, tip_session_id: null });
    });

    it('account deletion removes the attempt and its copy', async () => {
        const attempt = await pressPracticeAgain();
        await start(B);
        await save(B);
        await db.query('DELETE FROM auth.users WHERE id = $1', [USER]);
        expect(await state(attempt)).toBeUndefined();
    });

    it('no contract-valid review, or an original already expired, saves no tip', async () => {
        const invalid: unknown[] = [
            null,
            review({ what_worked: '   ' }),
            review({ what_to_try_next: '' }),
            review({ version: 'gemini_coaching_v0' }),
            { ...review(), extra: 'x' },
            { version: 'gemini_coaching_v1', what_to_try_next: TIP },
            review({ what_to_try_next: 42 }),
            'not json',
        ];
        for (const [index, value] of invalid.entries()) {
            await db.exec('TRUNCATE public.progress_recommendation_attempts, public.progress_recommendations, public.session_progress_evaluations, public.sessions CASCADE');
            await seed(A, 60, 6, value);
            const attempt = await accept(await recommendOnA());
            expect({ index, tip: await tipOf(attempt) }).toEqual({ index, tip: null });
        }

        await db.exec('TRUNCATE public.progress_recommendation_attempts, public.progress_recommendations, public.session_progress_evaluations, public.sessions CASCADE');
        await seed(A, 60, 6);
        const rec = await recommendOnA();
        await db.query(`UPDATE public.sessions SET transcript = NULL, transcript_state = 'expired' WHERE id = $1`, [A]);
        expect(await tipOf(await accept(rec))).toBeNull();
    });

    it('a review stored as a JSON string is read the way the app reads it', async () => {
        await seed(A, 60, 6, JSON.stringify(review({ version: 'gemini_coaching_focus_v1' })));
        expect(await tipOf(await accept(await recommendOnA()))).toBe(TIP);
    });

    it("another account's original never supplies a tip, and another account's save never binds or deletes one", async () => {
        await seed(A, 60, 6);
        const rec = await recommendOnA();
        await expect(accept(rec, OTHER)).rejects.toThrow(/recommendation not found for this user/);
        const wrongOwner = await db.query<{ id: string }>(
            'INSERT INTO public.progress_recommendation_attempts (recommendation_id, user_id) VALUES ($1, $2) RETURNING id', [rec, OTHER]);
        expect(await tipOf(wrongOwner.rows[0].id)).toBeNull();

        const attempt = await accept(rec);
        const theirs = sid();
        await start(theirs, { user: OTHER });
        await save(theirs);
        expect(await state(attempt)).toMatchObject({ practised_tip: TIP, tip_session_id: null });
    });

    it('the helper functions are not callable by clients', async () => {
        for (const fn of ['_prec_att_review_tip(jsonb)', '_prec_att_snapshot_tip()', '_prec_att_can_hold_tip(public.progress_recommendation_attempts, uuid)',
            '_prec_att_guard_tip()', '_prec_att_on_session_completed()', '_prec_att_purge_tip_on_expire()']) {
            const grants = await db.query<{ allowed: boolean }>(`SELECT has_function_privilege('authenticated', '${fn}'::regprocedure, 'EXECUTE') AS allowed`);
            expect({ fn, allowed: grants.rows[0].allowed }).toEqual({ fn, allowed: false });
        }
    });
});
