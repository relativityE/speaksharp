// @vitest-environment node
// Regression for expired-trial preflight, NOT proof of the complete post-expiry product policy.
// Payment-page routing and denying Progress/history/reviews/export still need separate implementation/proof.
// This local PostgreSQL fixture loads every versioned migration, not an obsolete RPC or a mocked resolver.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'backend/supabase/migrations');
// Same minimal platform bootstrap as trial-session-v2-current-chain.integration.test.ts.
const BOOTSTRAP = `
CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE anon;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $f$ SELECT gen_random_uuid() $f$;
CREATE SCHEMA extensions; CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $f$ SELECT string_to_array(name,'/') $f$;
`;
type Preflight = { can_start: boolean; error?: string; is_pro: boolean; trial_active: boolean; trial_seconds_remaining: number };
const assertDenied = (result: Preflight) => expect(result).toMatchObject({
  can_start: false, error: 'trial_expired', is_pro: false, trial_active: false, trial_seconds_remaining: 0,
});

describe('current-chain trial preflight regression', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(BOOTSTRAP);
    for (const file of readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
      await db.exec(readFileSync(resolve(DIR, file), 'utf8'));
    }
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  async function signup(): Promise<string> {
    const uid = randomUUID();
    await db.query('INSERT INTO auth.users (id,email) VALUES ($1,$2)', [uid, `expiry-${uid}@example.test`]);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
    return uid;
  }
  async function preflight(): Promise<Preflight> {
    await db.exec('SET ROLE authenticated');
    try {
      return (await db.query<{ result: Preflight }>('SELECT public.check_usage_limit() AS result')).rows[0].result;
    } finally { await db.exec('RESET ROLE'); }
  }

  it('allows the granted trial, denies unpaid expiry, and restores preflight after paid activation', async () => {
    const uid = await signup();
    expect(await preflight()).toMatchObject({ can_start: true, is_pro: true, trial_active: true });
    await db.query("UPDATE public.user_profiles SET trial_expires_at = now() - interval '1 second' WHERE id=$1", [uid]);
    assertDenied(await preflight());
    // This models a successfully processed payment, not a Stripe/webhook integration proof.
    await db.query("UPDATE public.user_profiles SET subscription_status='pro', stripe_subscription_id='sub_test_paid' WHERE id=$1", [uid]);
    expect(await preflight()).toMatchObject({ can_start: true, is_pro: true, trial_active: false });
  });

  it('denies at the exact server expiry boundary (same transaction clock)', async () => {
    const uid = await signup();
    await db.exec('BEGIN');
    try {
      await db.query('UPDATE public.user_profiles SET trial_expires_at=now() WHERE id=$1', [uid]);
      expect(await preflight()).toMatchObject({
        can_start: false, error: 'trial_expired', is_pro: false, trial_active: false, trial_seconds_remaining: 0,
      });
    } finally { await db.exec('ROLLBACK'); }
  });

  it('negative control: removing only the installed preflight denial breaks the same assertion', async () => {
    const uid = await signup();
    await db.query("UPDATE public.user_profiles SET trial_expires_at=now() - interval '1 second' WHERE id=$1", [uid]);
    assertDenied(await preflight());
    const original = (await db.query<{ definition: string }>(
      "SELECT pg_get_functiondef('public.check_usage_limit()'::regprocedure) AS definition",
    )).rows[0].definition;
    const gate = "IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN";
    expect(original.split(gate)).toHaveLength(2);
    try {
      await db.exec(original.replace(gate, 'IF false THEN'));
      const mutant = await preflight();
      expect(mutant.can_start).toBe(true); // semantic failure, not setup/permission failure
      expect(() => assertDenied(mutant)).toThrow();
    } finally { await db.exec(original); }
    assertDenied(await preflight());
  });
  // #1863 added a second reader of the same expiry: the payment wall (RLS and guarded RPCs) through
  // current_account_has_product_access(). If the two ever disagree, a user can start a take the wall then refuses to
  // save, or is told to pay while the wall still serves their saved work. Pin that they agree on every expiry state.
  const STATES: Array<[string, string]> = [
    ['active marked trial', "trial_expires_at=now()+interval '1 day'"],
    ['exact expiry instant', 'trial_expires_at=now()'],
    ['one second past expiry', "trial_expires_at=now()-interval '1 second'"],
    ['bare pro label after expiry (no Stripe subscription)', "trial_expires_at=now()-interval '1 second', subscription_status='pro', stripe_subscription_id=NULL"],
    ['paid after expiry', "trial_expires_at=now()-interval '1 second', subscription_status='pro', stripe_subscription_id='sub_test_agree_'||id::text"],
  ];
  async function verdicts(uid: string, set: string): Promise<{ canStart: boolean; access: boolean }> {
    await db.exec('BEGIN'); // one transaction, so both readers see the same now()
    try {
      await db.query(`UPDATE public.user_profiles SET ${set} WHERE id=$1`, [uid]);
      const canStart = (await preflight()).can_start;
      await db.exec('SET ROLE authenticated');
      try {
        const access = (await db.query<{ a: boolean }>('SELECT public.current_account_has_product_access() AS a')).rows[0].a;
        return { canStart, access };
      } finally { await db.exec('RESET ROLE'); }
    } finally { await db.exec('ROLLBACK'); }
  }

  it('preflight and the #1863 payment wall give the same answer for every expiry state', async () => {
    const uid = await signup();
    const seen: Array<[string, { canStart: boolean; access: boolean }]> = [];
    for (const [name, set] of STATES) seen.push([name, await verdicts(uid, set)]);
    // Each state as [name, preflight can_start, wall access]: a disagreement names its state in the diff.
    expect(seen.map(([name, v]) => [name, v.canStart, v.access])).toEqual(seen.map(([name, v]) => [name, v.access, v.access]));
    expect(Object.fromEntries(seen.map(([n, v]) => [n, v.access]))).toEqual({
      'active marked trial': true, 'exact expiry instant': false, 'one second past expiry': false,
      'bare pro label after expiry (no Stripe subscription)': false, 'paid after expiry': true,
    });
  });

  it('negative control: a preflight with its own inclusive expiry check disagrees with the wall at the expiry instant', async () => {
    const uid = await signup();
    const original = (await db.query<{ definition: string }>(
      "SELECT pg_get_functiondef('public.check_usage_limit()'::regprocedure) AS definition",
    )).rows[0].definition;
    const gate = "IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN";
    expect(original.split(gate)).toHaveLength(2);
    try {
      // A plausible drift: preflight re-derives expiry itself and treats the expiry instant as still in trial.
      await db.exec(original.replace(gate, "IF COALESCE(v_effective_tier, 'free') <> 'pro' AND NOT (v_trial_expires_at >= now()) THEN"));
      const v = await verdicts(uid, 'trial_expires_at=now()');
      expect(v).toEqual({ canStart: true, access: false }); // the agreement assertion above would fail here
    } finally { await db.exec(original); }
    expect(await verdicts(uid, 'trial_expires_at=now()')).toEqual({ canStart: false, access: false });
  });
});
