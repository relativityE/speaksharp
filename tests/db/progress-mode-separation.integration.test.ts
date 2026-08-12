// @vitest-environment node
//
// #1265 — CONSUMER INTEGRATION proof (real PGlite): Focus Points (objective) and Open Mic (freeform)
// Progress evaluations get DISTINCT cohorts and never select each other as baseline/previous, while
// same-mode sessions still compare. Applies the production bootstrap → #1045 evaluations migration →
// #1161 authority migration → an objective_source_recording stub (the mode marker; production creates it
// via guided_g1 + the objective rename) → the #1265 migration VERBATIM. Two sessions share the SAME
// engine identity (private-v2|v2|base), so PRACTICE MODE is the only cohort differentiator.
// Content-free: synthetic UUIDs only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const bootstrapSql = readFileSync(resolve(process.cwd(), 'tests', 'db', 'attribution-authority-bootstrap.sql'), 'utf8');
const evalMigration = MIG('20260731120000_session_progress_evaluations.sql');
const authorityMigration = MIG('20260803010000_session_attribution_authority.sql');
const modeMigration = MIG('20260812030000_progress_cohort_mode_separation_1265.sql');

const USER = '11111111-1111-4111-8111-111111111111';
const OBJECTIVE_STUB = `CREATE TABLE IF NOT EXISTS public.objective_source_recording (
  session_id uuid PRIMARY KEY, user_id uuid NOT NULL, registered_at timestamptz NOT NULL DEFAULT now());`;

type Sql = PGlite;

async function makeDb(applyMode = true): Promise<Sql> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    await db.exec(evalMigration);
    await db.exec(authorityMigration);
    await db.exec(OBJECTIVE_STUB);
    if (applyMode) await db.exec(modeMigration); // #1265: mode cohort token + deterministic backfill
    await db.query(`INSERT INTO auth.users (id) VALUES ($1)`, [USER]);
    return db;
}

const act = (db: Sql, uid: string) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);

async function eligibleSession(db: Sql, engine = 'private-v2'): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions
           (user_id, status, duration, total_words, wpm, transcript, filler_words,
            engine, engine_version, model_name, device_type, attribution_status)
         VALUES ($1,'active',120,150,120,'a clean transcript with plenty of ordinary words and no markers',
            '{"total":{"count":5}}'::jsonb,$2,'v2','base','cpu','pending')
         RETURNING id`, [USER, engine])).rows[0].id;
}

const PRIVATE_EV = { provider: 'transformers-js', model_id: 'base', fallback_occurred: false, cloud_used: false };

async function attestAuthority(db: Sql, sessionId: string): Promise<void> {
    const key = `rec-${sessionId}`;
    await db.exec(`SET ROLE service_role`);
    try {
        await db.query(`SELECT public.issue_attribution_intent_v1($1, $2, 'private', 'base')`, [USER, key]);
        await db.query(`SELECT public.bind_attribution_intent_v1($1, $2)`, [sessionId, key]);
        await db.query(`UPDATE public.sessions SET status='completed' WHERE id=$1`, [sessionId]);
        await db.query(`SELECT public.attest_session_engine_v1($1, $2::jsonb)`, [sessionId, JSON.stringify(PRIVATE_EV)]);
    } finally { await db.exec(`RESET ROLE`); }
}

/** Mark a recording as a Focus Points source (production does this via the service-role register RPC). */
async function registerObjective(db: Sql, sessionId: string): Promise<void> {
    await db.query(`INSERT INTO public.objective_source_recording (session_id, user_id) VALUES ($1,$2)`, [sessionId, USER]);
}

async function evaluate(db: Sql, sessionId: string): Promise<void> {
    await act(db, USER);
    await db.query(`SELECT public.record_progress_evaluation($1)`, [sessionId]);
}

type Row = { cohort_key: string | null; baseline_session_id: string | null; previous_comparable_session_id: string | null; eligible: boolean };
const evalRow = async (db: Sql, sessionId: string): Promise<Row> =>
    (await db.query<Row>(
        `SELECT cohort_key, baseline_session_id, previous_comparable_session_id, eligible
         FROM public.session_progress_evaluations WHERE session_id=$1`, [sessionId])).rows[0];

describe('#1265 Focus Points vs Open Mic Progress separation (executed in PGlite)', () => {
    it('objective and freeform sessions get DISTINCT cohorts and never compare across modes', async () => {
        const db = await makeDb();
        const fp = await eligibleSession(db);
        await attestAuthority(db, fp);
        await registerObjective(db, fp);        // Focus Points
        await evaluate(db, fp);

        const om = await eligibleSession(db);
        await attestAuthority(db, om);           // Open Mic (never registered)
        await evaluate(db, om);

        const fpRow = await evalRow(db, fp);
        const omRow = await evalRow(db, om);
        expect(fpRow.eligible).toBe(true);
        expect(omRow.eligible).toBe(true);
        expect(fpRow.cohort_key?.endsWith('|objective')).toBe(true);
        expect(omRow.cohort_key?.endsWith('|freeform')).toBe(true);
        expect(fpRow.cohort_key).not.toBe(omRow.cohort_key);
        // The Open Mic session did NOT pick the prior Focus Points session as its comparable.
        expect(omRow.baseline_session_id).toBeNull();
        expect(omRow.previous_comparable_session_id).toBeNull();
        await db.close();
    });

    it('two Focus Points sessions DO compare within the objective cohort', async () => {
        const db = await makeDb();
        const fp1 = await eligibleSession(db);
        await attestAuthority(db, fp1); await registerObjective(db, fp1); await evaluate(db, fp1);
        const fp2 = await eligibleSession(db);
        await attestAuthority(db, fp2); await registerObjective(db, fp2); await evaluate(db, fp2);
        const r2 = await evalRow(db, fp2);
        expect(r2.cohort_key?.endsWith('|objective')).toBe(true);
        expect(r2.baseline_session_id).toBe(fp1);
        expect(r2.previous_comparable_session_id).toBe(fp1);
        await db.close();
    });

    it('two Open Mic sessions DO compare within the freeform cohort', async () => {
        const db = await makeDb();
        const om1 = await eligibleSession(db);
        await attestAuthority(db, om1); await evaluate(db, om1);
        const om2 = await eligibleSession(db);
        await attestAuthority(db, om2); await evaluate(db, om2);
        const r2 = await evalRow(db, om2);
        expect(r2.cohort_key?.endsWith('|freeform')).toBe(true);
        expect(r2.previous_comparable_session_id).toBe(om1);
        await db.close();
    });

    it('deterministic backfill REBUILDS same-mode pointers over an interleaved history (A obj, B free, C obj)', async () => {
        // Legacy (pre-#1265) history in ONE 4-part cohort, chronologically A < B < C:
        //   A objective, B freeform, C objective. Pre-#1265, C.previous = B (cross-mode). After #1265,
        //   C must compare to the most-recent-prior SAME-MODE session: C.previous = C.baseline = A.
        const db = await makeDb(false);
        const setCreatedAt = (id: string, iso: string) =>
            db.query(`UPDATE public.sessions SET created_at=$2 WHERE id=$1`, [id, iso]);

        const a = await eligibleSession(db); await attestAuthority(db, a); await setCreatedAt(a, '2026-07-20T00:00:00Z'); await registerObjective(db, a); await evaluate(db, a);
        const b = await eligibleSession(db); await attestAuthority(db, b); await setCreatedAt(b, '2026-07-21T00:00:00Z'); await evaluate(db, b); // freeform
        const c = await eligibleSession(db); await attestAuthority(db, c); await setCreatedAt(c, '2026-07-22T00:00:00Z'); await registerObjective(db, c); await evaluate(db, c);

        // Pre-#1265: single 4-part cohort; C's most-recent-prior is B (cross-mode).
        const legacyC = await evalRow(db, c);
        expect(legacyC.cohort_key?.split('|').length).toBe(4);
        expect(legacyC.previous_comparable_session_id).toBe(b);

        await db.exec(modeMigration); // suffix + REBUILD

        const rowA = await evalRow(db, a);
        const rowB = await evalRow(db, b);
        const rowC = await evalRow(db, c);
        expect(rowA.cohort_key?.endsWith('|objective')).toBe(true);
        expect(rowB.cohort_key?.endsWith('|freeform')).toBe(true);
        expect(rowC.cohort_key?.endsWith('|objective')).toBe(true);
        // C rebuilt to the same-mode prior (A); B (only freeform) has no prior.
        expect(rowC.baseline_session_id).toBe(a);
        expect(rowC.previous_comparable_session_id).toBe(a);
        expect(rowB.baseline_session_id).toBeNull();
        expect(rowB.previous_comparable_session_id).toBeNull();
        // A (first objective) has no prior either.
        expect(rowA.previous_comparable_session_id).toBeNull();

        // Idempotent: a re-apply changes nothing.
        await db.exec(modeMigration);
        const rowC2 = await evalRow(db, c);
        expect(rowC2.cohort_key).toBe(rowC.cohort_key);
        expect(rowC2.previous_comparable_session_id).toBe(a);
        await db.close();
    });
});
