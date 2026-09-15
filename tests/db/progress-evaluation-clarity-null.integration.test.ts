// @vitest-environment node
//
// #1471 (D2, PO Open Mic takes on 576c4712, #1399) — `record_progress_evaluation` cannot insert for a session saved the
// current way. Production console: `23502 null value in column "clarity_evidence_available" of relation
// "session_progress_evaluations" violates not-null constraint`, on every save, followed by rpc_error Progress debt that
// holds the next Start ~30 s.
//
// Mechanism under test: current saves carry filler evidence ONLY in `sessions.filler_counts` (#1306; complete_session_v2
// requires a measured map, `{}` for a genuine zero) and strip legacy `filler_words`, which the RPC stores as `'{}'`. The
// evaluator still reads only `filler_words`; for `'{}'` its predicate is NULL (three-valued logic), `IF NOT v_has_clarity`
// appends no reason, and the INSERT writes NULL into a NOT NULL boolean.
//
// Contract (PM #1471 brief + scope decision + RETURN 5682372478): current evidence always wins; only a POSITIVE valid
// current map is observed evidence; absent, malformed or zero-total evidence (`{}` included) is a real `false` with
// `no_clarity_evidence`, never imputed as a clean zero — a verified zero needs #1472's persisted completeness authority;
// legacy `filler_words` is a strict fallback only when `filler_counts` is absent, and only on an affirmative numeric count.
//
// Production-shaped bootstrap and verbatim migration chain (#1265 suite + #1306 Stage A + the shared validity helper).
// Content-free: synthetic UUIDs and a neutral transcript.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const bootstrapSql = readFileSync(resolve(process.cwd(), 'tests', 'db', 'attribution-authority-bootstrap.sql'), 'utf8');
const CHAIN = [
    '20260731120000_session_progress_evaluations.sql',
    '20260803010000_session_attribution_authority.sql',
];
const MODE_MIGRATION = '20260812030000_progress_cohort_mode_separation_1265.sql';
// #1306 Stage A adds `sessions.filler_counts` + its validation trigger; the repoint migration defines the shared
// `_ss_valid_filler_total` helper. Both are applied verbatim, in timestamp order, after the mode migration.
const FILLER_AUTHORITY_CHAIN = [
    '20260816223606_metrics_only_additive_1306.sql',
    '20260817140000_repoint_analytics_summary_flat_1306.sql',
];

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OBJECTIVE_STUB = `CREATE TABLE IF NOT EXISTS public.objective_source_recording (
  session_id uuid PRIMARY KEY, user_id uuid NOT NULL, registered_at timestamptz NOT NULL DEFAULT now());`;
const PRIVATE_EV = { provider: 'transformers-js', model_id: 'base', fallback_occurred: false, cloud_used: false };
const TRANSCRIPT = 'a clean transcript with plenty of ordinary words and no markers at all in this sample';

type Sql = PGlite;

// The #1471 correction: one CREATE OR REPLACE of record_progress_evaluation, applied last.
const FIX_MIGRATION = '20260915130000_progress_evaluation_filler_counts_authority_1471.sql';

async function makeDb({ withFix = true }: { withFix?: boolean } = {}): Promise<Sql> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    for (const m of CHAIN) await db.exec(MIG(m));
    await db.exec(OBJECTIVE_STUB);
    await db.exec(MIG(MODE_MIGRATION));
    for (const m of FILLER_AUTHORITY_CHAIN) await db.exec(MIG(m));
    if (withFix) await db.exec(MIG(FIX_MIGRATION));
    await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [USER, OTHER]);
    return db;
}

interface SessionShape {
    /** `sessions.filler_counts`; omitted = NULL (not measured). */
    fillerCounts?: object | null;
    /** Legacy `sessions.filler_words`; omitted = the `'{}'` column default the current save leaves behind. */
    fillerWords?: object;
    transcript?: string;
    wpm?: number | null;
    /** Insert `filler_counts` with the #1306 validation trigger disabled (to model a malformed legacy row). */
    bypassFillerValidation?: boolean;
    attest?: boolean;
}

/** A completed Private Open Mic session, attested unless `attest: false`. */
async function savedSession(db: Sql, shape: SessionShape = {}): Promise<string> {
    const cols = ['user_id', 'status', 'duration', 'total_words', 'wpm', 'transcript', 'engine', 'engine_version', 'model_name', 'device_type', 'attribution_status'];
    const vals: unknown[] = [USER, 'active', 93, 141, shape.wpm === undefined ? 91 : shape.wpm, shape.transcript ?? TRANSCRIPT, 'private', 'private_v2:whisper-base.en', 'whisper-base.en', 'browser', 'pending'];
    const jsonCols = new Set<string>();
    if (shape.fillerWords !== undefined) { cols.push('filler_words'); vals.push(JSON.stringify(shape.fillerWords)); jsonCols.add('filler_words'); }
    if (shape.fillerCounts !== undefined && shape.fillerCounts !== null) { cols.push('filler_counts'); vals.push(JSON.stringify(shape.fillerCounts)); jsonCols.add('filler_counts'); }
    const placeholders = cols.map((c, i) => (jsonCols.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(',');
    if (shape.bypassFillerValidation) await db.exec(`ALTER TABLE public.sessions DISABLE TRIGGER validate_filler_counts_1306;`);
    let id: string;
    try {
        id = (await db.query<{ id: string }>(`INSERT INTO public.sessions (${cols.join(',')}) VALUES (${placeholders}) RETURNING id`, vals)).rows[0].id;
    } finally {
        if (shape.bypassFillerValidation) await db.exec(`ALTER TABLE public.sessions ENABLE TRIGGER validate_filler_counts_1306;`);
    }
    if (shape.attest === false) {
        await db.query(`UPDATE public.sessions SET status='completed' WHERE id=$1`, [id]);
        return id;
    }
    const key = `rec-${id}`;
    await db.exec(`SET ROLE service_role`);
    try {
        await db.query(`SELECT public.issue_attribution_intent_v1($1, $2, 'private', 'base')`, [USER, key]);
        await db.query(`SELECT public.bind_attribution_intent_v1($1, $2)`, [id, key]);
        await db.query(`UPDATE public.sessions SET status='completed' WHERE id=$1`, [id]);
        await db.query(`SELECT public.attest_session_engine_v1($1, $2::jsonb)`, [id, JSON.stringify(PRIVATE_EV)]);
    } finally { await db.exec(`RESET ROLE`); }
    return id;
}

async function evaluateAs(db: Sql, userId: string, sessionId: string) {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    return db.query<{ id: string | null }>(`SELECT public.record_progress_evaluation($1) AS id`, [sessionId]);
}
const evaluate = (db: Sql, sessionId: string) => evaluateAs(db, USER, sessionId);

type EvalRow = {
    id: string;
    clarity_evidence_available: boolean | null;
    eligible: boolean;
    exclusion_reasons: string[];
    clarity_raw: number | null;
    filler_count: number | null;
};
const evalRows = async (db: Sql, sessionId: string) => (await db.query<EvalRow>(
    `SELECT id, clarity_evidence_available, eligible, exclusion_reasons, clarity_raw, filler_count
     FROM public.session_progress_evaluations WHERE session_id = $1`, [sessionId])).rows;

/** Absent/unusable evidence must be recorded as ONE honest terminal row: a real false, ineligible, never scored. */
async function expectHonestAbsence(db: Sql, sessionId: string) {
    await expect(evaluate(db, sessionId)).resolves.toBeDefined();
    const rows = await evalRows(db, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].clarity_evidence_available).toBe(false);
    expect(rows[0].eligible).toBe(false);
    expect(rows[0].exclusion_reasons).toContain('no_clarity_evidence');
    expect(rows[0].clarity_raw).toBeNull();
    expect(rows[0].filler_count).toBeNull();
}

describe('#1471 — Progress evaluation reads the current filler evidence authority', () => {
    it('PRECONDITION: the current save shape carries filler_counts, leaves filler_words at "{}", and is attested', async () => {
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: { um: 2 } });
        const row = (await db.query<{ fw: unknown; fc: unknown; authority: number }>(
            `SELECT s.filler_words AS fw, s.filler_counts AS fc,
                    (SELECT count(*) FROM public.session_attribution_authority a WHERE a.session_id = s.id)::int AS authority
             FROM public.sessions s WHERE s.id = $1`, [s])).rows[0];
        expect(row.fw).toEqual({});
        expect(row.fc).toEqual({ um: 2 });
        expect(row.authority).toBe(1);
    });

    it('C1 CASUALTY: the current save shape (filler_counts {"um":2}, filler_words "{}") evaluates eligible with 2 fillers', async () => {
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: { um: 2 } });
        await expect(evaluate(db, s)).resolves.toBeDefined();
        const rows = await evalRows(db, s);
        expect(rows).toHaveLength(1);
        expect(rows[0].clarity_evidence_available).toBe(true);
        expect(rows[0].eligible).toBe(true);
        expect(rows[0].filler_count).toBe(2);
        expect(rows[0].clarity_raw).not.toBeNull();
    });

    // RETURN 5682372478: `{}` is written both for an observed zero and for a detector that could not observe, so on its
    // own it is UNOBSERVABLE — one honest terminal row, never a clean, scorable zero. A genuinely zero-filler session
    // stays ineligible until #1472's persisted completeness authority can prove the zero.
    it('C2 CASUALTY: an empty current map (filler_counts {}) is unobservable — honest false, no clean zero, no 23502', async () => {
        expect.hasAssertions();
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: {} });
        await expectHonestAbsence(db, s);
    });

    // The #1306 validator accepts explicit zero values, so a non-empty map can still total zero. Keys present with a
    // zero count prove no more than `{}` does: only a POSITIVE total is affirmative evidence.
    it('C2b CASUALTY: an explicit all-zero map (filler_counts {"um":0}) is unobservable too, not a clean zero', async () => {
        expect.hasAssertions();
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: { um: 0 } });
        await expectHonestAbsence(db, s);
    });

    it('C3 CASUALTY: absent evidence (filler_counts NULL, filler_words "{}") is an honest false — no 23502, no clean zero', async () => {
        expect.hasAssertions();
        const db = await makeDb();
        const s = await savedSession(db, {});
        await expectHonestAbsence(db, s);
    });

    it('C4 CASUALTY: malformed filler_counts is unavailable, not a partial or zero count', async () => {
        expect.hasAssertions();
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: { um: '2' }, bypassFillerValidation: true });
        await expectHonestAbsence(db, s);
    });

    // A CONTROL, not a casualty: on the unfixed function a false conjunct (`length(btrim('')) > 0`, `wpm IS NOT NULL`)
    // already absorbs the NULL filler predicate (false AND NULL = false). It guards the explicit two-valued COALESCE.
    it('C5 CONTROL: every NOT NULL evidence value is two-valued — empty transcript and NULL wpm record false, never NULL', async () => {
        const db = await makeDb();
        const noTranscript = await savedSession(db, { fillerCounts: { um: 1 }, transcript: '   ' });
        const noWpm = await savedSession(db, { fillerCounts: { um: 1 }, wpm: null });
        for (const s of [noTranscript, noWpm]) {
            await expect(evaluate(db, s)).resolves.toBeDefined();
            const rows = await evalRows(db, s);
            expect(rows).toHaveLength(1);
            expect(rows[0].clarity_evidence_available).toBe(false);
            expect(rows[0].eligible).toBe(false);
            expect(rows[0].exclusion_reasons).toContain('no_clarity_evidence');
        }
    });

    it('C6 CASUALTY: evaluating an absent-evidence session twice returns the same id and keeps one row', async () => {
        const db = await makeDb();
        const s = await savedSession(db, {});
        const first = (await evaluate(db, s)).rows[0]?.id ?? null;
        const second = (await evaluate(db, s)).rows[0]?.id ?? null;
        expect(first).not.toBeNull();
        expect(second).toBe(first);
        expect(await evalRows(db, s)).toHaveLength(1);
    });

    it('C8 CASUALTY: current evidence always wins over a conflicting legacy count', async () => {
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: { uh: 1 }, fillerWords: { total: { count: 9 } } });
        await evaluate(db, s);
        const rows = await evalRows(db, s);
        expect(rows).toHaveLength(1);
        expect(rows[0].clarity_evidence_available).toBe(true);
        expect(rows[0].filler_count).toBe(1);
    });

    it('C8 CONTROL: a pre-#1306 row (no filler_counts) with an affirmative legacy count still evaluates from it', async () => {
        const db = await makeDb();
        const s = await savedSession(db, { fillerWords: { total: { count: 5 } } });
        await evaluate(db, s);
        const rows = await evalRows(db, s);
        expect(rows).toHaveLength(1);
        expect(rows[0].clarity_evidence_available).toBe(true);
        expect(rows[0].filler_count).toBe(5);
    });

    it('C7 CONTROL: an unattested session still defers (writes nothing) instead of failing', async () => {
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: { um: 2 }, attest: false });
        await evaluate(db, s);
        expect(await evalRows(db, s)).toHaveLength(0);
    });

    it('C7 CONTROL: another user cannot evaluate the session (ownership is unchanged)', async () => {
        const db = await makeDb();
        const s = await savedSession(db, { fillerCounts: { um: 2 } });
        await expect(evaluateAs(db, OTHER, s)).rejects.toThrow(/session not found for this user/);
        expect(await evalRows(db, s)).toHaveLength(0);
    });

    it('C9 CONTROL: the correction replaces only the body — identity, return type, ACL, search_path and SECURITY DEFINER are unchanged', async () => {
        const fingerprint = async (db: Sql) => (await db.query<{
            args: string; rettype: string; acl: string | null; secdef: boolean; config: string[] | null; src: string;
        }>(
            `SELECT pg_get_function_identity_arguments(p.oid) AS args, p.prorettype::regtype::text AS rettype,
                    p.proacl::text AS acl, p.prosecdef AS secdef, p.proconfig AS config, p.prosrc AS src
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'record_progress_evaluation'`)).rows;
        const before = await fingerprint(await makeDb({ withFix: false }));
        const after = await fingerprint(await makeDb());
        expect(before).toHaveLength(1);
        expect(after).toHaveLength(1);
        const { src: srcBefore, ...shapeBefore } = before[0];
        const { src: srcAfter, ...shapeAfter } = after[0];
        expect(shapeAfter).toEqual(shapeBefore);
        expect(shapeAfter.secdef).toBe(true);
        // Not vacuous: the body really is the corrected one, and the old one really was not.
        expect(srcBefore).not.toContain('_ss_valid_filler_total');
        expect(srcAfter).toContain('_ss_valid_filler_total');
    });
});
