// @vitest-environment node
//
// #1117 R1 — EXECUTED proof for the newest-two transcript-retention SQL contract
// (migration 20260803000000_transcript_retention_newest_two.sql, built on #1131's 20260801000000).
//
// A static SQL-string test cannot catch a syntax error, a wrong window function, a trigger interaction or a
// leaked grant. This suite stands up a REAL, throwaway PostgreSQL (PGlite — already the repo DB harness),
// applies the #1131 migration and THEN the R1 migration VERBATIM from disk, seeds synthetic fixtures, and
// EXECUTES the functions. Nothing here touches any hosted environment; each test gets its own in-memory DB.
//
// Content-free: synthetic UUIDs and synthetic transcripts only. No production query, apply or scrub.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const BOOTSTRAP_SQL = readFileSync(resolve(process.cwd(), 'tests', 'db', 'transcript-retention-bootstrap.sql'), 'utf8');
const M1131_SQL = readFileSync(resolve(MIGRATIONS, '20260801000000_sessions_transcript_state.sql'), 'utf8');
const R1_SQL = readFileSync(resolve(MIGRATIONS, '20260803000000_transcript_retention_newest_two.sql'), 'utf8');

const MUT_SIG = 'public.expire_transcripts_newest_two(uuid, integer, integer)';
const PRED_SIG = 'public.transcript_sessions_to_expire(uuid)';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
// Deterministic session ids: larger k => lexically/uuid-greater id (drives the id DESC tie-break).
const sid = (k: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(k).padStart(12, '0')}`;
const at = (iso: string) => new Date(iso).toISOString();

async function freshDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP_SQL);
    await db.exec(M1131_SQL);   // #1131 — the foundation (transcript_state + derivation trigger + CHECKs)
    await db.exec(R1_SQL);      // #1117 R1 — the artifact under test
    return db;
}

async function addUser(db: PGlite, id: string) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
}

interface SessionOpts {
    id: string; user_id: string; created_at: string;
    transcript?: string | null; duration?: number; total_words?: number;
    clarity_score?: number; wpm?: number; accuracy?: number; filler?: string;
    engine?: string; title?: string;
}
// Normal insert: #1131's derivation trigger sets transcript_state from the transcript (available / not_captured).
async function addSession(db: PGlite, o: SessionOpts) {
    await db.query(
        `INSERT INTO public.sessions
           (id, user_id, created_at, transcript, duration, total_words, clarity_score, wpm, accuracy, filler_words, engine, title)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [o.id, o.user_id, at(o.created_at), o.transcript ?? null,
         o.duration ?? 60, o.total_words ?? 100, o.clarity_score ?? 80, o.wpm ?? 100, o.accuracy ?? 0.9,
         o.filler ?? '{"um":{"count":2}}', o.engine ?? 'private-v2', o.title ?? 'Freestyle'],
    );
}
// Trigger-bypassing insert: forces a raw (possibly contradictory) row for negative controls.
async function addRawSession(db: PGlite, id: string, user_id: string, created_at: string, transcript: string | null, state: string) {
    await db.exec(`SET session_replication_role = 'replica'`);
    await db.query(
        `INSERT INTO public.sessions (id, user_id, created_at, transcript, transcript_state)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, user_id, at(created_at), transcript, state],
    );
    await db.exec(`SET session_replication_role = 'origin'`);
}

async function rows(db: PGlite, user_id: string) {
    const r = await db.query<{ id: string; transcript: string | null; transcript_state: string }>(
        `SELECT id, transcript, transcript_state FROM public.sessions WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
        [user_id],
    );
    return r.rows;
}
async function callMutation(db: PGlite, p_user_id: string | null, batch = 500) {
    const r = await db.query<{ result: Record<string, unknown> }>(
        `SELECT public.expire_transcripts_newest_two($1, $2, $3) AS result`, [p_user_id, batch, 100000],
    );
    return r.rows[0].result;
}
async function funcPriv(db: PGlite, role: string, sig: string) {
    const r = await db.query<{ ok: boolean }>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig]);
    return r.rows[0].ok;
}

// ---------------------------------------------------------------------------------------------------------

describe('#1117 R1 — versioned predicate + policy', () => {
    it('policy version marker is the shared newest_two_v1 string', async () => {
        const db = await freshDb();
        const r = await db.query<{ v: string }>(`SELECT public.transcript_retention_policy_version() AS v`);
        expect(r.rows[0].v).toBe('newest_two_v1');
    });

    it('predicate returns exactly the transcript-bearing rows ranked > 2, newest-two never returned', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        // 4 transcript-bearing, newest first by created_at.
        await addSession(db, { id: sid(4), user_id: USER_A, created_at: '2026-07-04T10:00:00Z', transcript: 't4' });
        await addSession(db, { id: sid(3), user_id: USER_A, created_at: '2026-07-03T10:00:00Z', transcript: 't3' });
        await addSession(db, { id: sid(2), user_id: USER_A, created_at: '2026-07-02T10:00:00Z', transcript: 't2' });
        await addSession(db, { id: sid(1), user_id: USER_A, created_at: '2026-07-01T10:00:00Z', transcript: 't1' });
        const r = await db.query<{ session_id: string }>(
            `SELECT session_id FROM public.transcript_sessions_to_expire($1) ORDER BY session_id`, [USER_A]);
        // ranks 3 & 4 (the two OLDEST) => sid(2), sid(1). Newest-two (sid4, sid3) never listed.
        expect(r.rows.map(x => x.session_id).sort()).toEqual([sid(1), sid(2)].sort());
    });
});

describe('#1117 R1 — per-user counts across the 0/1/2/3/many matrix', () => {
    it('0 transcript-bearing sessions: nothing expired, states untouched', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addSession(db, { id: sid(1), user_id: USER_A, created_at: '2026-07-01T10:00:00Z', transcript: null });
        await addSession(db, { id: sid(2), user_id: USER_A, created_at: '2026-07-02T10:00:00Z', transcript: '   ' }); // whitespace => not_captured
        const res = await callMutation(db, USER_A);
        expect(res.expired_count).toBe(0);
        expect((await rows(db, USER_A)).every(x => x.transcript_state === 'not_captured')).toBe(true);
    });

    it.each([[1, 0], [2, 0], [3, 1], [7, 5]])('%i transcript-bearing => %i expired, exactly 2 retained', async (n, expExpired) => {
        const db = await freshDb();
        await addUser(db, USER_A);
        for (let k = 1; k <= n; k++) {
            await addSession(db, { id: sid(k), user_id: USER_A, created_at: `2026-07-${String(k).padStart(2, '0')}T10:00:00Z`, transcript: `t${k}` });
        }
        const res = await callMutation(db, USER_A);
        expect(res.expired_count).toBe(expExpired);
        const rs = await rows(db, USER_A);
        const available = rs.filter(x => x.transcript_state === 'available');
        const expired = rs.filter(x => x.transcript_state === 'expired');
        expect(available.length).toBe(Math.min(n, 2));
        expect(expired.length).toBe(expExpired);
        // Retained are the NEWEST two; every expired row has NULL transcript.
        expect(available.every(x => x.transcript !== null)).toBe(true);
        expect(expired.every(x => x.transcript === null)).toBe(true);
        // Retained are the newest min(n,2): [sid(n)] for n===1, else [sid(n), sid(n-1)].
        const expectedRetained = (n >= 2 ? [sid(n), sid(n - 1)] : [sid(n)]).sort();
        expect(available.map(x => x.id).sort()).toEqual(expectedRetained);
    });
});

describe('#1117 R1 — global pool, ties, boundary', () => {
    it('mixed Freestyle/Guided rank in ONE global pool (no partition by mode)', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addSession(db, { id: sid(4), user_id: USER_A, created_at: '2026-07-04T10:00:00Z', transcript: 'g-newest', title: 'Guided', engine: 'guided-v1' });
        await addSession(db, { id: sid(3), user_id: USER_A, created_at: '2026-07-03T10:00:00Z', transcript: 'f-second', title: 'Freestyle', engine: 'private-v2' });
        await addSession(db, { id: sid(2), user_id: USER_A, created_at: '2026-07-02T10:00:00Z', transcript: 'g-third', title: 'Guided', engine: 'guided-v1' });
        await addSession(db, { id: sid(1), user_id: USER_A, created_at: '2026-07-01T10:00:00Z', transcript: 'f-oldest', title: 'Freestyle', engine: 'private-v2' });
        await callMutation(db, USER_A);
        const rs = await rows(db, USER_A);
        const available = rs.filter(x => x.transcript_state === 'available').map(x => x.id).sort();
        // Newest two overall are the Guided(sid4) + Freestyle(sid3) — mode is irrelevant to ranking.
        expect(available).toEqual([sid(4), sid(3)].sort());
    });

    it('tie on created_at is resolved by id DESC (higher id ranks newer)', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        const tie = '2026-07-05T10:00:00Z';
        await addSession(db, { id: sid(12), user_id: USER_A, created_at: tie, transcript: 'tie-hi' });
        await addSession(db, { id: sid(11), user_id: USER_A, created_at: tie, transcript: 'tie-mid' });
        await addSession(db, { id: sid(10), user_id: USER_A, created_at: tie, transcript: 'tie-lo' });
        await callMutation(db, USER_A);
        const rs = await rows(db, USER_A);
        // id DESC: 12(r1), 11(r2), 10(r3) -> 10 expired.
        expect(rs.find(x => x.id === sid(12))!.transcript_state).toBe('available');
        expect(rs.find(x => x.id === sid(11))!.transcript_state).toBe('available');
        expect(rs.find(x => x.id === sid(10))!.transcript_state).toBe('expired');
        expect(rs.find(x => x.id === sid(10))!.transcript).toBeNull();
    });

    it('exact rank-2 / rank-3 boundary: rank 2 retained, rank 3 expired', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addSession(db, { id: sid(3), user_id: USER_A, created_at: '2026-07-03T10:00:00Z', transcript: 'r1' });
        await addSession(db, { id: sid(2), user_id: USER_A, created_at: '2026-07-02T10:00:00Z', transcript: 'r2-KEEP' });
        await addSession(db, { id: sid(1), user_id: USER_A, created_at: '2026-07-01T10:00:00Z', transcript: 'r3-EXPIRE' });
        await callMutation(db, USER_A);
        const rs = await rows(db, USER_A);
        expect(rs.find(x => x.id === sid(2))!.transcript_state).toBe('available'); // rank 2 kept
        expect(rs.find(x => x.id === sid(1))!.transcript_state).toBe('expired');   // rank 3 expired
    });
});

describe('#1117 R1 — state coherence, empty strings, contradictions', () => {
    it('not_captured is never relabeled expired and never ranked', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        // 3 real transcripts + 2 not_captured (null + empty). Only the oldest REAL one should expire.
        await addSession(db, { id: sid(5), user_id: USER_A, created_at: '2026-07-05T10:00:00Z', transcript: 'real-a' });
        await addSession(db, { id: sid(4), user_id: USER_A, created_at: '2026-07-04T10:00:00Z', transcript: 'real-b' });
        await addSession(db, { id: sid(3), user_id: USER_A, created_at: '2026-07-03T10:00:00Z', transcript: 'real-c' });
        await addSession(db, { id: sid(2), user_id: USER_A, created_at: '2026-07-02T10:00:00Z', transcript: null });   // not_captured
        await addSession(db, { id: sid(1), user_id: USER_A, created_at: '2026-07-01T10:00:00Z', transcript: '' });     // empty => not_captured, NOT expired
        const res = await callMutation(db, USER_A);
        expect(res.expired_count).toBe(1); // only sid(3), the 3rd-newest REAL transcript
        const rs = await rows(db, USER_A);
        expect(rs.find(x => x.id === sid(3))!.transcript_state).toBe('expired');
        expect(rs.find(x => x.id === sid(2))!.transcript_state).toBe('not_captured');
        expect(rs.find(x => x.id === sid(1))!.transcript_state).toBe('not_captured'); // empty stays not_captured
    });

    it('fails closed on an available-without-text contradiction', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addRawSession(db, sid(1), USER_A, '2026-07-01T10:00:00Z', null, 'available'); // contradiction
        await expect(callMutation(db, USER_A)).rejects.toThrow(/invariant violations/i);
    });

    it('fails closed on a not_captured-with-real-text contradiction', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addRawSession(db, sid(1), USER_A, '2026-07-01T10:00:00Z', 'real text', 'not_captured'); // contradiction
        await expect(callMutation(db, USER_A)).rejects.toThrow(/invariant violations/i);
    });

    it('#1131 CHECK makes expired-with-text impossible even under a raw insert', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await expect(addRawSession(db, sid(1), USER_A, '2026-07-01T10:00:00Z', 'text', 'expired'))
            .rejects.toThrow(); // sessions_expired_transcript_null_check
    });
});

describe('#1117 R1 — idempotency and bounded/interrupted batches', () => {
    it('a second identical run changes nothing (idempotent)', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        for (let k = 1; k <= 5; k++) await addSession(db, { id: sid(k), user_id: USER_A, created_at: `2026-07-0${k}T10:00:00Z`, transcript: `t${k}` });
        const first = await callMutation(db, USER_A);
        expect(first.expired_count).toBe(3);
        const second = await callMutation(db, USER_A);
        expect(second.expired_count).toBe(0);
        expect(second.batches_executed).toBe(0);
    });

    it('tiny batches converge to newest-two and stay retry-safe', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        for (let k = 1; k <= 7; k++) await addSession(db, { id: sid(k), user_id: USER_A, created_at: `2026-07-0${k}T10:00:00Z`, transcript: `t${k}` });
        const res = await callMutation(db, USER_A, 1); // one row per batch
        expect(res.expired_count).toBe(5);
        expect(res.batches_executed).toBe(5);
        const rs = await rows(db, USER_A);
        expect(rs.filter(x => x.transcript_state === 'available').length).toBe(2);
        // retry after "interruption": already-expired excluded, no further change.
        expect((await callMutation(db, USER_A, 1)).expired_count).toBe(0);
    });

    it('rejects out-of-bounds batch size (fail closed)', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await expect(callMutation(db, USER_A, 0)).rejects.toThrow(/p_batch_size/i);
        await expect(callMutation(db, USER_A, 99999)).rejects.toThrow(/p_batch_size/i);
    });
});

describe('#1117 R1 — privilege boundary and cross-user isolation', () => {
    it('mutation EXECUTE is revoked from PUBLIC/anon/authenticated, granted to service_role only', async () => {
        const db = await freshDb();
        expect(await funcPriv(db, 'service_role', MUT_SIG)).toBe(true);
        expect(await funcPriv(db, 'authenticated', MUT_SIG)).toBe(false);
        expect(await funcPriv(db, 'anon', MUT_SIG)).toBe(false);
        // The shared predicate is likewise not client-executable.
        expect(await funcPriv(db, 'authenticated', PRED_SIG)).toBe(false);
        expect(await funcPriv(db, 'service_role', PRED_SIG)).toBe(true);
    });

    it('a normal (client-style) UPDATE cannot self-assert expired — only the function path can', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addSession(db, { id: sid(1), user_id: USER_A, created_at: '2026-07-01T10:00:00Z', transcript: 'keep' });
        await db.query(`UPDATE public.sessions SET transcript = NULL, transcript_state = 'expired' WHERE id = $1`, [sid(1)]);
        const rs = await rows(db, USER_A);
        // #1131 derivation trigger overrides the client's 'expired' -> 'not_captured' (never expired).
        expect(rs[0].transcript_state).toBe('not_captured');
    });

    it('single-user scope touches only that user; other users are untouched', async () => {
        const db = await freshDb();
        await addUser(db, USER_A); await addUser(db, USER_B);
        for (let k = 1; k <= 3; k++) {
            await addSession(db, { id: sid(100 + k), user_id: USER_A, created_at: `2026-07-0${k}T10:00:00Z`, transcript: `a${k}` });
            await addSession(db, { id: sid(200 + k), user_id: USER_B, created_at: `2026-07-0${k}T10:00:00Z`, transcript: `b${k}` });
        }
        await callMutation(db, USER_A);
        expect((await rows(db, USER_A)).filter(x => x.transcript_state === 'expired').length).toBe(1);
        // USER_B fully intact.
        expect((await rows(db, USER_B)).filter(x => x.transcript_state === 'available').length).toBe(3);
        expect((await rows(db, USER_B)).some(x => x.transcript_state === 'expired')).toBe(false);
    });

    it('all-users scope expires each user down to their own newest-two', async () => {
        const db = await freshDb();
        await addUser(db, USER_A); await addUser(db, USER_B);
        for (let k = 1; k <= 4; k++) await addSession(db, { id: sid(300 + k), user_id: USER_A, created_at: `2026-07-0${k}T10:00:00Z`, transcript: `a${k}` });
        for (let k = 1; k <= 3; k++) await addSession(db, { id: sid(400 + k), user_id: USER_B, created_at: `2026-07-0${k}T10:00:00Z`, transcript: `b${k}` });
        const res = await callMutation(db, null); // all users
        expect(res.scope).toBe('all_users');
        expect(res.expired_count).toBe(3); // 2 from A + 1 from B
        expect((await rows(db, USER_A)).filter(x => x.transcript_state === 'available').length).toBe(2);
        expect((await rows(db, USER_B)).filter(x => x.transcript_state === 'available').length).toBe(2);
    });
});

describe('#1117 R1 — preservation & content-free evidence', () => {
    it('measurements/relationships preserved; only transcript+state change; no rows deleted', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addSession(db, { id: sid(3), user_id: USER_A, created_at: '2026-07-03T10:00:00Z', transcript: 'keep1' });
        await addSession(db, { id: sid(2), user_id: USER_A, created_at: '2026-07-02T10:00:00Z', transcript: 'keep2' });
        await addSession(db, { id: sid(1), user_id: USER_A, created_at: '2026-07-01T10:00:00Z', transcript: 'gone', duration: 123, total_words: 456, clarity_score: 78, wpm: 99, accuracy: 0.88, filler: '{"uh":{"count":3}}' });
        const before = await db.query(`SELECT count(*)::int n FROM public.sessions`);
        await callMutation(db, USER_A);
        const after = await db.query(`SELECT count(*)::int n FROM public.sessions`);
        expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n); // no deletion

        const expired = await db.query<{ transcript: string | null; transcript_state: string; duration: number; total_words: number; clarity_score: number; wpm: number; accuracy: number; filler_words: unknown }>(
            `SELECT transcript, transcript_state, duration, total_words, clarity_score, wpm, accuracy, filler_words FROM public.sessions WHERE id = $1`, [sid(1)]);
        const e = expired.rows[0];
        expect(e.transcript).toBeNull();
        expect(e.transcript_state).toBe('expired');
        // Every content-free measurement is preserved verbatim.
        expect(e.duration).toBe(123);
        expect(e.total_words).toBe(456);
        expect(e.clarity_score).toBe(78);
        expect(e.wpm).toBe(99);
        expect(Math.round(e.accuracy * 100) / 100).toBe(0.88);
        expect(e.filler_words).toEqual({ uh: { count: 3 } });
    });

    it('the mutation result is aggregate-only and carries no transcript text', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        const SECRET = 'zzz-unique-transcript-marker-should-never-surface';
        for (let k = 1; k <= 3; k++) await addSession(db, { id: sid(k), user_id: USER_A, created_at: `2026-07-0${k}T10:00:00Z`, transcript: k === 1 ? SECRET : `t${k}` });
        const res = await callMutation(db, USER_A);
        expect(Object.keys(res).sort()).toEqual(['batches_executed', 'expired_count', 'policy_version', 'scope']);
        expect(res.policy_version).toBe('newest_two_v1');
        expect(JSON.stringify(res)).not.toContain(SECRET);
    });
});
