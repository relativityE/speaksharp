// @vitest-environment node
//
// #1306/#1258 — EXECUTED proof for newest-ONE transcript retention and the decoupled Practice Loop.
//
// The product rule: SpeakSharp keeps the transcript from the user's most recent saved session so they can
// review it alongside the next practice action recommended from it. Saving a newer session replaces the
// retained transcript, while practice metrics and Practice Loop history remain.
//
// The second half is what makes the first half safe. Under newest-two, a recommendation was deleted with
// its source session, an evaluation with its session, and an attempt with its recommendation. Under
// newest-one, session A is removed as soon as B is saved — so the A->B measurement would have deleted
// itself at the exact moment it became meaningful. These tests execute the real migration chain against a
// throwaway PostgreSQL and prove the loop outlives the sessions it describes.
//
// Content-free: synthetic UUIDs and synthetic transcripts only. No hosted environment is touched.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), 'utf8');
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'transcript-retention-bootstrap.sql'), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const sid = (n: number) => `3333333${n}-3333-4333-8333-333333333333`;

async function freshDb() {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(read('20260801000000_sessions_transcript_state.sql'));
    await db.exec(read('20260803000000_transcript_retention_newest_two.sql'));
    // Practice Loop tables, then the newest-one migration that decouples them from session lifetime.
    await db.exec(read('20260731120000_session_progress_evaluations.sql'));
    await db.exec(read('20260731130000_progress_recommendations.sql'));
    await db.exec(read('20260903120000_transcript_retention_newest_one.sql'));
    return db;
}

/** The owner must exist before a session can reference it. */
async function ensureUser(db: PGlite, id: string) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
}

/** Save a transcript-bearing session. `created_at` orders A before B. */
async function saveSession(db: PGlite, id: string, user: string, createdAt: string, transcript: string | null) {
    await ensureUser(db, user);
    await db.query(
        `INSERT INTO public.sessions (id, user_id, created_at, transcript, transcript_state)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, user, createdAt, transcript, transcript === null ? 'not_captured' : 'available'],
    );
}

const rows = async (db: PGlite, sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows as Record<string, unknown>[];

let db: PGlite;
beforeEach(async () => { db = await freshDb(); });

describe('#1306 newest-ONE retention — B replaces A', () => {
    it('CASUALTY: after saving B, only B keeps a transcript', async () => {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'session A words');
        await saveSession(db, sid(2), USER, '2026-09-02T10:00:00Z', 'session B words');

        await db.query('SELECT public.expire_transcripts_newest_one($1, $2)', [USER, 500]);

        const r = await rows(db, 'SELECT id, transcript, transcript_state FROM public.sessions ORDER BY created_at');
        expect(r[0].transcript, "A's transcript must be removed").toBeNull();
        expect(r[0].transcript_state).toBe('expired');
        expect(r[1].transcript, "B's transcript is the retained one").toBe('session B words');
        expect(r[1].transcript_state).toBe('available');
    });

    it('the session ROWS both survive — only transcript text is removed', async () => {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'A');
        await saveSession(db, sid(2), USER, '2026-09-02T10:00:00Z', 'B');
        await db.query('SELECT public.expire_transcripts_newest_one($1, $2)', [USER, 500]);
        expect(await rows(db, 'SELECT id FROM public.sessions')).toHaveLength(2);
    });

    it('CASUALTY: a BLANK save never displaces a real transcript', async () => {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'real words');
        await saveSession(db, sid(2), USER, '2026-09-02T10:00:00Z', '   ');
        await db.query('SELECT public.expire_transcripts_newest_one($1, $2)', [USER, 500]);
        const r = await rows(db, 'SELECT transcript FROM public.sessions ORDER BY created_at');
        expect(r[0].transcript, 'a blank newer save must not expire the real one').toBe('real words');
    });

    it('retention is per user — another owner is untouched', async () => {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'mine A');
        await saveSession(db, sid(2), USER, '2026-09-02T10:00:00Z', 'mine B');
        await saveSession(db, sid(3), OTHER, '2026-09-01T10:00:00Z', 'theirs');
        await db.query('SELECT public.expire_transcripts_newest_one($1, $2)', [USER, 500]);
        const theirs = await rows(db, 'SELECT transcript FROM public.sessions WHERE user_id = $1', [OTHER]);
        expect(theirs[0].transcript).toBe('theirs');
    });

    it('reports the newest_one policy version and terminates', async () => {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'A');
        await saveSession(db, sid(2), USER, '2026-09-02T10:00:00Z', 'B');
        const first = (await rows(db, 'SELECT public.expire_transcripts_newest_one($1,$2) AS r', [USER, 500]))[0]
            .r as { policy_version: string; expired_count: number; has_more: boolean };
        expect(first.policy_version).toBe('newest_one_v1');
        expect(first.expired_count).toBe(1);
        expect(first.has_more).toBe(false);
    });

    it('CASUALTY: repeated runs are idempotent — never two retained, never a duplicate expiry', async () => {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'A');
        await saveSession(db, sid(2), USER, '2026-09-02T10:00:00Z', 'B');
        await db.query('SELECT public.expire_transcripts_newest_one($1,$2)', [USER, 500]);
        const second = (await rows(db, 'SELECT public.expire_transcripts_newest_one($1,$2) AS r', [USER, 500]))[0]
            .r as { expired_count: number };
        expect(second.expired_count, 'a retry must not expire anything again').toBe(0);
        const available = await rows(db,
            "SELECT id FROM public.sessions WHERE transcript_state = 'available'");
        expect(available, 'exactly one retained transcript, however many times this runs').toHaveLength(1);
    });
});

describe('#1258 the Practice Loop survives the sessions it describes', () => {
    /** A's observation and prescription, the user's acceptance, and the A->B outcome. */
    async function seedLoop(db: PGlite) {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'A words');
        await saveSession(db, sid(2), USER, '2026-09-02T10:00:00Z', 'B words');
        await db.query(
            `INSERT INTO public.progress_recommendations
               (id, user_id, source_session_id, formula_version, target_metric, target_direction,
                target_value, target_units, source_metric_value, shown_text)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            ['44444444-4444-4444-8444-444444444444', USER, sid(1), 'v1',
             'filler_rate', 'decrease', 8.0, 'per_100_words', 12.5,
             'Try pausing instead of filling the gap.'],
        );
        await db.query(
            `INSERT INTO public.progress_recommendation_attempts (id, recommendation_id, user_id, practice_session_id, next_comparable_session_id)
             VALUES ($1,$2,$3,$4,$5)`,
            ['55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', USER, sid(1), sid(2)],
        );
    }

    it('CASUALTY: deleting A does NOT delete its recommendation', async () => {
        // Under the old cascade this row vanished with its source session — taking the measurement with it.
        await seedLoop(db);
        await db.query('DELETE FROM public.sessions WHERE id = $1', [sid(1)]);
        const recs = await rows(db, 'SELECT id, source_session_id FROM public.progress_recommendations');
        expect(recs, "A's recommendation must survive A").toHaveLength(1);
        expect(recs[0].source_session_id, 'provenance becomes unknown, not fatal').toBeNull();
    });

    it('CASUALTY: deleting A does NOT delete the accepted attempt or its outcome link', async () => {
        await seedLoop(db);
        await db.query('DELETE FROM public.sessions WHERE id = $1', [sid(1)]);
        const attempts = await rows(db,
            'SELECT id, recommendation_id, next_comparable_session_id FROM public.progress_recommendation_attempts');
        expect(attempts).toHaveLength(1);
        expect(attempts[0].recommendation_id, 'the loop still points at its prescription').toBeTruthy();
        expect(attempts[0].next_comparable_session_id, 'the A->B link to B survives').toBe(sid(2));
    });

    it('CASUALTY: deleting the RECOMMENDATION does not delete the attempt', async () => {
        await seedLoop(db);
        await db.query('DELETE FROM public.progress_recommendations WHERE id = $1',
            ['44444444-4444-4444-8444-444444444444']);
        const attempts = await rows(db, 'SELECT id, recommendation_id FROM public.progress_recommendation_attempts');
        expect(attempts, 'the outcome is the measurement and must not be erased').toHaveLength(1);
        expect(attempts[0].recommendation_id).toBeNull();
    });

    it('CASUALTY: an evaluation survives the deletion of its session', async () => {
        await saveSession(db, sid(1), USER, '2026-09-01T10:00:00Z', 'A');
        await db.query(
            `INSERT INTO public.session_progress_evaluations
               (id, user_id, session_id, formula_version, duration_seconds, word_count,
                clarity_evidence_available, eligible, exclusion_reasons)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            // eligible=false: this test is about the CASCADE, and an eligible row additionally requires a
            // full verified-attribution payload that is irrelevant here.
            ['66666666-6666-4666-8666-666666666666', USER, sid(1), 'v1', 120, 300, false, false,
             ['no_clarity_evidence']],
        );
        await db.query('DELETE FROM public.sessions WHERE id = $1', [sid(1)]);
        const evals = await rows(db, 'SELECT id, session_id FROM public.session_progress_evaluations');
        expect(evals).toHaveLength(1);
        expect(evals[0].session_id).toBeNull();
    });

    it('the full journey: A saves, B replaces its transcript, and the A->B evidence remains', async () => {
        await seedLoop(db);
        await db.query('SELECT public.expire_transcripts_newest_one($1,$2)', [USER, 500]);

        // B is the only retained transcript...
        const avail = await rows(db,
            "SELECT id FROM public.sessions WHERE transcript_state = 'available'");
        expect(avail).toHaveLength(1);
        expect(avail[0].id).toBe(sid(2));

        // ...and the loop that measured A -> B is intact.
        expect(await rows(db, 'SELECT id FROM public.progress_recommendations')).toHaveLength(1);
        expect(await rows(db, 'SELECT id FROM public.progress_recommendation_attempts')).toHaveLength(1);
    });
});
