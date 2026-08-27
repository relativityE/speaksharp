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
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz,
    transcript text,
    total_words int, duration int, filler_words jsonb, status text
  );
`;

/** Insert one session with an explicit created_at so ordering is deterministic, not clock-dependent. */
async function seedSession(db: PGlite, userId: string, createdAt: string, transcript: string | null, words: number) {
    const res = await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration, filler_words, status)
         VALUES ($1, $2::timestamptz, $3, $4, 60, '{"um": 2}'::jsonb, 'completed') RETURNING id`,
        [userId, createdAt, transcript, words],
    );
    return res.rows[0].id;
}

async function freshDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(TRANSCRIPT_STATE);
    await db.exec(NEWEST_TWO);
    return db;
}

type Row = { id: string; transcript_state: string; has_text: boolean; total_words: number | null; filler_words: unknown };
const readAll = async (db: PGlite, userId: string) => (await db.query<Row>(
    `SELECT id, transcript_state, (transcript IS NOT NULL) AS has_text, total_words, filler_words
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
        expect(byId[oldest].filler_words).toEqual({ um: 2 });
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
