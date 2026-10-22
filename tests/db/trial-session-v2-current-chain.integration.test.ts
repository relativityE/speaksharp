// @vitest-environment node
//
// #1593 test-audit RF-1 — the trial save rules on the SHIPPED save path.
//
// trial-journey.integration.test.ts and trial-commercial-matrix.sql prove the expired-trial save denial and the
// 900 → 600 completion clamp through the legacy `complete_session` (v1), which 20260829120000 dropped. The shipped save
// path is `complete_session_v2` (current definition 20260908120000). This suite applies EVERY shipped versioned
// migration in order over a minimal Supabase bootstrap, so the tier resolver, signup trigger, recording lease, create and
// v2 are the real ones: no tier stub, no hand-written function. Each rule also has a mutant of the shipped v2 with that
// one rule removed, which must fail only its own assertion — so the cases are proven able to fail.
//
// Content-free: synthetic identifiers and text only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const SHIPPED = readdirSync(DIR).filter((f) => /^\d{8,14}_.+\.sql$/.test(f)).sort();
const V2_FILE = '20260908120000_transcript_retention_newest_one.sql';

/** Only what Supabase provides outside the migrations: roles, auth.users/uid, uuid-ossp's v4, and storage tables. */
const SUPABASE_BOOTSTRAP = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $f$ SELECT gen_random_uuid() $f$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $f$ SELECT string_to_array(name,'/') $f$;
`;

/** The shipped complete_session_v2 definition, verbatim, for building single-rule mutants. */
const SHIPPED_V2 = (() => {
    const src = readFileSync(resolve(DIR, V2_FILE), 'utf8');
    const start = src.lastIndexOf('CREATE OR REPLACE FUNCTION public.complete_session_v2(');
    return src.slice(start, src.indexOf('\n$$;', start) + 4);
})();
const TIER_CHECK = "IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN";
const CLAMP = 'LEAST(600, GREATEST(';

async function shippedChain(mutant?: string): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(SUPABASE_BOOTSTRAP);
    for (const f of SHIPPED) await db.exec(readFileSync(resolve(DIR, f), 'utf8'));
    if (mutant) await db.exec(mutant);
    return db;
}

const NEXT_ACTION = JSON.stringify({
    reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
    value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
});

interface TakeResult {
    tier: string;
    result: Record<string, unknown>;
    row: { status: string; duration: number; transcript: string | null };
}

/**
 * One real take: unique synthetic signup (profile + immutable grant via the shipped trigger), a live recording lease,
 * an active session from the shipped create, then the shipped v2 completion with named arguments and a final 900 s.
 * `expire` ends the trial after the take started, so the save — not the start — is the decision under test.
 */
async function take(db: PGlite, expire: boolean): Promise<TakeResult> {
    const uid = randomUUID();
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [uid, `rf1-${uid}@example.test`]);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    const lease = randomUUID();
    let sessionId = '';
    await db.exec('SET ROLE authenticated');
    try {
        const acquired = (await db.query<{ r: { acquired: boolean } }>(
            `SELECT public.acquire_recording_lease($1::uuid, 'rf1', false) AS r`, [lease])).rows[0].r;
        expect(acquired.acquired).toBe(true);
        const created = (await db.query<{ r: { new_session: { id: string } | null; error?: string } }>(
            `SELECT public.create_session_and_update_usage($1::jsonb, 'private') AS r`,
            [JSON.stringify({ title: 'rf1', duration: 0, total_words: 0, lease_id: lease })])).rows[0].r;
        expect(created.error ?? null).toBeNull();
        sessionId = created.new_session!.id;
    } finally {
        await db.exec('RESET ROLE');
    }
    if (expire) await db.query(`UPDATE public.user_profiles SET trial_expires_at = now() - interval '1 second' WHERE id = $1`, [uid]);
    const tier = (await db.query<{ t: string }>(
        `SELECT public.effective_subscription_tier(subscription_status, trial_expires_at, stripe_subscription_id, subscription_id,
                                                    commercial_trial_granted_at) AS t FROM public.user_profiles WHERE id = $1`, [uid])).rows[0].t;
    await db.exec('SET ROLE authenticated');
    let result: Record<string, unknown>;
    try {
        result = (await db.query<{ r: Record<string, unknown> }>(
            `SELECT public.complete_session_v2(
                 p_session_id => $1::uuid, p_status => 'completed', p_final_duration => 900, p_next_action => $2::jsonb,
                 p_total_words => 120, p_clarity_score => 80, p_wpm => 130, p_filler_counts => '{}'::jsonb,
                 p_final_transcript => 'synthetic rf1 words') AS r`, [sessionId, NEXT_ACTION])).rows[0].r;
    } finally {
        await db.exec('RESET ROLE');
    }
    const row = (await db.query<TakeResult['row']>(
        `SELECT status, duration, transcript FROM public.sessions WHERE id = $1`, [sessionId])).rows[0];
    return { tier, result, row };
}

describe('#1593 RF-1 — trial save rules on the shipped complete_session_v2 (all shipped migrations, real tier)', () => {
    let db: PGlite;
    beforeAll(async () => { db = await shippedChain(); }, 120_000);
    afterAll(async () => { await db.close(); });

    it('the shipped chain has v2 and no v1, with the function-specific search_path each function declares', async () => {
        const fns = (await db.query<{ proname: string; proconfig: string[] | null }>(
            `SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('complete_session', 'complete_session_v2',
                    'create_session_and_update_usage', 'ensure_trial_profile_for_new_user')
              ORDER BY p.proname`)).rows;
        expect(fns.map((f) => f.proname)).toEqual(['complete_session_v2', 'create_session_and_update_usage', 'ensure_trial_profile_for_new_user']);
        const config = Object.fromEntries(fns.map((f) => [f.proname, f.proconfig]));
        expect(config.complete_session_v2).toEqual(['search_path=public, pg_temp']);
        expect(config.create_session_and_update_usage).toEqual(['search_path=public, pg_temp']);
        // The latest signup definition pins an EMPTY search_path, not the matrix's historical public,pg_temp.
        expect(config.ensure_trial_profile_for_new_user).toEqual(['search_path=""']);
    });

    it('an active trial saves a 900-second take as completed, clamped to the 600-second cap', async () => {
        const { tier, result, row } = await take(db, false);
        expect(tier).toBe('pro');
        expect(result.success).toBe(true);
        expect(row).toEqual({ status: 'completed', duration: 600, transcript: 'synthetic rf1 words' });
    });

    it('a trial that expired after the take started is refused at save: trial_expired, the row unchanged', async () => {
        const { tier, result, row } = await take(db, true);
        expect(tier).toBe('free');
        expect(result).toMatchObject({ success: false, error: 'trial_expired' });
        expect(row).toEqual({ status: 'active', duration: 0, transcript: null });
    });
});

describe('#1593 RF-1 — each rule is load-bearing: a shipped-v2 mutant without it fails only its own case', () => {
    it('CONTROL: the mutation targets exist verbatim in the shipped v2 (so a mutant is a one-rule change, not a no-op)', () => {
        expect(SHIPPED_V2.split(TIER_CHECK)).toHaveLength(2);
        expect(SHIPPED_V2.split(CLAMP)).toHaveLength(2);
    });

    it('MUTANT without the tier check: the expired take saves (the denial case would fail); the clamp still holds', async () => {
        const db = await shippedChain(SHIPPED_V2.replace(TIER_CHECK, 'IF false THEN'));
        try {
            const expired = await take(db, true);
            expect(expired.tier).toBe('free');
            expect(expired.result.success).toBe(true);
            expect(expired.row.status).toBe('completed');
            const active = await take(db, false);
            expect(active.row).toEqual({ status: 'completed', duration: 600, transcript: 'synthetic rf1 words' });
        } finally { await db.close(); }
    }, 120_000);

    it('MUTANT without the 600-second clamp: the active take saves 900 (the clamp case would fail); denial still holds', async () => {
        const db = await shippedChain(SHIPPED_V2.replace(CLAMP, 'LEAST(2147483647, GREATEST('));
        try {
            const active = await take(db, false);
            expect(active.result.success).toBe(true);
            expect(active.row.duration).toBe(900);
            const expired = await take(db, true);
            expect(expired.result).toMatchObject({ success: false, error: 'trial_expired' });
            expect(expired.row).toEqual({ status: 'active', duration: 0, transcript: null });
        } finally { await db.close(); }
    }, 120_000);
});
