// @vitest-environment node
//
// #1046 G1 — EXECUTED real-PostgreSQL adversarial proof for the Guided hard-off data/evidence foundation.
//
// A static SQL-string test cannot catch a syntax error, a wrong grant, or a selector that ties the wrong way.
// This suite stands up a REAL throwaway PostgreSQL (PGlite — the repo's existing DB harness), applies the G1
// migration file VERBATIM from disk over a minimal bootstrap, and EXERCISES the guarded RPCs exactly as
// PostgREST would (auth.uid() from the JWT claim GUC). Every row of the accepted G1 adversarial matrix
// (prep packet 5169309609 / criteria 5161246966) maps to a named test below.
//
// Guided project/brief/point authoring is G2 (criteria: "Create/edit immutable brief versions with
// validation"); G1 seeds them as the service role would and proves the evidence/action/dispute foundation.
// Content-free: synthetic UUIDs only — no brief/cue/transcript content.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
    process.cwd(), 'backend', 'supabase', 'migrations', '20260802000000_guided_g1_foundation.sql',
);
const BOOTSTRAP_PATH = resolve(process.cwd(), 'tests', 'db', 'guided-g1-foundation-bootstrap.sql');
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
const bootstrapSql = readFileSync(BOOTSTRAP_PATH, 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const APPROVED_PREDICATE = 'cue_v1';

type Sql = PGlite;

async function makeDb(grantUsers: string[] = [USER]): Promise<Sql> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    await db.exec(migrationSql);
    await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [USER, OTHER]);
    // Server-derived capability grant (service role would write this; NO client path exists).
    for (const u of grantUsers) {
        await db.query(
            `INSERT INTO public.guided_account_capability (user_id, enabled) VALUES ($1, true)
             ON CONFLICT (user_id) DO UPDATE SET enabled = true`, [u]);
    }
    return db;
}

const act = (db: Sql, uid: string) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);

interface PointSpec { order: number; required: boolean; id?: string }
async function seedBrief(
    db: Sql, uid: string, opts: { budget: number; points: PointSpec[] },
): Promise<{ proj: string; brief: string; pointIds: string[] }> {
    const proj = (await db.query<{ id: string }>(
        `INSERT INTO public.guided_project (user_id, title) VALUES ($1, 'proj') RETURNING id`, [uid],
    )).rows[0].id;
    const brief = (await db.query<{ id: string }>(
        `INSERT INTO public.guided_brief (project_id, user_id, version, event_goal, time_budget_seconds)
         VALUES ($1, $2, 1, 'goal', $3) RETURNING id`, [proj, uid, opts.budget],
    )).rows[0].id;
    const pointIds: string[] = [];
    for (const p of opts.points) {
        const id = (await db.query<{ id: string }>(
            `INSERT INTO public.guided_brief_point (id, brief_id, user_id, sort_order, is_required, label)
             VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, 'label') RETURNING id`,
            [p.id ?? null, brief, uid, p.order, p.required],
        )).rows[0].id;
        pointIds.push(id);
    }
    return { proj, brief, pointIds };
}

async function seedRecording(db: Sql, uid: string): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id) VALUES ($1) RETURNING id`, [uid],
    )).rows[0].id;
}

async function startSession(db: Sql, uid: string, o: {
    proj: string; brief: string; source?: string | null; runtime?: string; duration: number; idem?: string;
}): Promise<string> {
    await act(db, uid);
    const r = await db.query<{ id: string }>(
        `SELECT public.guided_start_session_v1($1,$2,$3,$4,'ev1','dv1','guided_action_v1',$5,$6) AS id`,
        [o.proj, o.brief, o.source ?? null, o.runtime ?? 'private', o.duration, o.idem ?? 'idem-1'],
    );
    return r.rows[0].id;
}

type Signal = { brief_point_id: string; detected_at_seconds: number | null };
async function finalize(db: Sql, uid: string, sessionId: string, predicate: string, signals: Signal[]): Promise<number> {
    await act(db, uid);
    const r = await db.query<{ c: number }>(
        `SELECT public.guided_finalize_evidence_v1($1,$2,$3::jsonb) AS c`,
        [sessionId, predicate, JSON.stringify(signals)],
    );
    return Number(r.rows[0].c);
}

async function selectAction(db: Sql, uid: string, sessionId: string): Promise<string> {
    await act(db, uid);
    const r = await db.query<{ id: string }>(`SELECT public.guided_select_action_v1($1) AS id`, [sessionId]);
    return r.rows[0].id;
}

async function getAction(db: Sql, actionId: string) {
    return (await db.query<Record<string, unknown>>(`SELECT * FROM public.guided_action WHERE id = $1`, [actionId])).rows[0];
}

async function dispute(db: Sql, uid: string, actionId: string): Promise<string> {
    await act(db, uid);
    const r = await db.query<{ id: string }>(`SELECT public.guided_dispute_action_v1($1) AS id`, [actionId]);
    return r.rows[0].id;
}

const detected = (id: string, at = 3): Signal => ({ brief_point_id: id, detected_at_seconds: at });
const missing = (id: string): Signal => ({ brief_point_id: id, detected_at_seconds: null });

describe('#1046 G1 — Guided hard-off data/evidence foundation (real PostgreSQL)', () => {
    // ── EVIDENCE: server-derived only ──
    it('client-chosen-verdict-rejected: verdict is computed from the offset, not any client-sent field', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        // A hostile client sends BOTH a null offset AND a "verdict":"detected" — the RPC has no verdict param,
        // so the extra key is ignored and the honest not_detected (approved predicate) is recorded.
        await finalize(db, USER, s, APPROVED_PREDICATE,
            [{ brief_point_id: pointIds[0], detected_at_seconds: null, verdict: 'detected' } as unknown as Signal]);
        const v = (await db.query<{ verdict: string }>(
            `SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('not_detected');
    });

    it('not_detected-without-versioned-predicate→unavailable', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        await finalize(db, USER, s, 'unknown_predicate_v9', [missing(pointIds[0])]);
        const v = (await db.query<{ verdict: string }>(
            `SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('unavailable');
    });

    // ── TIME BOUNDARY ──
    it('overtime-equality-not-material: overtime == max(15s,10%) is NOT material', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, duration: 115 }); // overtime 15 == max(15,10)
        await finalize(db, USER, s, APPROVED_PREDICATE, [detected(pointIds[0])]); // required covered
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('neutral_repeat'); // fell through — 15 is not strictly greater
    });

    it('overtime-just-over-is-material: overtime one second past the threshold IS material', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, duration: 116 }); // overtime 16 > 15
        await finalize(db, USER, s, APPROVED_PREDICATE, [detected(pointIds[0])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('material_time');
    });

    // ── DETERMINISTIC ACTION PRIORITY ──
    it('action-priority-order: unmet required outranks material time and clarity', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        await db.query(
            `INSERT INTO public.progress_recommendations (user_id, source_session_id, target_metric, target_value, source_metric_value)
             VALUES ($1,$2,'filler_rate', 2, 12)`, [USER, rec]); // large-impact clarity present
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, source: rec, duration: 400 }); // material overtime too
        await finalize(db, USER, s, APPROVED_PREDICATE, [missing(pointIds[0])]); // required unmet
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('unmet_required');
        expect(a.target_brief_point_id).toBe(pointIds[0]);
    });

    it('required-tie-by-brief-order-then-id: the lowest brief order is chosen', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, {
            budget: 100, points: [{ order: 1, required: true }, { order: 0, required: true }],
        });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        await finalize(db, USER, s, APPROVED_PREDICATE, [missing(pointIds[0]), missing(pointIds[1])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.target_brief_point_id).toBe(pointIds[1]); // the order-0 point
    });

    it('optional-never-outranks-required: an unmet OPTIONAL point never becomes the action', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: false }],
        });
        const s = await startSession(db, USER, { proj, brief, duration: 116 }); // material overtime present
        // required covered, optional NOT covered → optional must not trigger unmet_required; material time wins.
        await finalize(db, USER, s, APPROVED_PREDICATE, [detected(pointIds[0]), missing(pointIds[1])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('material_time');
    });

    // ── DISPUTE ──
    it('dispute-does-not-rewrite-evidence: the recorded verdicts are unchanged after a dispute', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        await finalize(db, USER, s, APPROVED_PREDICATE, [missing(pointIds[0])]);
        const before = (await db.query(`SELECT verdict, predicate_version FROM public.guided_evidence WHERE session_id=$1`, [s])).rows;
        const a = await selectAction(db, USER, s);
        await dispute(db, USER, a);
        const after = (await db.query(`SELECT verdict, predicate_version FROM public.guided_evidence WHERE session_id=$1`, [s])).rows;
        expect(after).toEqual(before);
    });

    it('dispute-abandons-and-advances: the disputed action is abandoned and the next eligible is selected', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }],
        });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        await finalize(db, USER, s, APPROVED_PREDICATE, [missing(pointIds[0]), missing(pointIds[1])]);
        const first = await selectAction(db, USER, s);
        expect((await getAction(db, first)).target_brief_point_id).toBe(pointIds[0]);
        const next = await dispute(db, USER, first);
        expect((await getAction(db, first)).lifecycle).toBe('abandoned');
        const nextRow = await getAction(db, next);
        expect(nextRow.lifecycle).toBe('active');
        expect(nextRow.kind).toBe('unmet_required');
        expect(nextRow.target_brief_point_id).toBe(pointIds[1]); // advanced to the next required point
    });

    // ── DOMAIN ISOLATION ──
    it('Freestyle-cannot-attach-Guided: a source recording owned by another user is rejected', async () => {
        const db = await makeDb();
        const otherRec = await seedRecording(db, OTHER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'private','ev1','dv1','guided_action_v1',50,'idem-x') AS id`,
                [proj, brief, otherRec]),
        ).rejects.toThrow(/source session not owned/i);
    });

    it('Guided-cannot-enter-Freestyle-eval: a full Guided flow writes zero Freestyle recommendation rows', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        await finalize(db, USER, s, APPROVED_PREDICATE, [missing(pointIds[0])]);
        await selectAction(db, USER, s);
        const recs = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.progress_recommendations`)).rows[0].n;
        expect(Number(recs)).toBe(0); // Guided never contaminates the #1045 Freestyle recommendation table
    });

    // ── FINALIZATION / IDEMPOTENCY / CONCURRENCY ──
    it('idempotent-finalize-no-duplicate: finalizing twice produces exactly one evidence set', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: false }],
        });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        const c1 = await finalize(db, USER, s, APPROVED_PREDICATE, [detected(pointIds[0]), missing(pointIds[1])]);
        const c2 = await finalize(db, USER, s, APPROVED_PREDICATE, [detected(pointIds[0]), missing(pointIds[1])]);
        expect(c1).toBe(2);
        expect(c2).toBe(2); // latch made the second call a no-op — no duplicate rows
    });

    it('concurrent-finalize-no-partial: racing finalize calls yield one complete evidence set, never partial', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }],
        });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        await act(db, USER);
        const sig = JSON.stringify([missing(pointIds[0]), missing(pointIds[1])]);
        // Fire both without awaiting between; the finalize latch (UPDATE ... WHERE finalized_at IS NULL) admits
        // exactly one writer, so the loser inserts nothing — the set is complete (2), never partial or doubled.
        await Promise.all([
            db.query(`SELECT public.guided_finalize_evidence_v1($1,$2,$3::jsonb)`, [s, APPROVED_PREDICATE, sig]),
            db.query(`SELECT public.guided_finalize_evidence_v1($1,$2,$3::jsonb)`, [s, APPROVED_PREDICATE, sig]),
        ]);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].n;
        expect(Number(n)).toBe(2);
    });

    it('idempotent-start: replaying the same idempotency key returns the same session, never a duplicate', async () => {
        const db = await makeDb();
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const a = await startSession(db, USER, { proj, brief, duration: 50, idem: 'same-key' });
        const b = await startSession(db, USER, { proj, brief, duration: 50, idem: 'same-key' });
        expect(a).toBe(b);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [USER])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    // ── DELETION ──
    it('owner-delete-cascades-all: deleting the owner removes every Guided row and preserves others', async () => {
        const db = await makeDb([USER, OTHER]);
        // USER runs a full Guided flow.
        const u = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const su = await startSession(db, USER, { proj: u.proj, brief: u.brief, duration: 50, idem: 'u' });
        await finalize(db, USER, su, APPROVED_PREDICATE, [missing(u.pointIds[0])]);
        await selectAction(db, USER, su);
        // OTHER runs a flow too — must survive.
        const o = await seedBrief(db, OTHER, { budget: 100, points: [{ order: 0, required: true }] });
        const so = await startSession(db, OTHER, { proj: o.proj, brief: o.brief, duration: 50, idem: 'o' });
        await finalize(db, OTHER, so, APPROVED_PREDICATE, [missing(o.pointIds[0])]);

        await db.query(`DELETE FROM auth.users WHERE id = $1`, [USER]);

        for (const t of ['guided_project', 'guided_brief', 'guided_brief_point', 'guided_session', 'guided_evidence', 'guided_action']) {
            const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE user_id = $1`, [USER])).rows[0].n;
            expect(Number(n), `${t} rows for deleted owner`).toBe(0);
        }
        const otherLeft = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [OTHER])).rows[0].n;
        expect(Number(otherLeft)).toBe(1); // other owner's Guided data preserved
    });

    // ── CAPABILITY / PRIVILEGE ──
    it('capability-required-server-derived: a user without capability cannot start, and cannot self-grant', async () => {
        const db = await makeDb([]); // NOBODY granted capability
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,NULL,'private','ev1','dv1','guided_action_v1',50,'idem') AS id`, [proj, brief]),
        ).rejects.toThrow(/capability required/i);

        // The client role has no INSERT grant on the capability table — it cannot grant itself.
        await db.query(`SET ROLE authenticated`);
        await act(db, USER);
        await expect(
            db.query(`INSERT INTO public.guided_account_capability (user_id, enabled) VALUES ($1, true)`, [USER]),
        ).rejects.toThrow(/permission denied|denied/i);
        await db.query(`RESET ROLE`);
    });

    it('privilege/RLS: SELECT is owner-scoped — another authenticated user sees zero of my rows', async () => {
        const db = await makeDb();
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, duration: 50 });
        await finalize(db, USER, s, APPROVED_PREDICATE, [missing(pointIds[0])]);

        await db.query(`SET ROLE authenticated`);
        await act(db, OTHER);
        const mine = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session`)).rows[0].n;
        expect(Number(mine)).toBe(0); // RLS hides USER's session from OTHER
        await db.query(`RESET ROLE`);
    });
});
