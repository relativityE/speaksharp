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
const modePreflight = readFileSync(resolve(process.cwd(), 'tests', 'db', 'progress-mode-preflight.sql'), 'utf8');

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

async function eligibleSessionAt(db: Sql, id: string, createdAt: string, engine = 'private-v2'): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions
           (id, user_id, status, duration, total_words, wpm, transcript, filler_words,
            engine, engine_version, model_name, device_type, attribution_status, created_at)
         VALUES ($1,$2,'active',120,150,120,'a clean transcript with plenty of ordinary words and no markers',
            '{"total":{"count":5}}'::jsonb,$3,'v2','base','cpu','pending',$4)
         RETURNING id`, [id, USER, engine, createdAt])).rows[0].id;
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
type PreflightCounts = {
    rows_to_suffix: number;
    cross_mode_pointers_to_replace: number;
    malformed_or_unknown_cohort_keys: number;
    expected_post_apply_cross_mode_pointers: number;
};
const evalRow = async (db: Sql, sessionId: string): Promise<Row> =>
    (await db.query<Row>(
        `SELECT cohort_key, baseline_session_id, previous_comparable_session_id, eligible
         FROM public.session_progress_evaluations WHERE session_id=$1`, [sessionId])).rows[0];

describe('#1265 Focus Points vs Open Mic Progress separation (executed in PGlite)', () => {
    it('HOLDs malformed eligible cohorts before any suffix or pointer mutation', async () => {
        const db = await makeDb(false);
        const timestamp = '2026-08-12T12:00:00Z';
        const a = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000a1', timestamp);
        const b = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000b1', timestamp);
        await attestAuthority(db, a); await evaluate(db, a);
        await attestAuthority(db, b); await evaluate(db, b);
        await db.query(`UPDATE public.session_progress_evaluations
            SET cohort_key = CASE session_id WHEN $1::uuid THEN 'private-v2|v2|base|clarity_v1|unknown'
                                             ELSE cohort_key END,
                previous_comparable_session_id = CASE session_id WHEN $2::uuid THEN $1::uuid
                                                  ELSE previous_comparable_session_id END
            WHERE session_id IN ($1::uuid, $2::uuid)`, [a, b]);

        expect((await db.query<PreflightCounts>(modePreflight)).rows[0]).toMatchObject({
            rows_to_suffix: 1,
            malformed_or_unknown_cohort_keys: 1,
        });
        await expect(db.exec(modeMigration)).rejects.toThrow(/migration HOLD.*=1/i);

        expect((await evalRow(db, a)).cohort_key).toBe('private-v2|v2|base|clarity_v1|unknown');
        expect((await evalRow(db, b)).cohort_key?.split('|')).toHaveLength(4);
        expect((await evalRow(db, b)).previous_comparable_session_id).toBe(a);
        await db.close();
    });

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

    it('tuple chronology repairs equal-timestamp A/B/C/D and the next same-mode sessions continue it', async () => {
        // All four legacy rows share one persisted timestamp. UUID order is therefore the only chronology:
        // objective A < freeform B < objective C < freeform D. A real tuple predecessor rule must produce
        // C -> A and D -> B; a created_at-only filter would incorrectly leave both without predecessors.
        const db = await makeDb(false);
        const timestamp = '2026-07-20T00:00:00Z';
        const a = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000a1', timestamp); await attestAuthority(db, a); await registerObjective(db, a); await evaluate(db, a);
        const b = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000b1', timestamp); await attestAuthority(db, b); await evaluate(db, b);
        const c = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000c1', timestamp); await attestAuthority(db, c); await registerObjective(db, c); await evaluate(db, c);
        const d = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000d1', timestamp); await attestAuthority(db, d); await evaluate(db, d);

        // Make the legacy defect deterministic for the read-only preflight: legitimate same-mode baselines,
        // but C.previous -> B and D.previous -> C cross modes.
        await db.query(`UPDATE public.session_progress_evaluations
            SET baseline_session_id = NULL, previous_comparable_session_id = NULL
            WHERE session_id IN ($1::uuid, $2::uuid)`, [a, b]);
        await db.query(`UPDATE public.session_progress_evaluations
            SET baseline_session_id = CASE session_id WHEN $1::uuid THEN $3::uuid WHEN $2::uuid THEN $4::uuid END,
                previous_comparable_session_id = CASE session_id WHEN $1::uuid THEN $4::uuid WHEN $2::uuid THEN $1::uuid END
            WHERE session_id IN ($1::uuid, $2::uuid)`, [c, d, a, b]);

        const before = (await db.query<PreflightCounts>(modePreflight)).rows[0];
        expect(before).toEqual({
            rows_to_suffix: 4,
            cross_mode_pointers_to_replace: 2,
            malformed_or_unknown_cohort_keys: 0,
            expected_post_apply_cross_mode_pointers: 0,
        });

        // Pre-#1265: single 4-part cohort; C/D most-recent-prior is cross-mode (B/C respectively).
        expect((await evalRow(db, c)).cohort_key?.split('|').length).toBe(4);

        await db.exec(modeMigration); // suffix + REBUILD

        const rowA = await evalRow(db, a);
        const rowB = await evalRow(db, b);
        const rowC = await evalRow(db, c);
        const rowD = await evalRow(db, d);
        expect(rowA.cohort_key?.endsWith('|objective')).toBe(true);
        expect(rowB.cohort_key?.endsWith('|freeform')).toBe(true);
        expect(rowC.cohort_key?.endsWith('|objective')).toBe(true);
        expect(rowD.cohort_key?.endsWith('|freeform')).toBe(true);
        // C -> A (earlier objective); D -> B (earlier freeform); A/B first-of-mode -> NULL.
        expect(rowC.baseline_session_id).toBe(a);
        expect(rowC.previous_comparable_session_id).toBe(a);
        expect(rowD.baseline_session_id).toBe(b);
        expect(rowD.previous_comparable_session_id).toBe(b);
        expect(rowA.baseline_session_id).toBeNull();
        expect(rowA.previous_comparable_session_id).toBeNull();
        expect(rowB.baseline_session_id).toBeNull();
        expect(rowB.previous_comparable_session_id).toBeNull();
        expect((await db.query<PreflightCounts>(modePreflight)).rows[0]).toEqual({
            rows_to_suffix: 0,
            cross_mode_pointers_to_replace: 0,
            malformed_or_unknown_cohort_keys: 0,
            expected_post_apply_cross_mode_pointers: 0,
        });
        // No row points to itself or a future session.
        for (const [id, row] of [[a, rowA], [b, rowB], [c, rowC], [d, rowD]] as const) {
            expect(row.baseline_session_id).not.toBe(id);
            expect(row.previous_comparable_session_id).not.toBe(id);
        }

        // Idempotent: a re-apply is identical.
        await db.exec(modeMigration);
        expect((await evalRow(db, c)).previous_comparable_session_id).toBe(a);
        expect((await evalRow(db, d)).previous_comparable_session_id).toBe(b);

        // The runtime RPC uses the same tuple chronology. Later same-timestamp objective/freeform rows
        // continue from their repaired same-mode histories rather than restarting or crossing modes.
        const e = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000e1', timestamp); await attestAuthority(db, e); await registerObjective(db, e); await evaluate(db, e);
        const f = await eligibleSessionAt(db, '00000000-0000-4000-8000-0000000000f1', timestamp); await attestAuthority(db, f); await evaluate(db, f);
        expect((await evalRow(db, e)).baseline_session_id).toBe(a);
        expect((await evalRow(db, e)).previous_comparable_session_id).toBe(c);
        expect((await evalRow(db, f)).baseline_session_id).toBe(b);
        expect((await evalRow(db, f)).previous_comparable_session_id).toBe(d);
        await db.close();
    });
});
