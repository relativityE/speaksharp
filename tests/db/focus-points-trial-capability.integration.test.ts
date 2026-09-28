import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Focus Points is included in the active 30-day trial (PO 2026-09-28; PM 5869975833; #1532 Codex P1 r4122079951).
 *
 * Real Postgres (PGlite) running the live definition (20260809000000) and then the fix (20260928120000), with the SAME
 * bootstrap and casualty matrix run on a PostgreSQL 17 server (tests/db/*.sql via psql). Also pins the reviewed function-definition digests
 * the read-only Production postflight compares against (before = the live definition, after = this migration).
 */
const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const DB = (f: string) => readFileSync(resolve(process.cwd(), 'tests', 'db', f), 'utf8');
export const LIVE_MIGRATION = '20260809000000_focus_points_pro_capability.sql';
export const TRIAL_MIGRATION = '20260928120000_focus_points_trial_capability.sql';
const DIGEST_SQL = `SELECT md5(pg_get_functiondef('public.has_objective_capability()'::regprocedure)) AS digest`;
// Derived on PostgreSQL 17 from exactly this sequence; the read-only Production postflight compares against these.
const BEFORE_MD5 = 'c33d2f1d8663060e7314523feb566ca1';
const AFTER_MD5 = 'd175dc5e2cf61d7ff66affe793bfea75';

async function fresh(withFix: boolean): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(DB('focus-points-trial-capability-bootstrap.sql'));
    await db.exec(MIG(LIVE_MIGRATION));
    if (withFix) await db.exec(MIG(TRIAL_MIGRATION));
    return db;
}

async function capable(db: PGlite, uid: string): Promise<boolean> {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false); SET ROLE authenticated;`);
    try {
        const r = await db.query<{ ok: boolean }>('SELECT public.has_objective_capability() AS ok');
        return r.rows[0].ok;
    } finally {
        await db.exec('RESET ROLE;');
    }
}

const ACTIVE_TRIAL = 'a0000000-0000-4000-8000-000000000001';
const EXPIRED_TRIAL = 'a0000000-0000-4000-8000-000000000002';

describe('has_objective_capability — active trial (20260928120000)', () => {
    it('CASUALTY (the defect): on the live definition an active-trial account is refused Focus Points', async () => {
        const db = await fresh(false);
        expect(await capable(db, ACTIVE_TRIAL)).toBe(false);
        await db.close();
    });

    it('the full casualty matrix passes after the fix (trial, expiry, marker, free, Pro, grant, isolation, anon, ACL)', async () => {
        const db = await fresh(true);
        await expect(db.exec(DB('focus-points-trial-capability-matrix.sql'))).resolves.toBeDefined();
        await db.close();
    });

    it('CONTROL: the matrix itself fails closed on the live definition (it is not vacuous)', async () => {
        const db = await fresh(false);
        await expect(db.exec(DB('focus-points-trial-capability-matrix.sql'))).rejects.toThrow(/FAIL focus-points trial capability: active trial/);
        await db.close();
    });

    it('the window is read per call: a trial that expires is refused on its next call, with no reload', async () => {
        const db = await fresh(true);
        expect(await capable(db, ACTIVE_TRIAL)).toBe(true);
        await db.exec(`UPDATE public.user_profiles SET trial_expires_at = now() - interval '1 second' WHERE id = '${ACTIVE_TRIAL}'`);
        expect(await capable(db, ACTIVE_TRIAL)).toBe(false);
        expect(await capable(db, EXPIRED_TRIAL)).toBe(false);
        await db.close();
    });

    it('pins the reviewed definition digests used by the read-only Production postflight', async () => {
        const before = await fresh(false);
        expect((await before.query<{ digest: string }>(DIGEST_SQL)).rows[0].digest).toBe(BEFORE_MD5);
        await before.close();
        const after = await fresh(true);
        expect((await after.query<{ digest: string }>(DIGEST_SQL)).rows[0].digest).toBe(AFTER_MD5);
        await after.close();
    });
});
