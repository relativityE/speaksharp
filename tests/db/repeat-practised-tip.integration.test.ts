// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Outcome 4 step 2 (D2): the coaching tip a repeat practised is snapshotted onto its attempt when Practice again is
 * pressed, survives the repeat's save (which expires the original and nulls its review), and is then cleared with the
 * repeat's own retention. Real PostgreSQL (PGlite) over the Progress, retention-purge and new migrations, verbatim.
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

/** Evaluations for the given sessions and a recommendation on A, as the app does after A's save. */
async function recommendOnA(): Promise<string> {
    for (const id of [A, B, C]) {
        const exists = (await db.query('SELECT 1 FROM public.sessions WHERE id = $1', [id])).rows.length > 0;
        if (exists) await rpc(USER, 'SELECT public.record_progress_evaluation($1) AS v', [id]);
    }
    return rpc<string>(USER, `SELECT public.record_progress_recommendation($1, 'filler_rate', 'decrease', 3, 'percent', 'Cut fillers') AS v`, [A]);
}

const accept = (rec: string, user = USER) => rpc<string>(user, 'SELECT public.record_recommendation_attempt($1) AS v', [rec]);
const tipOf = async (attempt: string) =>
    (await db.query<{ practised_tip: string | null }>('SELECT practised_tip FROM public.progress_recommendation_attempts WHERE id = $1', [attempt])).rows[0]?.practised_tip;
/** What newest-one retention does to an older session when a newer one saves. */
const expire = (id: string) => db.query(`UPDATE public.sessions SET transcript = NULL, transcript_state = 'expired' WHERE id = $1`, [id]);

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

describe('outcome 4 D2: the practised tip moves with the repeat', () => {
    it('pressing Practice again snapshots the original tip; the repeat save that expires the original keeps it; the repeat reads it', async () => {
        await seed(A, 60, 6);
        await seed(B, 0, 3, review({ what_to_try_next: 'A different, newer tip.' }));
        const rec = await recommendOnA();
        const attempt = await accept(rec);
        expect(await tipOf(attempt)).toBe(TIP);

        // B's save: retention expires A, and the existing purge nulls A's review in the same save.
        await expire(A);
        const original = await db.query<{ ai_suggestions: unknown }>('SELECT ai_suggestions FROM public.sessions WHERE id = $1', [A]);
        expect(original.rows[0].ai_suggestions).toBeNull();
        expect(await tipOf(attempt)).toBe(TIP);

        // The non-blocking advance after the save binds B.
        expect(await rpc(USER, `SELECT public.advance_recommendation_attempt($1, 'completed', $2, $2) AS v`, [attempt, B])).toBe('moved');
        expect(await tipOf(attempt)).toBe(TIP);

        // The owner reads it on their own attempt (the existing RLS select); another account sees no row.
        const own = await asUser(USER, (tx) => tx.query<{ practised_tip: string }>(
            'SELECT practised_tip FROM public.progress_recommendation_attempts WHERE practice_session_id = $1', [B]));
        expect(own.rows).toEqual([{ practised_tip: TIP }]);
        const other = await asUser(OTHER, (tx) => tx.query('SELECT practised_tip FROM public.progress_recommendation_attempts', []));
        expect(other.rows).toEqual([]);
    });

    it("the tip is cleared with the repeat's own retention, when a newer session expires the repeat", async () => {
        await seed(A, 60, 6);
        await seed(B, 30, 3);
        const attempt = await accept(await recommendOnA());
        await expire(A);
        await rpc(USER, `SELECT public.advance_recommendation_attempt($1, 'not_comparable', $2) AS v`, [attempt, B]);
        expect(await tipOf(attempt)).toBe(TIP);
        await seed(C, 0, 2);
        await expire(B);
        expect(await tipOf(attempt)).toBeNull();
    });

    it('an abandoned attempt keeps no tip', async () => {
        await seed(A, 60, 6);
        const attempt = await accept(await recommendOnA());
        await rpc(USER, `SELECT public.advance_recommendation_attempt($1, 'abandoned') AS v`, [attempt]);
        expect(await tipOf(attempt)).toBeNull();
    });

    it('a pending attempt keeps the tip for one save past its original, then loses it if it never resolved', async () => {
        await seed(A, 90, 6);
        await seed(B, 60, 3);
        await seed(C, 30, 2);
        const attempt = await accept(await recommendOnA());
        // An older session expiring changes nothing.
        await db.query(`INSERT INTO public.sessions (id, user_id, created_at, transcript_state) VALUES
            ('aaaaaaaa-0000-4000-8000-000000000000', $1, now() - interval '1 day', 'available')`, [USER]);
        await expire('aaaaaaaa-0000-4000-8000-000000000000');
        expect(await tipOf(attempt)).toBe(TIP);
        // The save that expires A is the one that resolves the attempt: kept.
        await expire(A);
        expect(await tipOf(attempt)).toBe(TIP);
        // A further save expires B while the attempt is still pending: cleared.
        await expire(B);
        expect(await tipOf(attempt)).toBeNull();
    });

    it('deleting the repeat clears the tip, and deleting the account removes the attempt', async () => {
        await seed(A, 60, 6);
        await seed(B, 0, 3);
        const attempt = await accept(await recommendOnA());
        await rpc(USER, `SELECT public.advance_recommendation_attempt($1, 'completed', $2, $2) AS v`, [attempt, B]);
        await db.query('DELETE FROM public.session_progress_evaluations WHERE session_id = $1', [B]);
        await db.query('DELETE FROM public.sessions WHERE id = $1', [B]);
        expect(await tipOf(attempt)).toBeNull();

        const again = await accept((await db.query<{ id: string }>('SELECT id FROM public.progress_recommendations')).rows[0].id);
        expect(await tipOf(again)).toBe(TIP);
        await db.query('DELETE FROM auth.users WHERE id = $1', [USER]);
        expect(await tipOf(again)).toBeUndefined();
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
            expect(await tipOf(attempt), `case ${index}`).toBeNull();
        }

        await db.exec('TRUNCATE public.progress_recommendation_attempts, public.progress_recommendations, public.session_progress_evaluations, public.sessions CASCADE');
        await seed(A, 60, 6);
        const rec = await recommendOnA();
        await expire(A);
        expect(await tipOf(await accept(rec))).toBeNull();
    });

    it('a review stored as a JSON string is read the way the app reads it', async () => {
        await seed(A, 60, 6, JSON.stringify(review({ version: 'gemini_coaching_focus_v1' })));
        expect(await tipOf(await accept(await recommendOnA()))).toBe(TIP);
    });

    it('nobody can set or change the tip after it is recorded; a supplied value is replaced by the snapshot', async () => {
        await seed(A, 60, 6);
        const rec = await recommendOnA();
        const attempt = await accept(rec);
        await expect(db.query(`UPDATE public.progress_recommendation_attempts SET practised_tip = 'forged' WHERE id = $1`, [attempt]))
            .rejects.toThrow(/practised_tip is set only when the attempt is recorded/);
        await expect(asUser(USER, (tx) => tx.query(`UPDATE public.progress_recommendation_attempts SET practised_tip = NULL WHERE id = $1`, [attempt])))
            .rejects.toThrow(/permission denied/);
        expect(await tipOf(attempt)).toBe(TIP);

        const forged = await db.query<{ id: string }>(
            `INSERT INTO public.progress_recommendation_attempts (recommendation_id, user_id, practised_tip) VALUES ($1, $2, 'forged') RETURNING id`,
            [rec, USER]);
        expect(await tipOf(forged.rows[0].id)).toBe(TIP);
    });

    it("another account's original never supplies a tip", async () => {
        await seed(A, 60, 6);
        const rec = await recommendOnA();
        await expect(accept(rec, OTHER)).rejects.toThrow(/recommendation not found for this user/);
        // Even a direct insert naming the wrong owner snapshots nothing.
        const row = await db.query<{ id: string }>(
            'INSERT INTO public.progress_recommendation_attempts (recommendation_id, user_id) VALUES ($1, $2) RETURNING id', [rec, OTHER]);
        expect(await tipOf(row.rows[0].id)).toBeNull();
    });

    it('the helper functions are not callable by clients', async () => {
        for (const fn of ['_prec_att_review_tip(jsonb)', '_prec_att_snapshot_tip()', '_prec_att_guard_tip()', '_prec_att_purge_tip_on_expire()']) {
            const grants = await db.query<{ allowed: boolean }>(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS allowed`);
            expect({ fn, allowed: grants.rows[0].allowed }).toEqual({ fn, allowed: false });
        }
    });
});
