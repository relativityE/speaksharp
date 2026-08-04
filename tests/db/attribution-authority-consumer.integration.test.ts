// @vitest-environment node
//
// #1161 — CONSUMER INTEGRATION proof: #1045 Progress eligibility gates on the SERVER-OWNED attribution
// authority, NOT the client-writable sessions.attribution_status.
//
// Applies (over a real PGlite): the production-shaped bootstrap → the #1045 evaluations migration VERBATIM →
// the #1161 migration VERBATIM (which additively redefines record_progress_evaluation). Then proves the trust
// hole is closed: a session that passes EVERY other §4 eligibility gate is still excluded with
// 'unverified_attribution' when it has a client-forged attribution_status='verified' but NO authority row, and
// becomes eligible only once a real attrib_v1 authority row exists — even if attribution_status stays 'pending'.
// Content-free: synthetic UUIDs only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const bootstrapSql = readFileSync(resolve(process.cwd(), 'tests', 'db', 'attribution-authority-bootstrap.sql'), 'utf8');
const evalMigration = MIG('20260731120000_session_progress_evaluations.sql');
const authorityMigration = MIG('20260803010000_session_attribution_authority.sql');

const USER = '11111111-1111-4111-8111-111111111111';
type Sql = PGlite;

async function makeDb(): Promise<Sql> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    await db.exec(evalMigration);        // #1045 record_progress_evaluation (original attribution_status gate)
    await db.exec(authorityMigration);   // #1161 authority tables + additive redefinition (authority gate)
    await db.query(`INSERT INTO auth.users (id) VALUES ($1)`, [USER]);
    return db;
}
const act = (db: Sql, uid: string) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);

/** A session that passes EVERY §4 gate EXCEPT (optionally) attribution: completed, long enough, enough words,
 * clean transcript, numeric filler evidence, sane wpm, complete engine identity. */
async function eligibleSession(db: Sql, attribution: string): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions
           (user_id, status, duration, total_words, wpm, transcript, filler_words,
            engine, engine_version, model_name, device_type, attribution_status)
         VALUES ($1,'completed',120,150,120,'a clean transcript with plenty of ordinary words and no markers',
            '{"total":{"count":5}}'::jsonb,'private-v2','v2','base','cpu',$2)
         RETURNING id`, [USER, attribution])).rows[0].id;
}

async function attestAuthority(db: Sql, sessionId: string): Promise<void> {
    await db.exec(`SET ROLE service_role`);
    try {
        const c = (await db.query<{ c: string }>(
            `SELECT public.issue_attribution_challenge_v1($1) c`, [sessionId])).rows[0].c;
        await db.query(`SELECT public.attest_private_session_v1($1,$2,$3::jsonb)`,
            [sessionId, c, JSON.stringify(
                { provider: 'transformers-js', model_id: 'base', fallback_occurred: false, cloud_used: false })]);
    } finally { await db.exec(`RESET ROLE`); }
}

async function evaluate(db: Sql, sessionId: string): Promise<{ eligible: boolean; reasons: string[] }> {
    await act(db, USER);
    await db.query(`SELECT public.record_progress_evaluation($1)`, [sessionId]);
    const row = (await db.query<{ eligible: boolean; exclusion_reasons: string[] }>(
        `SELECT eligible, exclusion_reasons FROM public.session_progress_evaluations WHERE session_id=$1`,
        [sessionId])).rows[0];
    return { eligible: row.eligible, reasons: row.exclusion_reasons ?? [] };
}

describe('#1161 consumer integration — #1045 Progress gates on the authority', () => {
    it('client-forged attribution_status=verified WITHOUT an authority row → excluded (unverified_attribution)', async () => {
        const db = await makeDb();
        const s = await eligibleSession(db, 'verified');   // the OLD client-writable "proof"
        const { eligible, reasons } = await evaluate(db, s);
        expect(reasons).toContain('unverified_attribution');   // forge no longer suffices
        expect(eligible).toBe(false);
        // and it is the ONLY failing gate — proving the session is otherwise fully eligible
        expect(reasons).toEqual(['unverified_attribution']);
    });

    it('a real attrib_v1 authority row → eligible (unverified_attribution cleared)', async () => {
        const db = await makeDb();
        const s = await eligibleSession(db, 'verified');
        await attestAuthority(db, s);
        const { eligible, reasons } = await evaluate(db, s);
        expect(reasons).not.toContain('unverified_attribution');
        expect(eligible).toBe(true);
    });

    it('authority is the SOLE gate: attribution_status=pending but authority present → eligible', async () => {
        const db = await makeDb();
        const s = await eligibleSession(db, 'pending');   // legacy column never flipped
        await attestAuthority(db, s);
        const { eligible, reasons } = await evaluate(db, s);
        expect(reasons).not.toContain('unverified_attribution');
        expect(eligible).toBe(true);
    });

    it('no authority AND attribution_status=pending → excluded (fail-closed baseline)', async () => {
        const db = await makeDb();
        const s = await eligibleSession(db, 'pending');
        const { eligible, reasons } = await evaluate(db, s);
        expect(reasons).toContain('unverified_attribution');
        expect(eligible).toBe(false);
    });
});
