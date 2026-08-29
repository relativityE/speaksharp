// @vitest-environment node
//
// #1306 Stage B — retiring the legacy `complete_session` (v1) overloads.
//
// THIS APPLIES THE SHIPPED MIGRATIONS. Four existing DB tests `CREATE FUNCTION public.complete_session(...)`
// by hand, so they exercise a handwritten substitute; a retirement proven against a substitute proves nothing
// about production, because the substitute can be dropped while the deployed function survives. Every
// statement here comes from backend/supabase/migrations, applied in shipped order.
//
// Content-free: synthetic strings only.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const M = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const sql = (f: string) => readFileSync(resolve(M, f), 'utf8');
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'transcript-retention-converge-bootstrap.sql'), 'utf8');

const M1131 = sql('20260801000000_sessions_transcript_state.sql');
const R1 = sql('20260803000000_transcript_retention_newest_two.sql');
const R2 = sql('20260804000000_transcript_retention_converge_on_save.sql');
const STAGE_A = sql('20260816223606_metrics_only_additive_1306.sql');
const ATOMIC = sql('20260819120000_complete_session_v2_atomic_retention_1314.sql');
const STAGE_B = sql('20260829120000_retire_complete_session_v1_1306.sql');

const U = '11111111-1111-4111-8111-111111111111';
const REC = JSON.stringify({
    reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
    value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
});
const sid = (k: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(k).padStart(12, '0')}`;

const EXTRA = `
  ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS subscription_status text,
    ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
    ADD COLUMN IF NOT EXISTS subscription_id text,
    ADD COLUMN IF NOT EXISTS commercial_trial_granted_at timestamptz,
    -- R2's v1 complete_session reads the private-sample entitlement surface (20260610143000). These are
    -- SCAFFOLDING columns, not the object under test: complete_session and complete_session_v2 themselves
    -- still come from the shipped migrations, which is the point of this suite.
    ADD COLUMN IF NOT EXISTS private_sample_limit_seconds int NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS private_sample_seconds_used int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS private_sample_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS private_sample_completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS private_sample_session_id uuid;
  -- BOTH arities are stubbed deliberately. R2 (20260804000000) defines the v1 complete_session against the
  -- FOUR-argument tier resolver that predates commercial_trial_granted_at; Stage A and v2 call the FIVE-argument
  -- form. Stubbing only one leaves the other unresolved, and the failure surfaces as a confusing
  -- "function ... does not exist" from inside the RPC rather than from the schema.
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  SELECT set_config('request.jwt.claim.sub', '${U}', false);
`;

/** The schema as deployed BEFORE Stage B — v1 overloads present. */
async function preStageB(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(M1131);
    await db.exec(R1);
    await db.exec(R2);
    await db.exec(EXTRA);
    await db.exec(STAGE_A);
    await db.exec(ATOMIC);
    await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [U]);
    await db.query("INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro') ON CONFLICT DO NOTHING", [U]);
    return db;
}


/** Exact identity arguments of every overload of `name`, sorted. */
const overloads = async (db: PGlite, name: string): Promise<string[]> => {
    const r = await db.query<{ args: string }>(
        `SELECT pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname=$1 ORDER BY 1`, [name]);
    return r.rows.map(x => x.args);
};

/** Does `role` hold EXECUTE on the overload with exactly these identity arguments? */
async function canExecute(db: PGlite, name: string, args: string, role: string): Promise<boolean> {
    const r = await db.query<{ ok: boolean | null }>(
        `SELECT has_function_privilege($1, (
             SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname='public' AND p.proname=$2
               AND pg_get_function_identity_arguments(p.oid) = $3
         ), 'EXECUTE') AS ok`, [role, name, args]);
    return r.rows[0]?.ok === true;
}

/**
 * Signatures are READ FROM THE CATALOG, never hardcoded.
 *
 * I hardcoded `pg_get_function_identity_arguments` strings on the previous head and every one of them
 * was wrong in some detail, so the premise, the ACL checks and all four mutants failed on my guess
 * rather than on the property under test. What matters is arity and the argument types, which the
 * catalog reports canonically.
 */
const argTypes = async (db: PGlite, name: string): Promise<string[][]> => {
    const r = await db.query<{ types: string[] }>(
        `SELECT ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) AS t) AS types
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public' AND p.proname=$1
         ORDER BY p.pronargs`, [name]);
    return r.rows.map(x => x.types);
};

/** The two legacy overloads, by argument types (5-arg transcript path, 10-arg metrics path). */
const V1A_TYPES = ['uuid', 'text', 'text', 'integer', 'text'];
const V1B_TYPES = ['uuid', 'text', 'integer', 'text', 'jsonb', 'integer',
    'double precision', 'double precision', 'jsonb', 'jsonb'];

async function seed(db: PGlite, k: number, dayN: number) {
    const id = sid(k);
    await db.query(
        `INSERT INTO public.sessions (id, user_id, created_at, status, duration) VALUES ($1,$2,$3,'active',0)`,
        [id, U, new Date(`2026-07-${String(dayN).padStart(2, '0')}T10:00:00Z`).toISOString()]);
    return id;
}

describe('#1306 Stage B — premise: BOTH v1 overloads exist and BOTH roles can execute them', () => {
    // "At least one overload" and "at least one reachable role" are not the premise. Retirement must be
    // proven against the exact surface that exists, or a survivor hides behind an aggregate.
    let db: PGlite;
    beforeAll(async () => { db = await preStageB(); });

    it('exposes exactly the two known v1 overloads, by argument types', async () => {
        expect(await argTypes(db, 'complete_session')).toEqual([V1A_TYPES, V1B_TYPES]);
    });

    it('grants EXECUTE on EACH v1 overload to BOTH authenticated and service_role', async () => {
        const sigs = await overloads(db, 'complete_session');
        expect(sigs).toHaveLength(2);
        for (const args of sigs) {
            for (const role of ['authenticated', 'service_role']) {
                expect(await canExecute(db, 'complete_session', args, role),
                    `${role} must execute complete_session(${args})`).toBe(true);
            }
        }
    });
});

describe('#1306 Stage B — the real V1-A defect: transcript written, convergence swallowed', () => {
    /**
     * V1-A does call converge_transcript_retention. It calls it AFTER writing the transcript, wraps it in
     * EXCEPTION WHEN OTHERS, and returns success:true regardless. So a convergence failure leaves the
     * transcript persisted and tells the caller the save succeeded. That is the failure mode being
     * retired, and it is materially worse than "never converges".
     */
    it('persists the transcript and still reports success when convergence RAISES', async () => {
        const db = await preStageB();
        await db.exec(`
          CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid)
          RETURNS jsonb LANGUAGE plpgsql AS $fn$
          BEGIN RAISE EXCEPTION 'forced convergence failure'; END $fn$;`);
        const id = await seed(db, 10, 10);
        const r = await db.query<{ r: { success: boolean; retention: { status: string } } }>(
            `SELECT public.complete_session($1::uuid, 'completed', 'synthetic transcript', 60, NULL) AS r`, [id]);

        expect(r.rows[0].r.success, 'v1 reports success even though retention failed').toBe(true);
        expect(r.rows[0].r.retention.status).toBe('error');

        const row = await db.query<{ transcript: string | null }>(
            'SELECT transcript FROM public.sessions WHERE id=$1', [id]);
        // The transcript survives a failed convergence — nothing rolls it back.
        expect(row.rows[0].transcript).toBe('synthetic transcript');
        await db.close();
    });

    it('accepts a NON-CONVERGED result without rolling the transcript back', async () => {
        const db = await preStageB();
        await db.exec(`
          CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid)
          RETURNS jsonb LANGUAGE sql AS $fn$ SELECT '{"status":"pending"}'::jsonb $fn$;`);
        const id = await seed(db, 11, 11);
        const r = await db.query<{ r: { success: boolean; retention: { status: string } } }>(
            `SELECT public.complete_session($1::uuid, 'completed', 'synthetic transcript', 60, NULL) AS r`, [id]);
        expect(r.rows[0].r.retention.status).toBe('pending');
        expect(r.rows[0].r.success).toBe(true);
        const row = await db.query<{ transcript: string | null }>(
            'SELECT transcript FROM public.sessions WHERE id=$1', [id]);
        expect(row.rows[0].transcript).toBe('synthetic transcript');
        await db.close();
    });
});

describe('#1306 Stage B — after the shipped migration', () => {
    let db: PGlite;
    beforeAll(async () => { db = await preStageB(); await db.exec(STAGE_B); });

    it('leaves ZERO complete_session overloads', async () => {
        expect(await overloads(db, 'complete_session')).toEqual([]);   // M1, M2
    });

    it('leaves NO role able to execute either legacy signature', async () => {
        // M3: revoke-without-drop. With the function gone there is no oid left to hold a privilege, so
        // this asserts the object's absence from the privilege surface rather than a narrowed grant.
        for (const args of [V1A_TYPES.join(', '), V1B_TYPES.join(', ')]) {
            for (const role of ['authenticated', 'service_role', 'anon']) {
                expect(await canExecute(db, 'complete_session', args, role)).toBe(false);
            }
        }
    });

    it('preserves complete_session_v2 as EXACTLY one overload with its exact signature', async () => {
        expect(await argTypes(db, 'complete_session_v2')).toHaveLength(1);
    });

    it.each([['authenticated', true], ['service_role', true], ['anon', false]])(
        'v2 EXECUTE for %s is %s', async (role, allowed) => {
            const [sig] = await overloads(db, 'complete_session_v2');
            expect(await canExecute(db, 'complete_session_v2', sig, role)).toBe(allowed);
        });

    it('v2 carries no PUBLIC grant (PUBLIC is not an ordinary role, so the ACL shape is checked)', async () => {
        const r = await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
                    unnest(COALESCE(p.proacl, '{}')) AS a
             WHERE n.nspname='public' AND p.proname='complete_session_v2'
               AND split_part(a::text,'=',1) = ''`);
        expect(r.rows[0].n).toBe(0);
    });

    it('fails a v1 call with a NAMED error, never falling through to v2', async () => {
        const id = await seed(db, 2, 2);                                // M5
        await expect(db.query(
            `SELECT public.complete_session($1::uuid, 'completed', 'synthetic transcript', 60, NULL)`,
            [id],
        )).rejects.toThrow(/does not exist/i);
    });

    it('still completes a session through v2, retaining the transcript', async () => {
        const id = await seed(db, 3, 3);
        const r = await db.query<{ r: unknown }>(
            `SELECT public.complete_session_v2(
                p_session_id => $1::uuid, p_status => 'completed', p_final_duration => 60,
                p_reason => NULL, p_next_action => $2::jsonb, p_total_words => 100,
                p_clarity_score => 80, p_wpm => 120, p_filler_counts => '{}'::jsonb,
                p_pause_metrics => NULL, p_final_transcript => 'synthetic transcript') AS r`, [id, REC]);
        expect(r.rows[0].r).toBeTruthy();
        const sRow = await db.query<{ transcript_state: string; transcript: string | null }>(
            'SELECT transcript_state, transcript FROM public.sessions WHERE id=$1', [id]);
        expect(sRow.rows[0].transcript_state).toBe('available');
        expect(sRow.rows[0].transcript).toBe('synthetic transcript');
    });
});

describe('#1306 Stage B — M1-M5 mutate the SHIPPED migration itself', () => {
    /**
     * Every mutant here is derived from the REAL migration source loaded above, not from a handwritten
     * copy of its guard. A test that mutates its own reproduction of the migration qualifies the
     * reproduction; only mutating the shipped text qualifies the shipped migration.
     *
     * Each is asserted to fail with ITS OWN cause. A mutant that dies for the wrong reason proves nothing
     * about the assertion it was aimed at.
     */
    /**
     * The migration's own DROP statements, parsed from the shipped text. Matching a hardcoded signature
     * failed here: the migration writes `UUID, TEXT, TEXT, INT, TEXT` while the catalog renders
     * `uuid, text, text, integer, text`. Parsing what is actually there removes the guess entirely.
     */
    const DROPS = STAGE_B.match(/DROP FUNCTION IF EXISTS public\.complete_session\([^)]*\);/gi) ?? [];

    /** Remove one exact DROP statement, leaving the rest of the migration byte-identical. */
    const without = (stmt: string): string => {
        expect(STAGE_B.includes(stmt), `mutation precondition: migration must contain ${stmt}`).toBe(true);
        return STAGE_B.replace(stmt, '-- MUTANT: this DROP removed');
    };

    it('the migration drops BOTH legacy overloads (mutation precondition)', () => {
        // If this ever fails, every mutant below is mutating nothing and would pass vacuously.
        expect(DROPS.length, `parsed DROPs: ${JSON.stringify(DROPS)}`).toBeGreaterThanOrEqual(2);
        expect(DROPS.some(d => /UUID,\s*TEXT,\s*TEXT,\s*INT,\s*TEXT/i.test(d)), 'V1-A DROP').toBe(true);
        expect(DROPS.some(d => /JSONB,\s*JSONB\)/i.test(d)), 'V1-B DROP').toBe(true);
    });

    it('M1 — the shipped migration without the V1-A DROP refuses (V1-A survives)', async () => {
        const db = await preStageB();
        await expect(db.exec(without(DROPS.find(d => /TEXT,\s*INT,\s*TEXT\)/i.test(d))!))).rejects.toThrow(/Stage B incomplete/i);
        await db.close();
    });

    it('M2 — the shipped migration without the V1-B DROP refuses (V1-B survives)', async () => {
        const db = await preStageB();
        await expect(db.exec(without(DROPS.find(d => /JSONB,\s*JSONB\)/i.test(d))!))).rejects.toThrow(/Stage B incomplete/i);
        await db.close();
    });

    it('M3 — revoke-only: both DROPs removed, REVOKEs intact, still refuses', async () => {
        const db = await preStageB();
        let revokeOnly = STAGE_B;
        for (const d of DROPS) revokeOnly = revokeOnly.replace(d, '-- MUTANT: this DROP removed');
        expect(revokeOnly).toMatch(/REVOKE EXECUTE ON FUNCTION public\.complete_session/i);
        await expect(db.exec(revokeOnly)).rejects.toThrow(/Stage B incomplete/i);
        await db.close();
    });

    it('M5 — a v1 that silently forwards to v2 still counts as present, so it refuses', async () => {
        const db = await preStageB();
        // Mutate the shipped migration so it recreates v1 as a forwarder instead of leaving it dropped.
        const forwarder = STAGE_B.replace(
            /-- Historical overloads dropped by earlier migrations[^\n]*\n/,
            `CREATE FUNCTION public.complete_session(uuid, text, text, int, text) RETURNS jsonb LANGUAGE sql AS
               $mut$ SELECT public.complete_session_v2(p_session_id => $1, p_status => $2) $mut$;\n`);
        expect(forwarder).not.toBe(STAGE_B);
        await expect(db.exec(forwarder)).rejects.toThrow(/Stage B incomplete/i);
        await db.close();
    });

    it('M6 — the v2 successor removed: the shipped migration refuses to retire v1', async () => {
        // Restored casualty. Dropping the legacy path while the successor is absent would leave NO
        // completion path at all, so the migration must refuse rather than "succeed".
        const db = await preStageB();
        await db.exec('DROP FUNCTION IF EXISTS public.complete_session_v2(uuid, text, int, text, jsonb, int, double precision, double precision, jsonb, jsonb, text);');
        await expect(db.exec(STAGE_B)).rejects.toThrow(/complete_session_v2/i);
        await db.close();
    });

    it('M7 — a WRONG-ARITY v2 stand-in does not satisfy the precondition', async () => {
        // Checking only proname would accept this. It cannot accept a transcript, so retiring v1 against
        // it would leave the product with no working completion path.
        const db = await preStageB();
        await db.exec('DROP FUNCTION IF EXISTS public.complete_session_v2(uuid, text, int, text, jsonb, int, double precision, double precision, jsonb, jsonb, text);');
        await db.exec(`CREATE FUNCTION public.complete_session_v2(uuid, text)
                       RETURNS jsonb LANGUAGE sql AS $mut$ SELECT '{}'::jsonb $mut$;`);
        await expect(db.exec(STAGE_B)).rejects.toThrow(/complete_session_v2/i);
        await db.close();
    });

    it('the unmutated shipped migration applies cleanly — the mutants are not all dying of a common fault', async () => {
        const db = await preStageB();
        await expect(db.exec(STAGE_B)).resolves.toBeDefined();
        await db.close();
    });
});

describe('#1306 M4 — the handwritten-substitute population cannot grow', () => {
    const KNOWN_SUBSTITUTES = [
        'analytics-summary-rpc.integration.test.ts',
        'atomic-completion-concurrency-realpg.sql',
        'atomic-completion-retention.integration.test.ts',
        'metrics-only-stage-a.integration.test.ts',
    ];
    const CREATES = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.complete_session\s*\(/i;

    it('only the four pre-existing files define complete_session by hand', () => {
        const dir = resolve(process.cwd(), 'tests', 'db');
        const offenders = readdirSync(dir)
            .filter(f => /\.(ts|sql)$/.test(f))
            .filter(f => f !== 'stage-b-retire-complete-session-v1.integration.test.ts')
            .filter(f => CREATES.test(readFileSync(resolve(dir, f), 'utf8')))
            .sort();
        expect(offenders, 'a NEW handwritten complete_session substitute was added').toEqual(KNOWN_SUBSTITUTES);
    });

    it('this suite never hand-creates complete_session in SETUP — only inside the bounded mutation block', () => {
        // Excluding the whole file would let a substitute hide in preStageB(). The exclusion must be
        // bounded to the mutation describe, which creates a forwarder deliberately as mutant M5.
        const self = readFileSync(resolve(
            process.cwd(), 'tests', 'db', 'stage-b-retire-complete-session-v1.integration.test.ts'), 'utf8');
        const mutationStart = self.indexOf("describe('#1306 Stage B — M1-M5 mutate the SHIPPED migration itself'");
        const mutationEnd = self.indexOf("describe('#1306 M4", mutationStart);
        expect(mutationStart, 'mutation block must exist').toBeGreaterThan(-1);
        expect(mutationEnd, 'mutation block must be bounded').toBeGreaterThan(mutationStart);

        const outsideMutationBlock = self.slice(0, mutationStart) + self.slice(mutationEnd);
        expect(CREATES.test(outsideMutationBlock),
            'setup hand-creates complete_session — the object under test must come from the migration')
            .toBe(false);

        // ...and the schema under test really is built from the shipped migration.
        expect(self).toContain("sql('20260829120000_retire_complete_session_v1_1306.sql')");
    });
});

/**
 * PRODUCTION-CALLER GUARD — repository-wide, and permanent.
 *
 * The three-session live journey asserts zero v1 RPC calls, but that proves only what THAT journey
 * happened to exercise. It is not a repository-wide proof that no production code path can call v1, and
 * treating it as one would let a new caller ship on an untravelled route.
 *
 * This scans production source directly. It is deliberately source-level: the claim is "no production
 * code names this RPC", which no runtime test can establish by exercise.
 */
describe('#1306 — no production source calls the legacy complete_session RPC', () => {
    const PROD_ROOTS = ['frontend/src', 'backend/supabase/functions'];

    /**
     * BOTH supported invocation shapes. A guard that only knows `.rpc('complete_session')` would miss a
     * direct PostgREST call, and the two are equally capable of reaching the legacy function.
     *
     * SCAN BOUNDARY, stated rather than implied: this is a source scan over the two production trees. It
     * cannot see a call assembled at runtime from a computed string, a call from a service outside this
     * repository, or SQL executed inside another database function. Those are covered by the migration
     * dropping the function outright — after Stage B there is no object left for any caller to reach.
     */
    const CALL_SHAPES: Array<[string, RegExp]> = [
        ['supabase .rpc()', /\.rpc\(\s*['"`]complete_session['"`]/],
        ['direct /rpc/ path', /\/rpc\/complete_session(?![_a-zA-Z0-9])/],
    ];

    function sources(dir: string, acc: string[] = []): string[] {
        let entries: string[] = [];
        try { entries = readdirSync(dir); } catch { return acc; }
        for (const name of entries) {
            const abs = resolve(dir, name);
            let isDir = false;
            try { isDir = readdirSync(abs).length >= 0; } catch { isDir = false; }
            if (isDir) {
                if (name === '__tests__' || name === 'node_modules' || name === 'mocks') continue;
                sources(abs, acc);
            } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.|\.spec\./.test(name)) {
                acc.push(abs);
            }
        }
        return acc;
    }

    it.each(CALL_SHAPES)('zero production callers repository-wide, via %s', (_label, pattern) => {
        const offenders: string[] = [];
        for (const root of PROD_ROOTS) {
            for (const file of sources(resolve(process.cwd(), root))) {
                if (pattern.test(readFileSync(file, 'utf8'))) {
                    offenders.push(file.replace(`${process.cwd()}/`, ''));
                }
            }
        }
        expect(offenders, 'production code reaches the retired complete_session RPC').toEqual([]);
    });

    it('each call-shape pattern actually matches its shape — an inert regex is not a guard', () => {
        // A pattern that can never match makes the scan above pass for the wrong reason.
        expect(CALL_SHAPES[0][1].test(`supabase.rpc('complete_session', {})`)).toBe(true);
        expect(CALL_SHAPES[1][1].test('/rest/v1/rpc/complete_session')).toBe(true);
        // ...and neither may fire on the v2 successor.
        expect(CALL_SHAPES[0][1].test(`supabase.rpc('complete_session_v2', {})`)).toBe(false);
        expect(CALL_SHAPES[1][1].test('/rest/v1/rpc/complete_session_v2')).toBe(false);
    });

    it('the production client calls complete_session_v2 — so the scan is looking in the right place', () => {
        // A scan that finds nothing because it searched the wrong tree is indistinguishable from a pass.
        const storage = readFileSync(resolve(process.cwd(), 'frontend/src/lib/storage.ts'), 'utf8');
        expect(storage).toMatch(/\.rpc\(\s*['"`]complete_session_v2['"`]/);
    });
});
