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
const APPROVED_DETECTOR = 'cue_v1';

type Sql = PGlite;

async function makeDb(grantUsers: string[] = [USER]): Promise<Sql> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    await db.exec(migrationSql);
    await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [USER, OTHER]);
    for (const u of grantUsers) {
        await db.query(
            `INSERT INTO public.guided_account_capability (user_id, enabled) VALUES ($1, true)
             ON CONFLICT (user_id) DO UPDATE SET enabled = true`, [u]);
    }
    return db;
}

const act = (db: Sql, uid: string) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);

/** A verified Private recording — the only kind a Guided session may derive its identity from. */
async function seedRecording(
    db: Sql, uid: string, over: { engine?: string; attribution?: string } = {},
): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, engine, engine_version, attribution_status)
         VALUES ($1, $2, 'v2', $3) RETURNING id`,
        [uid, over.engine ?? 'private-v2', over.attribution ?? 'verified'],
    )).rows[0].id;
}

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

async function startSession(db: Sql, uid: string, o: {
    proj: string; brief: string; source: string; detector?: string; duration: number; idem?: string;
}): Promise<string> {
    await act(db, uid);
    const r = await db.query<{ id: string }>(
        `SELECT public.guided_start_session_v1($1,$2,$3,$4,'guided_action_v1',$5,$6) AS id`,
        [o.proj, o.brief, o.source, o.detector ?? APPROVED_DETECTOR, o.duration, o.idem ?? 'idem-1'],
    );
    return r.rows[0].id;
}

type Signal = { brief_point_id: string; detected_at_seconds: number | null };
async function finalize(db: Sql, uid: string, sessionId: string, signals: Signal[]): Promise<number> {
    await act(db, uid);
    const r = await db.query<{ c: number }>(
        `SELECT public.guided_finalize_evidence_v1($1,$2::jsonb) AS c`, [sessionId, JSON.stringify(signals)]);
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

/** Seed a verified-Private recording + brief and start a session — the common happy-path setup. */
async function setup(db: Sql, uid: string, o: {
    budget: number; points: PointSpec[]; detector?: string; duration: number; idem?: string;
}): Promise<{ rec: string; proj: string; brief: string; pointIds: string[]; s: string }> {
    const rec = await seedRecording(db, uid);
    const { proj, brief, pointIds } = await seedBrief(db, uid, { budget: o.budget, points: o.points });
    const s = await startSession(db, uid, { proj, brief, source: rec, detector: o.detector, duration: o.duration, idem: o.idem });
    return { rec, proj, brief, pointIds, s };
}

const detected = (id: string, at = 3): Signal => ({ brief_point_id: id, detected_at_seconds: at });
const missing = (id: string): Signal => ({ brief_point_id: id, detected_at_seconds: null });

describe('#1046 G1 — Guided hard-off data/evidence foundation (real PostgreSQL)', () => {
    // ── EVIDENCE: server-derived only ──
    it('client-chosen-verdict-rejected: verdict is computed from the offset, not any client-sent field', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await finalize(db, USER, s,
            [{ brief_point_id: pointIds[0], detected_at_seconds: null, verdict: 'detected' } as unknown as Signal]);
        const v = (await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('not_detected');
    });

    it('not_detected-without-versioned-predicate→unavailable: a non-approved FROZEN detector yields unavailable', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], detector: 'unknown_predicate_v9', duration: 50 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const v = (await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('unavailable');
    });

    it('predicate-bound-to-frozen-detector: the caller cannot override the session detector at finalize', async () => {
        // detector is frozen at start; finalize takes NO predicate parameter, so an old-detector session can
        // never be coerced into authoritative not_detected. Approved detector → not_detected.
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], detector: APPROVED_DETECTOR, duration: 50 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const v = (await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('not_detected');
    });

    // ── TIME BOUNDARY ──
    it('overtime-equality-not-material: overtime == max(15s,10%) is NOT material', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 115 });
        await finalize(db, USER, s, [detected(pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, s))).kind).toBe('neutral_repeat');
    });

    it('overtime-just-over-is-material: overtime one second past the threshold IS material', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 116 });
        await finalize(db, USER, s, [detected(pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, s))).kind).toBe('material_time');
    });

    it('overtime-below-threshold-not-material: overtime under max(15s,10%) is not material', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 105 }); // overtime 5 < 15
        await finalize(db, USER, s, [detected(pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, s))).kind).toBe('neutral_repeat');
    });

    it('overtime-10-percent-boundary: with a large budget the 10% term dominates the 15s floor', async () => {
        const db = await makeDb();
        // budget 300 → threshold max(15, 30) = 30. overtime 30 == threshold → not material; overtime 31 → material.
        const eq = await setup(db, USER, { budget: 300, points: [{ order: 0, required: true }], duration: 330, idem: 'eq' });
        await finalize(db, USER, eq.s, [detected(eq.pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, eq.s))).kind).toBe('neutral_repeat');
        const over = await setup(db, USER, { budget: 300, points: [{ order: 0, required: true }], duration: 331, idem: 'over' });
        await finalize(db, USER, over.s, [detected(over.pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, over.s))).kind).toBe('material_time');
    });

    // ── DETERMINISTIC ACTION PRIORITY ──
    it('action-priority-order: unmet required outranks material time and clarity', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        await db.query(
            `INSERT INTO public.progress_recommendations (user_id, source_session_id, target_metric, target_value, source_metric_value)
             VALUES ($1,$2,'filler_rate', 2, 12)`, [USER, rec]);
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, source: rec, duration: 400 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('unmet_required');
        expect(a.target_brief_point_id).toBe(pointIds[0]);
    });

    it('required-tie-by-brief-order-then-id: the lowest brief order is chosen', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 1, required: true }, { order: 0, required: true }], duration: 50,
        });
        await finalize(db, USER, s, [missing(pointIds[0]), missing(pointIds[1])]);
        expect((await getAction(db, await selectAction(db, USER, s))).target_brief_point_id).toBe(pointIds[1]);
    });

    it('optional-never-outranks-required: an unmet OPTIONAL point never becomes the action', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: false }], duration: 116,
        });
        await finalize(db, USER, s, [detected(pointIds[0]), missing(pointIds[1])]);
        expect((await getAction(db, await selectAction(db, USER, s))).kind).toBe('material_time');
    });

    it('clarity-recommendation-delete-keeps-action-valid: SET NULL never violates the shape constraint', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        const recId = (await db.query<{ id: string }>(
            `INSERT INTO public.progress_recommendations (user_id, source_session_id, target_metric, target_value, source_metric_value)
             VALUES ($1,$2,'pace', 3, 9) RETURNING id`, [USER, rec])).rows[0].id;
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, source: rec, duration: 50 }); // no overtime, required covered
        await finalize(db, USER, s, [detected(pointIds[0])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('clarity_improvement');
        // Deleting the underlying #1045 recommendation must NOT be blocked and must keep the action valid.
        await db.query(`DELETE FROM public.progress_recommendations WHERE id = $1`, [recId]);
        const after = await getAction(db, a.id as string);
        expect(after.clarity_recommendation_id).toBeNull();
        expect(after.clarity_metric).toBe('pace'); // retained snapshot keeps the action meaningful
    });

    // ── DISPUTE ──
    it('dispute-does-not-rewrite-evidence: the recorded verdicts are unchanged after a dispute', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const before = (await db.query(`SELECT verdict, predicate_version FROM public.guided_evidence WHERE session_id=$1`, [s])).rows;
        await dispute(db, USER, await selectAction(db, USER, s));
        const after = (await db.query(`SELECT verdict, predicate_version FROM public.guided_evidence WHERE session_id=$1`, [s])).rows;
        expect(after).toEqual(before);
    });

    it('dispute-abandons-and-advances: the disputed action is abandoned and the next eligible is selected', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }], duration: 50,
        });
        await finalize(db, USER, s, [missing(pointIds[0]), missing(pointIds[1])]);
        const first = await selectAction(db, USER, s);
        expect((await getAction(db, first)).target_brief_point_id).toBe(pointIds[0]);
        const next = await dispute(db, USER, first);
        expect((await getAction(db, first)).lifecycle).toBe('abandoned');
        const nextRow = await getAction(db, next);
        expect(nextRow.lifecycle).toBe('active');
        expect(nextRow.kind).toBe('unmet_required');
        expect(nextRow.target_brief_point_id).toBe(pointIds[1]);
    });

    // ── DOMAIN ISOLATION ──
    it('Freestyle-cannot-attach-Guided: a source recording owned by another user is rejected', async () => {
        const db = await makeDb();
        const otherRec = await seedRecording(db, OTHER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1',50,'idem-x') AS id`, [proj, brief, otherRec]),
        ).rejects.toThrow(/source session not owned/i);
    });

    it('source-must-be-verified-Private: null, Cloud/Browser, and unverified sources all fail closed', async () => {
        const db = await makeDb();
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const unverified = await seedRecording(db, USER, { attribution: 'unverified' });
        const browser = await seedRecording(db, USER, { engine: 'native', attribution: 'verified' });
        const cloud = await seedRecording(db, USER, { engine: 'assemblyai', attribution: 'verified' });
        await act(db, USER);
        const start = (src: string | null, key: string) => db.query(
            `SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1',50,$4) AS id`, [proj, brief, src, key]);
        await expect(start(null, 'n')).rejects.toThrow(/source session not owned/i);       // null source
        await expect(start(unverified, 'u')).rejects.toThrow(/attribution is not verified/i);
        await expect(start(browser, 'b')).rejects.toThrow(/not a verified Private engine/i); // Browser
        await expect(start(cloud, 'c')).rejects.toThrow(/not a verified Private engine/i);   // Cloud
    });

    it('recording-delete-preserves-snapshot: deleting the source recording is not blocked and keeps the identity', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, source: rec, duration: 50 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await selectAction(db, USER, s);
        const before = (await db.query<{ engine_version: string; brief_version: number }>(
            `SELECT engine_version, brief_version FROM public.guided_session WHERE id=$1`, [s])).rows[0];

        await db.query(`DELETE FROM public.sessions WHERE id = $1`, [rec]); // must NOT be blocked by any FK/CHECK

        const after = (await db.query<{ source_session_id: string | null; engine_version: string; brief_version: number }>(
            `SELECT source_session_id, engine_version, brief_version FROM public.guided_session WHERE id=$1`, [s])).rows[0];
        expect(after.source_session_id).toBeNull();               // link cleared, session preserved
        expect(after.engine_version).toBe(before.engine_version); // captured Private identity snapshot survives
        expect(Number(after.brief_version)).toBe(Number(before.brief_version));
        const actionsValid = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action WHERE session_id=$1`, [s])).rows[0].n;
        expect(Number(actionsValid)).toBe(1); // action row still satisfies every constraint
    });

    it('Guided-cannot-enter-Freestyle-eval: a full Guided flow writes zero Freestyle recommendation rows', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await selectAction(db, USER, s);
        const recs = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.progress_recommendations`)).rows[0].n;
        expect(Number(recs)).toBe(0);
    });

    // ── FINALIZATION / IDEMPOTENCY / CONCURRENCY ──
    it('idempotent-finalize-no-duplicate: finalizing twice produces exactly one evidence set', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: false }], duration: 50,
        });
        const c1 = await finalize(db, USER, s, [detected(pointIds[0]), missing(pointIds[1])]);
        const c2 = await finalize(db, USER, s, [detected(pointIds[0]), missing(pointIds[1])]);
        expect(c1).toBe(2);
        expect(c2).toBe(2);
    });

    it('concurrent-finalize-no-partial: racing finalize calls yield one complete evidence set, never partial', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }], duration: 50,
        });
        await act(db, USER);
        const sig = JSON.stringify([missing(pointIds[0]), missing(pointIds[1])]);
        await Promise.all([
            db.query(`SELECT public.guided_finalize_evidence_v1($1,$2::jsonb)`, [s, sig]),
            db.query(`SELECT public.guided_finalize_evidence_v1($1,$2::jsonb)`, [s, sig]),
        ]);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].n;
        expect(Number(n)).toBe(2);
    });

    it('idempotent-start: replaying the same key + identity returns the same session, never a duplicate', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const a = await startSession(db, USER, { proj, brief, source: rec, duration: 50, idem: 'same-key' });
        const b = await startSession(db, USER, { proj, brief, source: rec, duration: 50, idem: 'same-key' });
        expect(a).toBe(b);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [USER])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    it('idempotency-key-reuse-different-identity-rejected: each mismatched immutable field class is an error', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        const rec2 = await seedRecording(db, USER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        // A second immutable brief VERSION in the same project (brief/version mismatch class).
        const brief2 = (await db.query<{ id: string }>(
            `INSERT INTO public.guided_brief (project_id, user_id, version, event_goal, time_budget_seconds)
             VALUES ($1,$2,2,'goal2',100) RETURNING id`, [proj, USER])).rows[0].id;
        await startSession(db, USER, { proj, brief, source: rec, detector: 'cue_v1', duration: 50, idem: 'k' });
        await act(db, USER);
        const replay = (b: string, src: string, detector: string, formula: string, dur: number) => db.query(
            `SELECT public.guided_start_session_v1($1,$2,$3,$4,$5,$6,'k') AS id`, [proj, b, src, detector, formula, dur]);
        await expect(replay(brief, rec, 'cue_v1', 'guided_action_v1', 999)).rejects.toThrow(/different session identity/i); // duration
        await expect(replay(brief, rec2, 'cue_v1', 'guided_action_v1', 50)).rejects.toThrow(/different session identity/i);  // source
        await expect(replay(brief, rec, 'other', 'guided_action_v1', 50)).rejects.toThrow(/different session identity/i);    // detector
        await expect(replay(brief2, rec, 'cue_v1', 'guided_action_v1', 50)).rejects.toThrow(/different session identity/i);  // brief/version
        await expect(replay(brief, rec, 'cue_v1', 'other_formula', 50)).rejects.toThrow(/different session identity/i);      // formula
        // (A project mismatch is caught earlier by the brief↔project ownership check — brief not found.)
        const same = await replay(brief, rec, 'cue_v1', 'guided_action_v1', 50); // exact replay returns the original
        expect((same as { rows: { id: string }[] }).rows[0].id).toBeTruthy();
    });

    it('concurrent-start: racing identical start calls return the same session, never a duplicate', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        const call = () => db.query<{ id: string }>(
            `SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1',50,'race') AS id`, [proj, brief, rec]);
        const [a, b] = await Promise.all([call(), call()]);
        expect(a.rows[0].id).toBe(b.rows[0].id);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [USER])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    // ── DELETION ──
    it('owner-delete-cascades-all: deleting the owner removes every Guided row and preserves others', async () => {
        const db = await makeDb([USER, OTHER]);
        const u = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50, idem: 'u' });
        await finalize(db, USER, u.s, [missing(u.pointIds[0])]);
        await selectAction(db, USER, u.s);
        const o = await setup(db, OTHER, { budget: 100, points: [{ order: 0, required: true }], duration: 50, idem: 'o' });
        await finalize(db, OTHER, o.s, [missing(o.pointIds[0])]);

        await db.query(`DELETE FROM auth.users WHERE id = $1`, [USER]);

        for (const t of ['guided_project', 'guided_brief', 'guided_brief_point', 'guided_session', 'guided_evidence', 'guided_action']) {
            const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE user_id = $1`, [USER])).rows[0].n;
            expect(Number(n), `${t} rows for deleted owner`).toBe(0);
        }
        const otherLeft = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [OTHER])).rows[0].n;
        expect(Number(otherLeft)).toBe(1);
    });

    // ── CAPABILITY / PRIVILEGE ──
    it('capability-required-server-derived: a user without capability cannot start, and cannot self-grant', async () => {
        const db = await makeDb([]); // NOBODY granted capability
        const rec = await seedRecording(db, USER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1',50,'idem') AS id`, [proj, brief, rec]),
        ).rejects.toThrow(/capability required/i);

        await db.query(`SET ROLE authenticated`);
        await act(db, USER);
        await expect(
            db.query(`INSERT INTO public.guided_account_capability (user_id, enabled) VALUES ($1, true)`, [USER]),
        ).rejects.toThrow(/permission denied|denied/i);
        await db.query(`RESET ROLE`);
    });

    it('capability-query-is-caller-only: has_guided_capability accepts no uid arg (no cross-user enumeration)', async () => {
        const db = await makeDb();
        await act(db, USER);
        // Self query resolves auth.uid() and returns true; there is NO parameterized form to enumerate others.
        const self = (await db.query<{ ok: boolean }>(`SELECT public.has_guided_capability() AS ok`)).rows[0].ok;
        expect(self).toBe(true);
        await expect(
            db.query(`SELECT public.has_guided_capability($1) AS ok`, [OTHER]),
        ).rejects.toThrow(/does not exist|function/i); // the uid-parameterized overload no longer exists
    });

    it('concurrent-select-returns-same-action: racing selection yields one action ID, no unique-constraint error', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await act(db, USER);
        const [a, b] = await Promise.all([
            db.query<{ id: string }>(`SELECT public.guided_select_action_v1($1) AS id`, [s]),
            db.query<{ id: string }>(`SELECT public.guided_select_action_v1($1) AS id`, [s]),
        ]);
        expect(a.rows[0].id).toBe(b.rows[0].id); // same active action, neither errored
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action WHERE session_id=$1`, [s])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    it('privilege/RLS: SELECT is owner-scoped — another authenticated user sees zero of my rows', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await db.query(`SET ROLE authenticated`);
        await act(db, OTHER);
        const mine = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session`)).rows[0].n;
        expect(Number(mine)).toBe(0);
        await db.query(`RESET ROLE`);
    });
});
