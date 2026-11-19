// @vitest-environment node
// PostgreSQL WASM execution of the ACTUAL #1643 migration (20261020230653) and its triggers — not native concurrency, hosted or
// provider acceptance.
/**
 * #1826 (Sam's review of 07fb43f6): the canary cleanup's preserve/refuse behaviour proved against the REAL deletion guard
 * (`account_save_delete_guard`, BEFORE DELETE ON auth.users) and the REAL obligation triggers (`zz_account_save_obligation`,
 * `zz_account_save_session_obligation`), applied over the repository's own completion fixture chain. The shared cleanup
 * (tests/live/helpers/runOwnedCleanup.ts) runs unmodified through the canary adapter and lane.
 *
 * Declared fixture boundaries:
 *  - Auth admin port: identity and `app_metadata` come from this test (Supabase Auth is not in SQL); `deleteUser` is a real
 *    `DELETE FROM auth.users`, so the guard trigger, not this file, decides success. It runs as the fixture's table owner.
 *  - PostgREST port: `from().select().eq()` / `from().delete().eq()` are real SQL over the migrated tables, as the fixture owner.
 *  - Residue tables outside the save/delete path that the fixture chain does not create are created EMPTY with the production
 *    `ON DELETE CASCADE` to auth.users, so every residue read is a real query.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { completionBootstrap } from './account-completion-fixture.mjs';
import { canaryCleanup } from '../../scripts/lib/canaryCleanupAdapter';
import { BINDING_KEY } from '../../scripts/lib/canaryRunOwnedSweep.mjs';
import { cleanupLane, sweepLane } from '../../scripts/lib/canaryRunOwnedLane.mjs';

const GUARD_MIGRATION = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const FIXTURE_ONLY_RESIDUE_TABLES = ['user_goals', 'user_filler_words', 'session_attribution_authority', 'session_attribution_challenge',
    'session_attribution_unattributed', 'progress_recommendations', 'progress_recommendation_attempts', 'objective_project',
    'objective_brief', 'objective_brief_point', 'objective_session', 'objective_source_recording', 'objective_evidence', 'objective_action'];
const ENV = {
    GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'relativityE/speaksharp', GITHUB_RUN_ID: '43000000007', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main',
};
const H = 3600_000;
const NAME = /^[a-z_]+$/;
const COLS = /^[a-z_,]+$/;

let db: PGlite;
let seq = 0;
const auth = new Map<string, { email: string; app_metadata: Record<string, unknown>; created_at: string }>();

const owner = async <T>(fn: () => Promise<T>) => { await db.exec('RESET ROLE; SET ROLE closure_owner'); try { return await fn(); } finally { await db.exec('RESET ROLE'); } };
const text = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
const row = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v)]));
const one = async <T = unknown>(sql: string, args: unknown[] = []) => owner(async () => (await db.query<Record<string, T>>(sql, args)).rows);

/** The two ports over the real migrated database (see the boundaries above). */
function sqlAdmin() {
    const deleteUser = vi.fn(async (id: string) => {
        try { await owner(() => db.query('DELETE FROM auth.users WHERE id=$1', [id])); auth.delete(id); return { error: null }; }
        catch { return { error: { message: 'Database error deleting user' } }; } // what the Auth API returns for a trigger refusal
    });
    const user = (id: string) => (auth.has(id) ? { id, ...auth.get(id)! } : null);
    return {
        deleteUser,
        auth: { admin: {
            getUserById: vi.fn(async (id: string) => {
                const exists = (await one<string>('SELECT id FROM auth.users WHERE id=$1', [id])).length === 1;
                return exists && user(id) ? { data: { user: user(id) }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
            }),
            listUsers: vi.fn(async () => {
                const ids = (await one<string>('SELECT id FROM auth.users')).map((r) => String(r.id));
                return { data: { users: ids.map(user).filter(Boolean) }, error: null };
            }),
            deleteUser,
        } },
        from: (table: string) => {
            if (!NAME.test(table)) throw new Error('bad table');
            return {
                select: (cols: string, opts?: { count?: string; head?: boolean }) => ({
                    eq: async (column: string, value: unknown) => {
                        if (!NAME.test(column) || !COLS.test(cols)) throw new Error('bad column');
                        try {
                            if (opts?.head) {
                                const [r] = await one<number>(`SELECT count(*)::int AS n FROM public.${table} WHERE ${column}=$1`, [value]);
                                return { count: Number(r.n), data: null, error: null };
                            }
                            const rows = await one(`SELECT ${cols} FROM public.${table} WHERE ${column}=$1`, [value]);
                            return { data: rows.map(row), count: rows.length, error: null };
                        } catch (e) { return { data: null, count: null, error: { message: (e as Error).message } }; }
                    },
                }),
                delete: () => ({
                    eq: async (column: string, value: unknown) => {
                        if (!NAME.test(column)) throw new Error('bad column');
                        try { await owner(() => db.query(`DELETE FROM public.${table} WHERE ${column}=$1`, [value])); return { error: null }; }
                        catch (e) { return { error: { message: (e as Error).message } }; }
                    },
                }),
            };
        },
    };
}

/** A canary run-owned account in the real database, with this run's (or another run's) `canary_run` binding. */
async function account(runId: string) {
    const n = String(++seq).padStart(12, '0');
    const uid = `c0000000-0000-4000-8000-${n}`;
    const email = `ctrial-run-${runId}-1-${n.slice(-8)}@example.test`;
    await owner(() => db.query('INSERT INTO auth.users VALUES($1,$2,now())', [uid, email]));
    await owner(() => db.query('INSERT INTO public.trial_entitlements(email,user_id) VALUES($1,$2) ON CONFLICT (email) DO UPDATE SET user_id=EXCLUDED.user_id', [email, uid]));
    auth.set(uid, { email, created_at: new Date(Date.now() - 5 * H).toISOString(),
        app_metadata: { [BINDING_KEY]: { repository: ENV.GITHUB_REPOSITORY, workflow: ENV.GITHUB_WORKFLOW_REF, runId, runAttempt: '1', role: 'canary-active-trial' } } });
    const lease = `d0000000-0000-4000-8000-${n}`;
    const session = `e0000000-0000-4000-8000-${n}`;
    return {
        uid, email, lease, session,
        holdLease: () => owner(() => db.query("INSERT INTO active_recording_lease(user_id,lease_id,state,started_at,heartbeat_at) VALUES($1,$2,'active',now(),now())", [uid, lease])),
        releaseLease: () => owner(() => db.query('DELETE FROM active_recording_lease WHERE lease_id=$1', [lease])),
        openTake: () => owner(() => db.query("INSERT INTO sessions(id,user_id,status,lease_id,product,created_at,updated_at,expires_at) VALUES($1,$2,'active',$3,'open_mic',now(),now(),now()+interval '5 minutes')", [session, uid, lease])),
        landSave: () => owner(() => db.query("UPDATE sessions SET status='completed' WHERE id=$1", [session])),
        obligations: async () => (await one<string>('SELECT phase FROM account_save_obligations WHERE user_id=$1 ORDER BY lease_id', [uid])).map((r) => String(r.phase)),
        exists: async () => (await one('SELECT 1 FROM auth.users WHERE id=$1', [uid])).length === 1,
        trialRows: async () => Number((await one<number>('SELECT count(*)::int AS n FROM trial_entitlements WHERE email=$1', [email]))[0].n),
    };
}

describe('#1826 canary cleanup against the ACTUAL #1643 deletion guard (PGlite, real migration and triggers)', () => {
    const saved: Record<string, string | undefined> = {};
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(completionBootstrap());
        await db.exec(`SET ROLE closure_owner; ${readFileSync(GUARD_MIGRATION, 'utf8')} RESET ROLE;`);
        await db.exec(`SET ROLE closure_owner; ${FIXTURE_ONLY_RESIDUE_TABLES.map((t) => `CREATE TABLE public.${t}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);`).join(' ')} RESET ROLE;`);
    }, 120_000);
    afterAll(async () => { await db?.close(); });
    beforeEach(() => {
        for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
        vi.restoreAllMocks();
    });

    it('the guard itself is live: a held lease leaves an admitted obligation, and a direct delete is refused', async () => {
        const a = await account('43000000099');
        await a.holdLease();
        expect(await a.obligations()).toEqual(['admitted']);
        await expect(owner(() => db.query('DELETE FROM auth.users WHERE id=$1', [a.uid]))).rejects.toThrow(/account admitted save unsettled/);
        expect(await a.exists()).toBe(true);
    });

    it('lease-only interruption: unsettled_take before ANY write — account, debt and trial entitlement preserved, no deletion attempt', async () => {
        const a = await account(ENV.GITHUB_RUN_ID);
        await a.holdLease();
        const admin = sqlAdmin();
        const r = await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup });
        expect(r).toMatchObject({ ok: false, code: 'unsettled_take', deleted: 0, preserved: { runId: ENV.GITHUB_RUN_ID, runAttempt: '1' } });
        expect(admin.deleteUser).not.toHaveBeenCalled();
        expect({ exists: await a.exists(), obligations: await a.obligations(), trial: await a.trialRows() }).toEqual({ exists: true, obligations: ['admitted'], trial: 1 });
    });

    it('open take under its lease (recording before the placeholder settled): unsettled_take, no close, no write', async () => {
        const a = await account('43000000010');
        await a.holdLease(); await a.openTake();
        process.env.GITHUB_RUN_ID = '43000000010';
        const admin = sqlAdmin();
        const r = await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup });
        expect(r).toMatchObject({ ok: false, code: 'unsettled_take', deleted: 0 });
        expect(admin.deleteUser).not.toHaveBeenCalled();
        expect({ exists: await a.exists(), obligations: await a.obligations(), trial: await a.trialRows() }).toEqual({ exists: true, obligations: ['admitted'], trial: 1 });
        const [s] = await one('SELECT status FROM sessions WHERE id=$1', [a.session]);
        expect(s.status).toBe('active'); // never closed by the canary
    });

    it('uncertain save: preserved while open; once the save lands, the next cleanup passes the REAL guard with zero residue', async () => {
        const a = await account('43000000011');
        await a.holdLease(); await a.openTake(); await a.releaseLease();
        process.env.GITHUB_RUN_ID = '43000000011';
        expect(await cleanupLane({ admin: sqlAdmin(), env: process.env, cleanup: canaryCleanup })).toMatchObject({ ok: false, code: 'unsettled_take' });
        expect(await a.exists()).toBe(true);
        await a.landSave();
        expect(await a.obligations()).toEqual(['completed']);
        expect(await cleanupLane({ admin: sqlAdmin(), env: process.env, cleanup: canaryCleanup })).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1 });
        expect({ exists: await a.exists(), trial: await a.trialRows() }).toEqual({ exists: false, trial: 0 });
    });

    it('normal completed take: the shared cleanup deletes through the REAL guard (pre-delete, deletion, zero residue)', async () => {
        const a = await account('43000000012');
        await a.holdLease(); await a.openTake(); await a.landSave(); await a.releaseLease();
        process.env.GITHUB_RUN_ID = '43000000012';
        const admin = sqlAdmin();
        expect(await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup })).toEqual({ ok: true, code: 'cleanup-verified', deleted: 1 });
        expect(admin.deleteUser).toHaveBeenCalledTimes(1);
        expect({ exists: await a.exists(), trial: await a.trialRows() }).toEqual({ exists: false, trial: 0 });
    });

    it('released lease with no take (debt the read cannot see): the REAL guard refuses → delete_refused; Auth and debt preserved, but the trial-entitlement row WAS pre-deleted (not "nothing written")', async () => {
        const a = await account('43000000013');
        await a.holdLease(); await a.releaseLease();
        expect(await a.obligations()).toEqual(['admitted']); // a lease DELETE settles nothing
        process.env.GITHUB_RUN_ID = '43000000013';
        const admin = sqlAdmin();
        const r = await cleanupLane({ admin, env: process.env, cleanup: canaryCleanup });
        expect(r).toMatchObject({ ok: false, code: 'delete_refused', deleted: 0, preserved: { runId: '43000000013', runAttempt: '1' } });
        expect(admin.deleteUser).toHaveBeenCalledTimes(1);
        // Pinned side effect (Sam): the shared helper's trial_entitlements pre-delete ran before the guard refused.
        expect({ exists: await a.exists(), obligations: await a.obligations(), trial: await a.trialRows() }).toEqual({ exists: true, obligations: ['admitted'], trial: 0 });
    });

    it('sweep: an unsettled orphan of a finished run is preserved and reported, never counted as removed', async () => {
        const a = await account('43000000001');
        await a.holdLease();
        process.env.GITHUB_RUN_ID = '43000000020';
        const admin = sqlAdmin();
        const finished = async () => ({ status: 'completed', run_attempt: 1, updated_at: new Date(Date.now() - 2 * H).toISOString() });
        const r = await sweepLane({ admin, env: process.env, getRun: finished, cleanup: canaryCleanup });
        // The database is shared across this file, so earlier tests' preserved accounts are orphans too; assert this one.
        expect(r.report?.failures?.unsettled_take ?? 0).toBeGreaterThanOrEqual(1);
        expect(r.report?.swept).toBe(0);
        expect(r.preserved).toContainEqual({ step: 'unsettled_take', runId: '43000000001', runAttempt: '1', accountPattern: 'ctrial-run-43000000001-1-*' });
        expect(r.ok).toBe(false);
        expect({ exists: await a.exists(), obligations: await a.obligations(), trial: await a.trialRows() }).toEqual({ exists: true, obligations: ['admitted'], trial: 1 });
    });
});
