// @vitest-environment node
//
// #1046 G1 — EXECUTED real-PostgreSQL adversarial proof for the Guided hard-off data/evidence foundation.
//
// A static SQL-string test cannot catch a syntax error, a wrong grant, or a selector that ties the wrong way.
// This suite stands up a REAL throwaway PostgreSQL (PGlite — the repo's existing DB harness), applies the G1
// migration file VERBATIM from disk over a minimal bootstrap, and EXERCISES the guarded RPCs exactly as
// PostgREST would (auth.uid() from the JWT claim GUC). Every row of the accepted G1 falsification matrix
// (frozen closure contract 5172067139 + the second review packet) maps to a named test below.
//
// Guided project/brief/point authoring is G2; G1 seeds them as the service role would and proves the
// evidence/action/dispute foundation. Content-free: synthetic UUIDs only — no brief/cue/transcript content.
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

/** A recording whose CURRENTLY-PERSISTED attribution reads as verified Private (transitional persisted-field
 * contract — hardening those client-writable columns is external dependency #1161). `duration` is the
 * AUTHORITATIVE persisted duration the RPC snapshots. */
async function seedRecording(
    db: Sql, uid: string, over: { engine?: string; attribution?: string; duration?: number | null } = {},
): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, engine, engine_version, attribution_status, duration)
         VALUES ($1, $2, 'v2', $3, $4) RETURNING id`,
        [uid, over.engine ?? 'private-v2', over.attribution ?? 'verified', over.duration ?? null],
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

/** Server-owned Guided-intent: mark an owned verified-Private recording as a Guided source (mirrors G2 Begin). */
async function registerSource(db: Sql, uid: string, recId: string): Promise<void> {
    await act(db, uid);
    await db.query(`SELECT public.guided_register_source_v1($1)`, [recId]);
}

async function startSession(db: Sql, uid: string, o: {
    proj: string; brief: string; source: string; detector?: string; idem?: string;
}): Promise<string> {
    await registerSource(db, uid, o.source); // a Guided session may only attach a server-registered source
    await act(db, uid);
    const r = await db.query<{ id: string }>(
        `SELECT public.guided_start_session_v1($1,$2,$3,$4,'guided_action_v1',$5) AS id`,
        [o.proj, o.brief, o.source, o.detector ?? APPROVED_DETECTOR, o.idem ?? 'idem-1'],
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

/** Seed a verified-Private recording (with the given practice `duration`) + brief, and start a session. */
async function setup(db: Sql, uid: string, o: {
    budget: number; points: PointSpec[]; detector?: string; duration?: number; idem?: string;
}): Promise<{ rec: string; proj: string; brief: string; pointIds: string[]; s: string }> {
    // Default a small positive duration so a valid `detected()` offset falls within [0, duration] and no
    // overtime triggers (well under budget). Overtime tests pass an explicit duration to override this.
    const rec = await seedRecording(db, uid, { duration: o.duration ?? 30 });
    const { proj, brief, pointIds } = await seedBrief(db, uid, { budget: o.budget, points: o.points });
    const s = await startSession(db, uid, { proj, brief, source: rec, detector: o.detector, idem: o.idem });
    return { rec, proj, brief, pointIds, s };
}

const detected = (id: string, at = 3): Signal => ({ brief_point_id: id, detected_at_seconds: at });
const missing = (id: string): Signal => ({ brief_point_id: id, detected_at_seconds: null });

describe('#1046 G1 — Guided hard-off data/evidence foundation (real PostgreSQL)', () => {
    // ── EVIDENCE: server-derived only ──
    it('client-chosen-verdict-rejected: verdict is computed from the offset, not any client-sent field', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await finalize(db, USER, s,
            [{ brief_point_id: pointIds[0], detected_at_seconds: null, verdict: 'detected' } as unknown as Signal]);
        const v = (await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('not_detected');
    });

    it('not_detected-without-versioned-predicate→unavailable: a non-approved FROZEN detector yields unavailable', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], detector: 'unknown_predicate_v9' });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const v = (await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('unavailable');
    });

    it('predicate-bound-to-frozen-detector: the caller cannot override the session detector at finalize', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], detector: APPROVED_DETECTOR });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const v = (await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].verdict;
        expect(v).toBe('not_detected');
    });

    // ── TIME BOUNDARY — duration is the persisted recording's, never caller input ──
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
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 105 });
        await finalize(db, USER, s, [detected(pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, s))).kind).toBe('neutral_repeat');
    });

    it('overtime-10-percent-boundary: with a large budget the 10% term dominates the 15s floor', async () => {
        const db = await makeDb();
        const eq = await setup(db, USER, { budget: 300, points: [{ order: 0, required: true }], duration: 330, idem: 'eq' });
        await finalize(db, USER, eq.s, [detected(eq.pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, eq.s))).kind).toBe('neutral_repeat'); // overtime 30 == 30
        const over = await setup(db, USER, { budget: 300, points: [{ order: 0, required: true }], duration: 331, idem: 'over' });
        await finalize(db, USER, over.s, [detected(over.pointIds[0])]);
        expect((await getAction(db, await selectAction(db, USER, over.s))).kind).toBe('material_time'); // overtime 31 > 30
    });

    it('duration-snapshotted-from-source: actual_duration is the persisted recording value, not caller input', async () => {
        const db = await makeDb();
        const { s } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 217 });
        const d = (await db.query<{ actual_duration_seconds: number }>(
            `SELECT actual_duration_seconds FROM public.guided_session WHERE id=$1`, [s])).rows[0].actual_duration_seconds;
        expect(Number(d)).toBe(217); // taken from public.sessions.duration; there is no caller duration param
    });

    // ── DETERMINISTIC ACTION PRIORITY ──
    it('action-priority-order: unmet required outranks material time and clarity', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER, { duration: 400 }); // material overtime present
        await db.query(
            `INSERT INTO public.progress_recommendations (user_id, source_session_id, target_metric, target_value, source_metric_value)
             VALUES ($1,$2,'filler_rate', 2, 12)`, [USER, rec]);
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, source: rec });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('unmet_required');
        expect(a.target_brief_point_id).toBe(pointIds[0]);
    });

    it('required-tie-by-brief-order-then-id: the lowest brief order is chosen', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 1, required: true }, { order: 0, required: true }],
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
        const rec = await seedRecording(db, USER, { duration: 50 });
        const recId = (await db.query<{ id: string }>(
            `INSERT INTO public.progress_recommendations (user_id, source_session_id, target_metric, target_value, source_metric_value)
             VALUES ($1,$2,'pace', 3, 9) RETURNING id`, [USER, rec])).rows[0].id;
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, source: rec });
        await finalize(db, USER, s, [detected(pointIds[0])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('clarity_improvement');
        await db.query(`DELETE FROM public.progress_recommendations WHERE id = $1`, [recId]);
        const after = await getAction(db, a.id as string);
        expect(after.clarity_recommendation_id).toBeNull();
        expect(after.clarity_metric).toBe('pace');
    });

    // ── DISPUTE ──
    it('dispute-does-not-rewrite-evidence: the recorded verdicts are unchanged after a dispute', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const before = (await db.query(`SELECT verdict, predicate_version FROM public.guided_evidence WHERE session_id=$1`, [s])).rows;
        await dispute(db, USER, await selectAction(db, USER, s));
        const after = (await db.query(`SELECT verdict, predicate_version FROM public.guided_evidence WHERE session_id=$1`, [s])).rows;
        expect(after).toEqual(before);
    });

    it('dispute-abandons-and-advances: the disputed action is abandoned and the next eligible is selected', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }],
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

    // ── Offset validation: a malformed offset ATOMICALLY rejects the whole finalize (no partial writes) ──
    it('offset-validation: 0 and the exact persisted duration are accepted; out-of-range rejects atomically', async () => {
        const evCount = async (db: Sql, s: string) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_evidence WHERE session_id=$1`, [s])).rows[0].n);
        const finalizedAt = async (db: Sql, s: string) => (await db.query<{ finalized_at: string | null }>(`SELECT finalized_at FROM public.guided_session WHERE id=$1`, [s])).rows[0].finalized_at;
        const finalizeRaw = (db: Sql, s: string, sig: unknown) => db.query(`SELECT public.guided_finalize_evidence_v1($1,$2::jsonb)`, [s, JSON.stringify(sig)]);

        // (1) offset 0 accepted (duration 50)
        let db = await makeDb();
        let g = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await act(db, USER);
        await finalizeRaw(db, g.s, [{ brief_point_id: g.pointIds[0], detected_at_seconds: 0 }]);
        expect((await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [g.s])).rows[0].verdict).toBe('detected');

        // (2) exact persisted duration accepted
        db = await makeDb();
        g = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await act(db, USER);
        await finalizeRaw(db, g.s, [{ brief_point_id: g.pointIds[0], detected_at_seconds: 50 }]);
        expect((await db.query<{ verdict: string }>(`SELECT verdict FROM public.guided_evidence WHERE session_id=$1`, [g.s])).rows[0].verdict).toBe('detected');

        // (3) duration+1 rejects the call atomically — no evidence, no latch
        db = await makeDb();
        g = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await act(db, USER);
        await expect(finalizeRaw(db, g.s, [{ brief_point_id: g.pointIds[0], detected_at_seconds: 51 }])).rejects.toThrow(/outside the recording window/i);
        expect(await evCount(db, g.s)).toBe(0);
        expect(await finalizedAt(db, g.s)).toBeNull();

        // (4) negative rejects
        db = await makeDb();
        g = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], duration: 50 });
        await act(db, USER);
        await expect(finalizeRaw(db, g.s, [{ brief_point_id: g.pointIds[0], detected_at_seconds: -1 }])).rejects.toThrow(/outside the recording window/i);
        expect(await evCount(db, g.s)).toBe(0);

        // (5) mixed valid + invalid writes NOTHING (atomic)
        db = await makeDb();
        g = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }], duration: 50 });
        await act(db, USER);
        await expect(finalizeRaw(db, g.s, [{ brief_point_id: g.pointIds[0], detected_at_seconds: 3 }, { brief_point_id: g.pointIds[1], detected_at_seconds: 999 }])).rejects.toThrow(/outside the recording window/i);
        expect(await evCount(db, g.s)).toBe(0);
        expect(await finalizedAt(db, g.s)).toBeNull();

        // (6) after a rejection, a valid retry finalizes exactly once
        const c = await finalize(db, USER, g.s, [detected(g.pointIds[0]), missing(g.pointIds[1])]);
        expect(c).toBe(2);
        expect(await finalizedAt(db, g.s)).not.toBeNull();
    });

    it('dispute-retry-idempotent: retrying a dispute on an already-abandoned action returns the current successor', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }],
        });
        await finalize(db, USER, s, [missing(pointIds[0]), missing(pointIds[1])]);
        const first = await selectAction(db, USER, s);
        const successor = await dispute(db, USER, first); // first dispute abandons `first`, advances to point[1]
        const retry = await dispute(db, USER, first);      // lost-response retry on the SAME action id
        expect(retry).toBe(successor);                     // idempotent: same successor, no throw
        const disputes = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action_dispute WHERE action_id=$1`, [first])).rows[0].n;
        expect(Number(disputes)).toBe(1);                  // no duplicate dispute row
    });

    it('abandoned-without-dispute-fails-closed: disputing an abandoned action that has no dispute raises + mutates nothing', async () => {
        // (true concurrency is proven separately in tests/db/guided-g1-dispute-concurrency.sh; this is the
        // single-connection fail-closed control — construct the corrupt state via privileged setup.)
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const a = await selectAction(db, USER, s);
        await db.query(`UPDATE public.guided_action SET lifecycle='abandoned' WHERE id=$1`, [a]); // no dispute row
        await act(db, USER);
        await expect(db.query(`SELECT public.guided_dispute_action_v1($1)`, [a])).rejects.toThrow(/action is not active/i);
        const disputes = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action_dispute WHERE action_id=$1`, [a])).rows[0].n;
        const active = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action WHERE session_id=$1 AND lifecycle='active'`, [s])).rows[0].n;
        expect(Number(disputes)).toBe(0); // no dispute created
        expect(Number(active)).toBe(0);   // no successor created
    });

    it('dispute-on-neutral-rejected: the terminal neutral action cannot be disputed (no infinite loop)', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] }); // no overtime, covered → neutral
        await finalize(db, USER, s, [detected(pointIds[0])]);
        const a = await getAction(db, await selectAction(db, USER, s));
        expect(a.kind).toBe('neutral_repeat');
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_dispute_action_v1($1)`, [a.id]),
        ).rejects.toThrow(/terminal neutral/i);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action WHERE session_id=$1`, [s])).rows[0].n;
        expect(Number(n)).toBe(1); // no runaway sequence of neutral actions
    });

    it('capability-revoked-mid-session: every mutating RPC fails closed after the server disables capability', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        const action = await selectAction(db, USER, s);
        // Server revokes capability AFTER the session started + has an active action.
        await db.query(`UPDATE public.guided_account_capability SET enabled = false WHERE user_id = $1`, [USER]);
        await act(db, USER);
        await expect(db.query(`SELECT public.guided_finalize_evidence_v1($1,'[]'::jsonb)`, [s])).rejects.toThrow(/capability required/i);
        await expect(db.query(`SELECT public.guided_select_action_v1($1)`, [s])).rejects.toThrow(/capability required/i);
        await expect(db.query(`SELECT public.guided_dispute_action_v1($1)`, [action])).rejects.toThrow(/capability required/i);
    });

    // ── SOURCE IDENTITY / DOMAIN ISOLATION ──
    it('Freestyle-cannot-attach-Guided: a source recording owned by another user is rejected', async () => {
        const db = await makeDb();
        const otherRec = await seedRecording(db, OTHER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1','idem-x') AS id`, [proj, brief, otherRec]),
        ).rejects.toThrow(/source session not owned/i);
    });

    it('persisted-source-rejects-null/Cloud/Browser/unverified (transitional persisted-field contract, #1161)', async () => {
        // G1 checks the CURRENTLY-PERSISTED attribution fields; it does not (and does not claim to) defend
        // against a client that forges its own sessions.attribution_status — that hardening is #1161.
        const db = await makeDb();
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const unverified = await seedRecording(db, USER, { attribution: 'unverified' });
        const browser = await seedRecording(db, USER, { engine: 'native', attribution: 'verified' });
        const cloud = await seedRecording(db, USER, { engine: 'assemblyai', attribution: 'verified' });
        await act(db, USER);
        const start = (src: string | null, key: string) => db.query(
            `SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1',$4) AS id`, [proj, brief, src, key]);
        await expect(start(null, 'n')).rejects.toThrow(/source session not owned/i);
        await expect(start(unverified, 'u')).rejects.toThrow(/attribution is not verified/i);
        await expect(start(browser, 'b')).rejects.toThrow(/not a verified Private engine/i);
        await expect(start(cloud, 'c')).rejects.toThrow(/not a verified Private engine/i);
    });

    it('own-freestyle-unregistered-recording-rejected: a verified-Private but UNREGISTERED recording cannot attach', async () => {
        // Freestyle-vs-Guided isolation: an owned verified-Private recording that was never registered as a
        // Guided source (i.e. an ordinary Freestyle recording) must NOT produce Guided evidence.
        const db = await makeDb();
        const rec = await seedRecording(db, USER, { duration: 50 }); // verified Private, owned — but NOT registered
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1','idem') AS id`, [proj, brief, rec]),
        ).rejects.toThrow(/not registered for Guided/i);
    });

    it('register-source: only an owned verified-Private recording registers (idempotent; capability-gated)', async () => {
        const db = await makeDb();
        const priv = await seedRecording(db, USER, { duration: 50 });
        const unverified = await seedRecording(db, USER, { attribution: 'unverified' });
        const browser = await seedRecording(db, USER, { engine: 'native', attribution: 'verified' });
        const foreign = await seedRecording(db, OTHER);
        await act(db, USER);
        const reg = (r: string) => db.query(`SELECT public.guided_register_source_v1($1)`, [r]);
        await expect(reg(unverified)).rejects.toThrow(/attribution is not verified/i);
        await expect(reg(browser)).rejects.toThrow(/not a verified Private engine/i);
        await expect(reg(foreign)).rejects.toThrow(/source session not owned/i);
        await reg(priv); await reg(priv); // valid + idempotent
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_source_recording WHERE session_id=$1`, [priv])).rows[0].n;
        expect(Number(n)).toBe(1);
        await db.query(`UPDATE public.guided_account_capability SET enabled=false WHERE user_id=$1`, [USER]); // revoke
        await act(db, USER);
        await expect(reg(priv)).rejects.toThrow(/capability required/i);
    });

    it('unsupported-formula-rejected: only guided_action_v1 is accepted at start (truthful provenance)', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','other_formula','idem') AS id`, [proj, brief, rec]),
        ).rejects.toThrow(/unsupported action formula/i);
    });

    it('recording-delete-preserves-snapshot: deleting the source recording is not blocked and keeps the identity', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER, { duration: 40 });
        const { proj, brief, pointIds } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const s = await startSession(db, USER, { proj, brief, source: rec });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await selectAction(db, USER, s);
        const before = (await db.query<{ engine_version: string; actual_duration_seconds: number }>(
            `SELECT engine_version, actual_duration_seconds FROM public.guided_session WHERE id=$1`, [s])).rows[0];
        await db.query(`DELETE FROM public.sessions WHERE id = $1`, [rec]);
        const after = (await db.query<{ source_session_id: string | null; engine_version: string; actual_duration_seconds: number }>(
            `SELECT source_session_id, engine_version, actual_duration_seconds FROM public.guided_session WHERE id=$1`, [s])).rows[0];
        expect(after.source_session_id).toBeNull();
        expect(after.engine_version).toBe(before.engine_version);
        expect(Number(after.actual_duration_seconds)).toBe(Number(before.actual_duration_seconds));
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action WHERE session_id=$1`, [s])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    it('Guided-cannot-enter-Freestyle-eval: a full Guided flow writes zero Freestyle recommendation rows', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await selectAction(db, USER, s);
        const recs = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.progress_recommendations`)).rows[0].n;
        expect(Number(recs)).toBe(0);
    });

    // ── FINALIZATION / IDEMPOTENCY / CONCURRENCY ──
    it('idempotent-finalize-no-duplicate: finalizing twice produces exactly one evidence set', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: false }],
        });
        const c1 = await finalize(db, USER, s, [detected(pointIds[0]), missing(pointIds[1])]);
        const c2 = await finalize(db, USER, s, [detected(pointIds[0]), missing(pointIds[1])]);
        expect(c1).toBe(2);
        expect(c2).toBe(2);
    });

    it('concurrent-finalize-no-partial: racing finalize calls yield one complete evidence set, never partial', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, {
            budget: 100, points: [{ order: 0, required: true }, { order: 1, required: true }],
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
        const rec = await seedRecording(db, USER, { duration: 50 });
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const a = await startSession(db, USER, { proj, brief, source: rec, idem: 'same-key' });
        const b = await startSession(db, USER, { proj, brief, source: rec, idem: 'same-key' });
        expect(a).toBe(b);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [USER])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    it('idempotency-key-reuse-different-identity-rejected: each mismatched immutable field class is an error', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER, { duration: 50 });
        const rec2 = await seedRecording(db, USER, { duration: 50 });
        await registerSource(db, USER, rec2); // rec2 is a registered Guided source too (isolate the identity-mismatch check)
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        const brief2 = (await db.query<{ id: string }>(
            `INSERT INTO public.guided_brief (project_id, user_id, version, event_goal, time_budget_seconds)
             VALUES ($1,$2,2,'goal2',100) RETURNING id`, [proj, USER])).rows[0].id;
        await startSession(db, USER, { proj, brief, source: rec, detector: 'cue_v1', idem: 'k' });
        await act(db, USER);
        const replay = (b: string, src: string, detector: string) => db.query(
            `SELECT public.guided_start_session_v1($1,$2,$3,$4,'guided_action_v1','k') AS id`, [proj, b, src, detector]);
        await expect(replay(brief, rec2, 'cue_v1')).rejects.toThrow(/different session identity/i);   // source (⇒ duration)
        await expect(replay(brief, rec, 'other')).rejects.toThrow(/different session identity/i);      // detector
        await expect(replay(brief2, rec, 'cue_v1')).rejects.toThrow(/different session identity/i);    // brief/version
        const same = await replay(brief, rec, 'cue_v1'); // exact replay returns the original
        expect((same as { rows: { id: string }[] }).rows[0].id).toBeTruthy();
    });

    it('deleted-source-replay-null-safe-rejected: after SET NULL, a different source on the same key is still rejected', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER, { duration: 50 });
        const rec2 = await seedRecording(db, USER, { duration: 50 });
        await registerSource(db, USER, rec2); // rec2 is a registered Guided source too (isolate the identity-mismatch check)
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await startSession(db, USER, { proj, brief, source: rec, idem: 'k' });
        await db.query(`DELETE FROM public.sessions WHERE id = $1`, [rec]); // guided_session.source_session_id → NULL
        await act(db, USER);
        // IS DISTINCT FROM: NULL vs rec2 is DISTINCT → mismatch detected (a plain <> would evaluate NULL and pass).
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1','k') AS id`, [proj, brief, rec2]),
        ).rejects.toThrow(/different session identity/i);
    });

    it('concurrent-start: racing identical start calls return the same session, never a duplicate', async () => {
        const db = await makeDb();
        const rec = await seedRecording(db, USER, { duration: 50 });
        await registerSource(db, USER, rec);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        const call = () => db.query<{ id: string }>(
            `SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1','race') AS id`, [proj, brief, rec]);
        const [a, b] = await Promise.all([call(), call()]);
        expect(a.rows[0].id).toBe(b.rows[0].id);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [USER])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    it('concurrent-select-returns-same-action: racing selection yields one action ID, no unique-constraint error', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await act(db, USER);
        const [a, b] = await Promise.all([
            db.query<{ id: string }>(`SELECT public.guided_select_action_v1($1) AS id`, [s]),
            db.query<{ id: string }>(`SELECT public.guided_select_action_v1($1) AS id`, [s]),
        ]);
        expect(a.rows[0].id).toBe(b.rows[0].id);
        const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_action WHERE session_id=$1`, [s])).rows[0].n;
        expect(Number(n)).toBe(1);
    });

    // ── DELETION / CAPABILITY / PRIVILEGE ──
    it('owner-delete-cascades-all: deleting the owner removes every Guided row and preserves others', async () => {
        const db = await makeDb([USER, OTHER]);
        const u = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }], idem: 'u' });
        await finalize(db, USER, u.s, [missing(u.pointIds[0])]);
        await selectAction(db, USER, u.s);
        const o = await setup(db, OTHER, { budget: 100, points: [{ order: 0, required: true }], idem: 'o' });
        await finalize(db, OTHER, o.s, [missing(o.pointIds[0])]);
        await db.query(`DELETE FROM auth.users WHERE id = $1`, [USER]);
        for (const t of ['guided_project', 'guided_brief', 'guided_brief_point', 'guided_session', 'guided_evidence', 'guided_action']) {
            const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE user_id = $1`, [USER])).rows[0].n;
            expect(Number(n), `${t} rows for deleted owner`).toBe(0);
        }
        const otherLeft = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session WHERE user_id=$1`, [OTHER])).rows[0].n;
        expect(Number(otherLeft)).toBe(1);
    });

    it('capability-required-server-derived: a user without capability cannot start, and cannot self-grant', async () => {
        const db = await makeDb([]);
        const rec = await seedRecording(db, USER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1','idem') AS id`, [proj, brief, rec]),
        ).rejects.toThrow(/capability required/i);
        await db.query(`SET ROLE authenticated`);
        await act(db, USER);
        await expect(
            db.query(`INSERT INTO public.guided_account_capability (user_id, enabled) VALUES ($1, true)`, [USER]),
        ).rejects.toThrow(/permission denied|denied/i);
        await db.query(`RESET ROLE`);
    });

    it('hard-off-by-default: a fresh database creates zero capability rows and no Guided session can start', async () => {
        const db = await makeDb([]); // no capability granted to anyone
        const cap = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_account_capability`)).rows[0].n;
        expect(Number(cap)).toBe(0); // Guided is globally hard-off — nothing is enabled unless the service role writes it
        const rec = await seedRecording(db, USER);
        const { proj, brief } = await seedBrief(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await act(db, USER);
        await expect(
            db.query(`SELECT public.guided_start_session_v1($1,$2,$3,'cue_v1','guided_action_v1','idem') AS id`, [proj, brief, rec]),
        ).rejects.toThrow(/capability required/i); // no server-created capability ⇒ no Guided start
    });

    it('capability-query-is-caller-only: has_guided_capability accepts no uid arg (no cross-user enumeration)', async () => {
        const db = await makeDb();
        await act(db, USER);
        const self = (await db.query<{ ok: boolean }>(`SELECT public.has_guided_capability() AS ok`)).rows[0].ok;
        expect(self).toBe(true);
        await expect(
            db.query(`SELECT public.has_guided_capability($1) AS ok`, [OTHER]),
        ).rejects.toThrow(/does not exist|function/i);
    });

    it('privilege/RLS: SELECT is owner-scoped — another authenticated user sees zero of my rows', async () => {
        const db = await makeDb();
        const { s, pointIds } = await setup(db, USER, { budget: 100, points: [{ order: 0, required: true }] });
        await finalize(db, USER, s, [missing(pointIds[0])]);
        await db.query(`SET ROLE authenticated`);
        await act(db, OTHER);
        const mine = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.guided_session`)).rows[0].n;
        expect(Number(mine)).toBe(0);
        await db.query(`RESET ROLE`);
    });
});
