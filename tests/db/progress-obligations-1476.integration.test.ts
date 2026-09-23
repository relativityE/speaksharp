// @vitest-environment node
//
// #1476 (PM execution directive 5793499386): PROGRESS IS OWED PER COMPLETED SESSION, AND THE SERVER OWNS THE TRUTH.
//
// A shared browser array cannot be cross-device truth (an old tab's later write erased a verified v1 signal). The server
// already knows which completed sessions have no `session_progress_evaluations` row, so `get_progress_obligations()`
// reports each one, per session, for ANY device:
//   owed     — attribution is terminal and no evaluation exists: a caller can settle it now;
//   pending  — attribution is not terminal: `record_progress_evaluation` returns NULL and writes nothing, which is NOT
//              settlement — the obligation stays listed until a real row exists;
//   terminal — an evaluation row exists: no longer listed.
//
// Real PostgreSQL (PGlite) over the verbatim attribution + progress chain, the lease migration and the #1476 migration.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG_DIR = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const MIG = (f: string) => readFileSync(resolve(MIG_DIR, f), 'utf8');
const bootstrapSql = readFileSync(resolve(process.cwd(), 'tests', 'db', 'attribution-authority-bootstrap.sql'), 'utf8');
const CHAIN = [
    '20260731120000_session_progress_evaluations.sql',
    '20260803010000_session_attribution_authority.sql',
];
const OBJECTIVE_STUB = `CREATE TABLE IF NOT EXISTS public.objective_source_recording (
  session_id uuid PRIMARY KEY, user_id uuid NOT NULL, registered_at timestamptz NOT NULL DEFAULT now());`;
const AFTER = [
    '20260812030000_progress_cohort_mode_separation_1265.sql',
    '20260816223606_metrics_only_additive_1306.sql',
    '20260817140000_repoint_analytics_summary_flat_1306.sql',
    '20260607040000_active_recording_lease.sql',
];
const FENCE_MIGRATION = '20260923120000_one_active_engine_per_account_1476.sql';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PRIVATE_EV = { provider: 'transformers-js', model_id: 'base', fallback_occurred: false, cloud_used: false };
const TRANSCRIPT = 'a clean transcript with plenty of ordinary words and no markers at all in this sample';

async function makeDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    for (const m of CHAIN) await db.exec(MIG(m));
    await db.exec(OBJECTIVE_STUB);
    for (const m of AFTER) await db.exec(MIG(m));
    // The #1476 migration also redefines the session writer, which needs tables this chain does not carry; only its
    // obligation function and session fence are exercised here, so it is applied if present and tolerated otherwise.
    if (existsSync(resolve(MIG_DIR, FENCE_MIGRATION))) {
        await db.exec(`CREATE TABLE IF NOT EXISTS public.tier_configs (tier_name text PRIMARY KEY, max_concurrent_sessions int)`);
        await db.exec(MIG(FENCE_MIGRATION));
    }
    await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [USER, OTHER]);
    return db;
}

const as = (db: PGlite, user: string) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user]);

/** A completed Private Open Mic take. `attribution`: 'attested' (terminal authority), 'unattributed' (terminal marker), or 'pending'. */
async function completedTake(db: PGlite, owner: string, attribution: 'attested' | 'unattributed' | 'pending', createdAt?: string): Promise<string> {
    // Recorded exactly as a client does under the #1476 fence: lease, active take, bind, complete, attest, release.
    // `filler_words` carries an affirmative legacy count so this chain's evaluator (before #1471's fix, which is #1521's
    // scope) records a real row; obligations, not filler evidence, are under test here.
    await as(db, owner);
    const lease = (await db.query<{ u: string }>(`SELECT gen_random_uuid()::text AS u`)).rows[0].u;
    await db.query(`SELECT public.acquire_recording_lease($1::uuid, 'fixture', false)`, [lease]);
    const id = (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, status, duration, total_words, wpm, transcript, engine, engine_version, model_name, device_type, attribution_status, filler_counts, filler_words, created_at, lease_id)
         VALUES ($1, 'active', 93, 141, 91, $2, 'private', 'private_v2:whisper-base.en', 'whisper-base.en', 'browser', 'pending', '{"um":2}'::jsonb, '{"total":{"count":2}}'::jsonb, COALESCE($3::timestamptz, now()), $4::uuid)
         RETURNING id`, [owner, TRANSCRIPT, createdAt ?? null, lease])).rows[0].id;
    if (attribution === 'pending') {
        await db.query(`UPDATE public.sessions SET status='completed' WHERE id=$1`, [id]);
        await db.query(`SELECT public.release_recording_lease($1::uuid)`, [lease]);
        return id;
    }
    const key = `rec-${id}`;
    await db.exec(`SET ROLE service_role`);
    try {
        await db.query(`SELECT public.issue_attribution_intent_v1($1, $2, 'private', 'base')`, [owner, key]);
        await db.query(`SELECT public.bind_attribution_intent_v1($1, $2)`, [id, key]);
        await db.query(`UPDATE public.sessions SET status='completed' WHERE id=$1`, [id]);
        if (attribution === 'attested') {
            await db.query(`SELECT public.attest_session_engine_v1($1, $2::jsonb)`, [id, JSON.stringify(PRIVATE_EV)]);
        } else {
            await db.query(`SELECT public.resolve_session_unattributed_v1($1)`, [id]);
        }
    } finally { await db.exec(`RESET ROLE`); }
    await db.query(`SELECT public.release_recording_lease($1::uuid)`, [lease]);
    return id;
}

type Obligation = { session_id: string; state: 'owed' | 'pending' };
const obligations = async (db: PGlite, limit?: number): Promise<Obligation[]> =>
    (await db.query<{ r: Obligation[] }>(
        limit === undefined ? `SELECT public.get_progress_obligations() AS r` : `SELECT public.get_progress_obligations($1) AS r`,
        limit === undefined ? [] : [limit])).rows[0].r;
const evaluate = async (db: PGlite, id: string) =>
    (await db.query<{ id: string | null }>(`SELECT public.record_progress_evaluation($1) AS id`, [id])).rows[0].id;

describe('#1476 — Progress is owed per completed session, owned by the server', () => {
    it('PRECONDITION: the obligation function exists (RED until implemented)', async () => {
        const db = await makeDb();
        const fn = await db.query(`SELECT 1 FROM pg_proc WHERE proname = 'get_progress_obligations'`);
        expect(fn.rows, 'get_progress_obligations').toHaveLength(1);
    });

    it('owed: a completed, attributed take with no evaluation is listed for ANY device of the account', async () => {
        const db = await makeDb();
        const id = await completedTake(db, USER, 'attested');
        await as(db, USER);
        expect(await obligations(db)).toEqual([{ session_id: id, state: 'owed' }]);
    });

    it('CASUALTY: a NULL evaluation under pending attribution is NOT settlement — the obligation stays listed', async () => {
        const db = await makeDb();
        const id = await completedTake(db, USER, 'pending');
        await as(db, USER);
        expect(await obligations(db)).toEqual([{ session_id: id, state: 'pending' }]);
        expect(await evaluate(db, id), 'the evaluator defers and writes nothing').toBeNull();
        expect(await obligations(db), 'still owed after the NULL result').toEqual([{ session_id: id, state: 'pending' }]);
    });

    it('a definitive unattributed marker is terminal attribution: owed, and settling it removes it', async () => {
        const db = await makeDb();
        const id = await completedTake(db, USER, 'unattributed');
        await as(db, USER);
        expect(await obligations(db)).toEqual([{ session_id: id, state: 'owed' }]);
        expect(await evaluate(db, id)).not.toBeNull();
        expect(await obligations(db), 'terminal once a real row exists').toEqual([]);
    });

    it('CASUALTY: two sequential takes with the FIRST evaluation delayed — settling the second never hides the first', async () => {
        const db = await makeDb();
        const first = await completedTake(db, USER, 'attested', '2026-09-23T10:00:00Z');
        const second = await completedTake(db, USER, 'attested', '2026-09-23T10:05:00Z');
        await as(db, USER);
        expect(await evaluate(db, second)).not.toBeNull();
        expect(await obligations(db), 'the first take is still owed').toEqual([{ session_id: first, state: 'owed' }]);
    });

    it('CONTROL (owner isolation): another account\'s obligations are never listed, and mine are never theirs', async () => {
        const db = await makeDb();
        const mine = await completedTake(db, USER, 'attested');
        await completedTake(db, OTHER, 'attested');
        await as(db, USER);
        expect((await obligations(db)).map((o) => o.session_id)).toEqual([mine]);
        await as(db, OTHER);
        expect((await obligations(db)).map((o) => o.session_id)).not.toContain(mine);
    });

    it('CONTROL: bounded — newest first, never more than asked', async () => {
        const db = await makeDb();
        await completedTake(db, USER, 'attested', '2026-09-23T09:00:00Z');
        const newest = await completedTake(db, USER, 'attested', '2026-09-23T09:10:00Z');
        await as(db, USER);
        expect(await obligations(db, 1)).toEqual([{ session_id: newest, state: 'owed' }]);
    });

    it('CONTROL: no identity, no obligations (fails closed, never another account\'s list)', async () => {
        const db = await makeDb();
        await completedTake(db, USER, 'attested');
        await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
        await expect(obligations(db)).rejects.toThrow(/not authenticated/);
    });
});
