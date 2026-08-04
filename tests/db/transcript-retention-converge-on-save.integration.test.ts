// @vitest-environment node
//
// #1117 R2 — EXECUTED proof for the evidence-gated retention COORDINATOR
// (migration 20260804000000, Option A) on a real PostgreSQL (PGlite). Applies #1131 + merged R1 + R2
// verbatim, then exercises converge_transcript_retention and the auto-convergence trigger.
//
// This suite covers the DETERMINISTIC coordinator behaviour. The true two-connection same-user CONCURRENCY
// proof is a separate real-PostgreSQL harness (PGlite is single-connection). Content-free: synthetic only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'transcript-retention-converge-bootstrap.sql'), 'utf8');
const M1131 = readFileSync(resolve(M, '20260801000000_sessions_transcript_state.sql'), 'utf8');
const R1 = readFileSync(resolve(M, '20260803000000_transcript_retention_newest_two.sql'), 'utf8');
const R2 = readFileSync(resolve(M, '20260804000000_transcript_retention_converge_on_save.sql'), 'utf8');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const sid = (k: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(k).padStart(12, '0')}`;

async function freshDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(M1131);
    await db.exec(R1);
    await db.exec(R2);
    return db;
}
async function addUser(db: PGlite, id: string) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    await db.query('INSERT INTO public.user_profiles (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
}
async function addSession(db: PGlite, id: string, user_id: string, dayN: number, transcript: string | null) {
    await db.query(
        `INSERT INTO public.sessions (id, user_id, created_at, transcript, total_words, duration)
         VALUES ($1,$2,$3,$4,100,60)`,
        [id, user_id, new Date(`2026-07-${String(dayN).padStart(2, '0')}T10:00:00Z`).toISOString(), transcript]);
}
// Simulate a persisted Progress evaluation (what record_progress_evaluation would write). Firing the INSERT
// exercises the AFTER-INSERT auto-convergence trigger for terminal rows.
async function addEval(db: PGlite, user_id: string, session_id: string, attribution_status: string, eligible: boolean, formula = 'clarity_v1') {
    await db.query(
        `INSERT INTO public.session_progress_evaluations (user_id, session_id, formula_version, attribution_status, eligible)
         VALUES ($1,$2,$3,$4,$5)`,
        [user_id, session_id, formula, attribution_status, eligible]);
}
async function converge(db: PGlite, user_id: string) {
    const r = await db.query<{ r: Record<string, unknown> }>(`SELECT public.converge_transcript_retention($1) AS r`, [user_id]);
    return r.rows[0].r;
}
async function states(db: PGlite, user_id: string) {
    const r = await db.query<{ id: string; transcript_state: string; transcript: string | null }>(
        `SELECT id, transcript_state, transcript FROM public.sessions WHERE user_id=$1 ORDER BY created_at DESC, id DESC`, [user_id]);
    return r.rows;
}
const avail = (rs: { transcript_state: string }[]) => rs.filter(x => x.transcript_state === 'available').length;
const expired = (rs: { transcript_state: string }[]) => rs.filter(x => x.transcript_state === 'expired').length;

// 3 transcript-bearing sessions => exactly ONE outgoing candidate (base+1, the oldest / rank 3).
// `base` offsets session ids so multiple users get distinct PKs.
async function seed3(db: PGlite, user: string, base = 0) {
    await addUser(db, user);
    await addSession(db, sid(base + 3), user, 3, 't3');
    await addSession(db, sid(base + 2), user, 2, 't2');
    await addSession(db, sid(base + 1), user, 1, 't1'); // oldest => rank 3 => the outgoing candidate
}

describe('#1117 R2 coordinator — evidence gate defers, never deletes', () => {
    it('#1 pending attribution: candidate expires nothing (retention pending)', async () => {
        const db = await freshDb();
        await seed3(db, USER_A);
        await addEval(db, USER_A, sid(1), 'pending', false); // premature/pending — trigger must NOT converge
        const r = await converge(db, USER_A);
        expect(r.status).toBe('pending');
        expect(r.expired_count).toBe(0);
        expect(r.pending_evidence_count).toBe(1);
        expect(expired(await states(db, USER_A))).toBe(0);
    });

    it('#4/#6 missing OR wrong-formula-version evaluation never expires', async () => {
        const db = await freshDb();
        await seed3(db, USER_A);
        // no eval at all:
        expect((await converge(db, USER_A)).status).toBe('pending');
        expect(expired(await states(db, USER_A))).toBe(0);
        // a terminal eval but at the WRONG formula version:
        await addEval(db, USER_A, sid(1), 'verified', true, 'some_other_v9');
        const r = await converge(db, USER_A);
        expect(r.status).toBe('pending');
        expect(expired(await states(db, USER_A))).toBe(0);
    });
});

describe('#1117 R2 coordinator — terminal evidence permits evidence-safe expiry', () => {
    it('#2/#5 terminal VERIFIED evaluation → the correct outgoing candidate expires (auto via trigger)', async () => {
        const db = await freshDb();
        await seed3(db, USER_A);
        // Before evidence: pending, nothing expires (loss between save and eval).
        expect((await converge(db, USER_A)).status).toBe('pending');
        // Durable terminal evaluation persists → AFTER-INSERT trigger auto-converges.
        await addEval(db, USER_A, sid(1), 'verified', true);
        const rs = await states(db, USER_A);
        expect(rs.find(x => x.id === sid(1))!.transcript_state).toBe('expired');
        expect(rs.find(x => x.id === sid(1))!.transcript).toBeNull();
        expect(avail(rs)).toBe(2); // newest two retained
    });

    it('#3 terminal UNVERIFIED (ineligible-terminal) evaluation permits evidence-safe expiry', async () => {
        const db = await freshDb();
        await seed3(db, USER_A);
        await addEval(db, USER_A, sid(1), 'unverified', false); // terminal, ineligible → durable evidence
        const rs = await states(db, USER_A);
        expect(rs.find(x => x.id === sid(1))!.transcript_state).toBe('expired');
        expect(avail(rs)).toBe(2);
    });

    it('idempotent: a second converge after convergence is a no-op', async () => {
        const db = await freshDb();
        await seed3(db, USER_A);
        await addEval(db, USER_A, sid(1), 'verified', true);
        const again = await converge(db, USER_A);
        expect(again.status).toBe('converged');
        expect(again.expired_count).toBe(0);
    });
});

describe('#1117 R2 coordinator — multi-candidate convergence, isolation, boundaries', () => {
    it('all-or-nothing gate: 3 candidates converge only once every one has terminal evidence', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        for (let k = 5; k >= 1; k--) await addSession(db, sid(k), USER_A, k, `t${k}`); // 5 sessions => 3 candidates (sid1,2,3)
        await addEval(db, USER_A, sid(1), 'verified', true); // 1/3 durable → still deferred
        expect(expired(await states(db, USER_A))).toBe(0);
        await addEval(db, USER_A, sid(2), 'verified', true); // 2/3 → still deferred
        expect(expired(await states(db, USER_A))).toBe(0);
        await addEval(db, USER_A, sid(3), 'verified', true); // 3/3 → converges now (trigger)
        const rs = await states(db, USER_A);
        expect(expired(rs)).toBe(3);
        expect(avail(rs)).toBe(2);
    });

    it('no candidates (<=2 sessions): converged, nothing expired', async () => {
        const db = await freshDb();
        await addUser(db, USER_A);
        await addSession(db, sid(2), USER_A, 2, 't2');
        await addSession(db, sid(1), USER_A, 1, 't1');
        const r = await converge(db, USER_A);
        expect(r.status).toBe('converged');
        expect(r.expired_count).toBe(0);
        expect(avail(await states(db, USER_A))).toBe(2);
    });

    it('cross-user isolation: converging A does not touch B', async () => {
        const db = await freshDb();
        await seed3(db, USER_A, 0);
        await seed3(db, USER_B, 100); // distinct session ids
        await addEval(db, USER_A, sid(1), 'verified', true); // A converges via trigger
        expect(expired(await states(db, USER_A))).toBe(1);
        expect(expired(await states(db, USER_B))).toBe(0); // B untouched (never converged)
        expect(avail(await states(db, USER_B))).toBe(3);
    });

    it('content-free status only (no transcript text; fixed key set)', async () => {
        const db = await freshDb();
        await seed3(db, USER_A);
        const r = await converge(db, USER_A);
        expect(Object.keys(r).sort()).toEqual(
            ['eligible_candidate_count', 'expired_count', 'has_more', 'pending_evidence_count', 'policy_version', 'status']);
        expect(r.policy_version).toBe('newest_two_v1');
        expect(JSON.stringify(r)).not.toContain('t1');
    });
});
