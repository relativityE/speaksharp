/**
 * Focus Points: a partly-made point stays "partial" when the take is reopened (migration 20261127210000).
 * Full checked-in chain in PGlite, then the guarded finalize RPC as the owning user.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const DIR = resolve(process.cwd(), 'backend/supabase/migrations');
const CANDIDATE = '20261127210000_objective_evidence_partial_coverage.sql';
const CONTRACT = readFileSync(resolve(process.cwd(), 'tests/db/trial-read-access-current-chain.integration.test.ts'), 'utf8');
const BOOTSTRAP = CONTRACT.split('const BOOTSTRAP = `')[1].split('`;')[0];

describe('objective evidence keeps partial coverage (20261127210000)', () => {
    let db: PGlite;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(BOOTSTRAP);
        const files = readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort();
        if (!files.includes(CANDIDATE)) throw new Error(`${CANDIDATE} is not in the checked-in chain`);
        for (const file of files) await db.exec(readFileSync(resolve(DIR, file), 'utf8'));
    }, 180_000);
    afterAll(async () => { await db?.close(); });

    async function asUser<T>(uid: string, work: () => Promise<T>): Promise<T> {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
        await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
        await db.exec('SET ROLE authenticated');
        try { return await work(); } finally { await db.exec('RESET ROLE'); }
    }

    /** One owner with Focus Points capability, a two-point brief and an unfinalized 60 s objective session. */
    async function fixture() {
        const uid = randomUUID();
        await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [uid, `partial-${uid}@example.test`]);
        await db.query('INSERT INTO public.objective_account_capability(user_id, enabled) VALUES($1,true) ON CONFLICT (user_id) DO UPDATE SET enabled=true', [uid]);
        const project = randomUUID(), brief = randomUUID(), p1 = randomUUID(), p2 = randomUUID(), p3 = randomUUID(), session = randomUUID();
        await db.query("INSERT INTO public.objective_project(id,user_id,title) VALUES($1,$2,'partial proof')", [project, uid]);
        await db.query("INSERT INTO public.objective_brief(id,project_id,user_id,version,event_goal,time_budget_seconds) VALUES($1,$2,$3,1,'goal',120)", [brief, project, uid]);
        for (const [id, order] of [[p1, 1], [p2, 2], [p3, 3]] as const)
            await db.query("INSERT INTO public.objective_brief_point(id,brief_id,user_id,sort_order,is_required,label) VALUES($1,$2,$3,$4,true,$5)", [id, brief, uid, order, `point ${order}`]);
        await db.query(`INSERT INTO public.objective_session(id,user_id,project_id,brief_id,brief_version,speech_runtime,engine_version,detector_version,
            formula_version,time_budget_seconds,actual_duration_seconds,idempotency_key) VALUES($1,$2,$3,$4,1,'private','e','cue_v1','f',120,60,$5)`,
            [session, uid, project, brief, randomUUID()]);
        return { uid, session, p1, p2, p3 };
    }
    const finalize = (uid: string, session: string, signals: unknown[]) =>
        asUser(uid, () => db.query('SELECT public.objective_finalize_evidence_v1($1,$2::jsonb) AS n', [session, JSON.stringify(signals)]));
    const rows = async (session: string) => Object.fromEntries((await db.query<{ brief_point_id: string; verdict: string; detected_at_seconds: number | null; coverage: string | null }>(
        'SELECT brief_point_id, verdict::text AS verdict, detected_at_seconds, coverage FROM public.objective_evidence WHERE session_id=$1', [session])).rows
        .map(r => [r.brief_point_id, r]));

    it('saves partial and covered beside the unchanged detected verdict; a missed point has no coverage', async () => {
        const f = await fixture();
        await finalize(f.uid, f.session, [
            { brief_point_id: f.p1, detected_at_seconds: 10, coverage: 'partial' },
            { brief_point_id: f.p2, detected_at_seconds: 20, coverage: 'covered' },
        ]);
        const r = await rows(f.session);
        expect(r[f.p1]).toMatchObject({ verdict: 'detected', detected_at_seconds: 10, coverage: 'partial' });
        expect(r[f.p2]).toMatchObject({ verdict: 'detected', detected_at_seconds: 20, coverage: 'covered' });
        expect(r[f.p3]).toMatchObject({ verdict: 'not_detected', detected_at_seconds: null, coverage: null });
    });

    it('an older client that sends no coverage still saves exactly as before (coverage NULL)', async () => {
        const f = await fixture();
        await finalize(f.uid, f.session, [{ brief_point_id: f.p1, detected_at_seconds: 5 }]);
        expect((await rows(f.session))[f.p1]).toMatchObject({ verdict: 'detected', detected_at_seconds: 5, coverage: null });
    });

    it.each([
        ['an unknown value', { coverage: 'green', detected_at_seconds: 10 }],
        ['a non-string value', { coverage: 1, detected_at_seconds: 10 }],
        ['coverage without a detection', { coverage: 'partial' }],
    ])('rejects %s atomically: nothing is written and the session is not finalized', async (_label, extra) => {
        const f = await fixture();
        await expect(finalize(f.uid, f.session, [{ brief_point_id: f.p1, ...extra }, { brief_point_id: f.p2, detected_at_seconds: 3, coverage: 'covered' }]))
            .rejects.toThrow(/coverage must be covered or partial/);
        expect(Object.keys(await rows(f.session))).toHaveLength(0);
        expect((await db.query<{ f: string | null }>('SELECT finalized_at AS f FROM public.objective_session WHERE id=$1', [f.session])).rows[0].f).toBeNull();
        // a corrected retry finalizes normally
        await finalize(f.uid, f.session, [{ brief_point_id: f.p1, detected_at_seconds: 10, coverage: 'partial' }]);
        expect((await rows(f.session))[f.p1].coverage).toBe('partial');
    });

    it('the table refuses any other coverage value even from a privileged writer', async () => {
        const f = await fixture();
        await expect(db.query(`INSERT INTO public.objective_evidence(session_id,user_id,brief_point_id,verdict,predicate_version,detected_at_seconds,coverage)
            VALUES($1,$2,$3,'detected','cue_v1',1,'maybe')`, [f.session, f.uid, f.p1])).rejects.toThrow(/objective_evidence_coverage_closed/);
    });

    it('keeps the unguarded body out of reach of every API role', async () => {
        for (const role of ['anon', 'authenticated', 'service_role'])
            expect((await db.query<{ v: boolean }>("SELECT has_function_privilege($1,'public.objective_finalize_evidence_v1__unguarded(uuid,jsonb)','EXECUTE') AS v", [role])).rows[0].v).toBe(false);
        expect((await db.query<{ v: boolean }>("SELECT has_function_privilege('authenticated','public.objective_finalize_evidence_v1(uuid,jsonb)','EXECUTE') AS v")).rows[0].v).toBe(true);
    });
});
