// @vitest-environment node
//
// RWT-05 — Focus Points eligibility must follow the SERVER-OWNED attribution authority.
//
// #1161 (20260803010000) moved attribution into `session_attribution_authority`, written only by the service-role
// `attest_session_engine_v1`, and froze the client-writable `sessions.attribution_status` column (no client UPDATE,
// never written by any server path, so it stays at its 'pending' default). The objective functions from
// 20260807000000 still gate on that frozen column. The result on Production: every properly attested Private
// recording is refused as "source recording attribution is not verified", so no Focus Points take can register.
//
// This suite applies the REAL migration chain VERBATIM over the existing production-shaped bootstraps and drives
// the real path: issue + bind intent -> complete -> attest -> register -> start. Content-free: synthetic UUIDs only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const attributionBootstrap = readFileSync(resolve(process.cwd(), 'tests', 'db', 'attribution-authority-bootstrap.sql'), 'utf8');

/** What the chain needs beyond the #1161 bootstrap: G1's progress_recommendations FK target and 20260809's user_profiles read. */
const EXTRA_BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS public.progress_recommendations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_session_id   uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    formula_version     text NOT NULL DEFAULT 'clarity_v1',
    target_metric       text NOT NULL,
    target_direction    text NOT NULL DEFAULT 'decrease',
    target_value        double precision NOT NULL,
    target_units        text NOT NULL DEFAULT 'per_min',
    source_metric_value double precision NOT NULL,
    shown_text          text NOT NULL DEFAULT '',
    shown_at            timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_status text
);
`;

/** Production order. 20260811143000 (ACL-only, not applied to Production) is deliberately excluded. */
const CHAIN = [
    '20260802000000_guided_g1_foundation.sql',
    '20260803010000_session_attribution_authority.sql',
    '20260806000000_attest_drop_unused_var.sql',
    '20260807000000_rename_guided_to_objective.sql',
    '20260809000000_focus_points_pro_capability.sql',
    // RWT-05 correction under test: eligibility reads the attribution authority.
    '20260914214307_objective_eligibility_reads_attribution_authority.sql',
];

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const GOOD_V2 = { provider: 'transformers-js', model_id: 'base', fallback_occurred: false, cloud_used: false };
const NOT_VERIFIED = /source recording attribution is not verified/;

type Sql = PGlite;

async function makeDb(chain: readonly string[] = CHAIN): Promise<Sql> {
    const db = new PGlite();
    await db.exec(attributionBootstrap);
    await db.exec(EXTRA_BOOTSTRAP);
    for (const m of chain) await db.exec(MIG(m));
    await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [USER, OTHER]);
    // Focus Points is a Pro capability (20260809): both users are Pro so capability never masks the attribution gate.
    await db.query(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1, 'pro'), ($2, 'pro')`, [USER, OTHER]);
    return db;
}

const act = (db: Sql, uid: string) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);

async function asServiceRole<T>(db: Sql, fn: () => Promise<T>): Promise<T> {
    await db.exec(`SET ROLE service_role`);
    try { return await fn(); } finally { await db.exec(`RESET ROLE`); }
}

async function seedSession(db: Sql, uid: string, engine = 'private-v2'): Promise<string> {
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, engine, engine_version, model_name, device_type, status, duration)
         VALUES ($1, $2, 'v2', 'base', 'cpu', 'active', 30) RETURNING id`, [uid, engine],
    )).rows[0].id;
}

async function bindIntent(db: Sql, sessionId: string, uid: string, engineClass = 'private'): Promise<void> {
    const key = `rec-${sessionId}`;
    await asServiceRole(db, async () => {
        await db.query(`SELECT public.issue_attribution_intent_v1($1, $2, $3, $4)`, [uid, key, engineClass, 'base']);
        await db.query(`SELECT public.bind_attribution_intent_v1($1, $2)`, [sessionId, key]);
    });
}

async function completeAndAttest(db: Sql, sessionId: string, evidence: Record<string, unknown>): Promise<string> {
    await db.query(`UPDATE public.sessions SET status = 'completed' WHERE id = $1`, [sessionId]);
    return asServiceRole(db, async () => (await db.query<{ v: string }>(
        `SELECT public.attest_session_engine_v1($1, $2::jsonb) AS v`, [sessionId, JSON.stringify(evidence)])).rows[0].v);
}

/** The real Focus Points producer path: a properly attested Private recording. */
async function attestedPrivateSession(db: Sql, uid: string): Promise<string> {
    const s = await seedSession(db, uid);
    await bindIntent(db, s, uid);
    expect(await completeAndAttest(db, s, GOOD_V2)).toBe('attrib_v1');
    return s;
}

const register = (db: Sql, sessionId: string) =>
    asServiceRole(db, () => db.query(`SELECT public.objective_register_source_v1($1)`, [sessionId]));

async function seedBrief(db: Sql, uid: string): Promise<{ proj: string; brief: string }> {
    const proj = (await db.query<{ id: string }>(
        `INSERT INTO public.objective_project (user_id, title) VALUES ($1, 'proj') RETURNING id`, [uid])).rows[0].id;
    const brief = (await db.query<{ id: string }>(
        `INSERT INTO public.objective_brief (project_id, user_id, version, event_goal, time_budget_seconds)
         VALUES ($1, $2, 1, 'goal', 120) RETURNING id`, [proj, uid])).rows[0].id;
    return { proj, brief };
}

async function start(db: Sql, uid: string, source: string, idem = 'idem-1'): Promise<string> {
    const { proj, brief } = await seedBrief(db, uid);
    await act(db, uid);
    return (await db.query<{ id: string }>(
        `SELECT public.objective_start_session_v1($1, $2, $3, 'cue_v1', 'objective_action_v1', $4) AS id`,
        [proj, brief, source, idem])).rows[0].id;
}

/** Stamp the registration row directly, so start's own attribution gate is tested independently of register. */
const stampRegistered = (db: Sql, sessionId: string, uid: string) =>
    db.query(`INSERT INTO public.objective_source_recording (session_id, user_id) VALUES ($1, $2)`, [sessionId, uid]);

const count = async (db: Sql, sql: string, args: unknown[]) => Number((await db.query<{ n: number }>(sql, args)).rows[0].n);

describe('RWT-05 — objective eligibility reads the attribution authority (real PostgreSQL)', () => {
    it('PRECONDITION: an attested Private session has an authority row while its legacy column stays pending', async () => {
        const db = await makeDb();
        const s = await attestedPrivateSession(db, USER);
        expect(await count(db, `SELECT count(*) n FROM public.session_attribution_authority
            WHERE session_id=$1 AND authority_version='attrib_v1' AND engine_class='private'`, [s])).toBe(1);
        expect((await db.query<{ a: string }>(`SELECT attribution_status a FROM public.sessions WHERE id=$1`, [s])).rows[0].a)
            .toBe('pending');
    });

    it('CASUALTY: an attested Private recording REGISTERS as a Focus Points source', async () => {
        const db = await makeDb();
        const s = await attestedPrivateSession(db, USER);
        await register(db, s);
        expect(await count(db, `SELECT count(*) n FROM public.objective_source_recording WHERE session_id=$1 AND user_id=$2`,
            [s, USER])).toBe(1);
    });

    it('CASUALTY: an attested, registered Private recording STARTS a Focus Points session', async () => {
        const db = await makeDb();
        const s = await attestedPrivateSession(db, USER);
        await stampRegistered(db, s, USER);
        const id = await start(db, USER, s);
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('CASUALTY: the frozen legacy column alone ("verified", no authority row) is NOT eligible to register', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await db.query(`UPDATE public.sessions SET status='completed', attribution_status='verified' WHERE id=$1`, [s]);
        await expect(register(db, s)).rejects.toThrow(NOT_VERIFIED);
    });

    it('CASUALTY: the frozen legacy column alone ("verified", no authority row) is NOT eligible to start', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await db.query(`UPDATE public.sessions SET status='completed', attribution_status='verified' WHERE id=$1`, [s]);
        await stampRegistered(db, s, USER);
        await expect(start(db, USER, s)).rejects.toThrow(NOT_VERIFIED);
    });

    it('CONTROL: a completed session resolved UNATTRIBUTED (never registered an intent) is refused by register and start', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        expect(await completeAndAttest(db, s, GOOD_V2)).toBe('unattributed');
        await expect(register(db, s)).rejects.toThrow(NOT_VERIFIED);
        await stampRegistered(db, s, USER);
        await expect(start(db, USER, s)).rejects.toThrow(NOT_VERIFIED);
    });

    it('CONTROL: a clean BROWSER attestation is refused — an authority row is necessary, not sufficient', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER, 'native-browser');
        await bindIntent(db, s, USER, 'browser');
        expect(await completeAndAttest(db, s, { ...GOOD_V2, provider: 'web-speech' })).toBe('attrib_v1');
        await expect(register(db, s)).rejects.toThrow(/not verified|not a verified Private engine/);
    });

    it('CONTROL: an authenticated client cannot write attribution_status to manufacture eligibility', async () => {
        const db = await makeDb();
        const s = await seedSession(db, USER);
        await act(db, USER);
        await db.exec(`SET ROLE authenticated`);
        try {
            await expect(db.query(`UPDATE public.sessions SET attribution_status='verified' WHERE id=$1`, [s]))
                .rejects.toThrow(/permission denied/);
        } finally { await db.exec(`RESET ROLE`); }
    });

    it('CONTROL: the correction changes neither function ACL nor search_path', async () => {
        // CREATE OR REPLACE must not widen or narrow who may call these functions; 20260811143000 owns the grants.
        const db = await makeDb(CHAIN.slice(0, -1));
        const probe = `SELECT p.oid::regprocedure::text AS sig, coalesce(p.proacl::text, '<default>') AS acl,
                              coalesce(array_to_string(p.proconfig, ','), '') AS cfg, p.prosecdef AS secdef
                       FROM pg_proc p
                       WHERE p.oid IN ('public.objective_register_source_v1(uuid)'::regprocedure,
                                       'public.objective_start_session_v1(uuid,uuid,uuid,text,text,text)'::regprocedure)
                       ORDER BY 1`;
        const before = (await db.query(probe)).rows;
        await db.exec(MIG(CHAIN[CHAIN.length - 1]));
        expect((await db.query(probe)).rows).toEqual(before);
    });

    it("CONTROL: another user's attested recording cannot start the caller's session", async () => {
        const db = await makeDb();
        const s = await attestedPrivateSession(db, OTHER);
        await stampRegistered(db, s, OTHER);
        await expect(start(db, USER, s)).rejects.toThrow(/source session not owned by caller/);
    });
});
