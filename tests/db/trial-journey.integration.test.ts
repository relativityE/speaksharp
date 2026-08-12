// #1282 blockers 6 + 7 — EXECUTED trial/expiry/Private-only journey (real PostgreSQL via PGlite). Applies
// the trial foundation + enforcement migrations VERBATIM and exercises effective_subscription_tier +
// update_user_usage across the lifecycle. Proves: trial/paid grant full product via the PRIVATE engine ONLY
// (Browser/Cloud/Native rejected); expiry fails closed for new recording; paid is unaffected.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'trial-journey-bootstrap.sql'), 'utf8');
const FOUNDATION = MIG('20260812000000_thirty_day_trial_lifecycle_1282.sql');
const ENFORCEMENT = MIG('20260812001000_trial_expiry_fail_closed_1282.sql');

const USER = '00000000-0000-0000-0000-0000000000a1';

async function make(seed: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(FOUNDATION);
  await db.exec(ENFORCEMENT); // also restricts tier_configs.pro to Private-only (blocker 6)
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${USER}')`);
  await db.exec(seed);
  return db;
}
const act = (db: PGlite) => db.query(`SELECT set_config('request.jwt.claim.sub', '${USER}', false)`);
const tier = async (db: PGlite): Promise<string> =>
  (await db.query<{ t: string }>(
    `SELECT public.effective_subscription_tier(subscription_status, trial_expires_at, stripe_subscription_id, subscription_id) AS t
     FROM public.user_profiles WHERE id='${USER}'`)).rows[0].t;
/** Attempt to record `seconds` on `engine`; returns the RPC error (null on success). */
const record = async (db: PGlite, engine: string): Promise<string | null> => {
  await act(db);
  return (await db.query<{ error: string | null }>(
    `SELECT (public.update_user_usage(60, '${engine}', gen_random_uuid()) ->> 'error') AS error`)).rows[0].error;
};

const TRIAL_ACTIVE = `INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at)
  VALUES ('${USER}', 'free', now() - interval '5 days', now() + interval '25 days')`;
const TRIAL_EXPIRED = `INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at)
  VALUES ('${USER}', 'free', now() - interval '40 days', now() - interval '10 days')`;
const PAID = `INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id)
  VALUES ('${USER}', 'pro', 'sub_paid')`;

describe('#1282 trial/expiry + Private-only journey (executed in PGlite)', () => {
  it('a live trial resolves to effective pro and records ONLY via the Private engine', async () => {
    const db = await make(TRIAL_ACTIVE);
    expect(await tier(db)).toBe('pro');
    expect(await record(db, 'private')).toBeNull();                          // customer Private token succeeds
    expect(await record(db, 'cloud')).toBe('engine_not_allowed_for_tier');   // Cloud is not a customer entitlement
    expect(await record(db, 'browser')).toBe('engine_not_allowed_for_tier'); // Browser is not a customer entitlement
    expect(await record(db, 'native')).toBe('engine_not_allowed_for_tier');  // Native is internal-only, never customer
    await db.close();
  });

  it('a paid account resolves to pro and is likewise Private-only (unaffected by trial state)', async () => {
    const db = await make(PAID);
    expect(await tier(db)).toBe('pro');
    expect(await record(db, 'private')).toBeNull();
    expect(await record(db, 'cloud')).toBe('engine_not_allowed_for_tier');
    await db.close();
  });

  it('an EXPIRED unpaid trial fails closed: no new recording, even via Private', async () => {
    const db = await make(TRIAL_EXPIRED);
    expect(await tier(db)).toBe('free');
    expect(await record(db, 'private')).toBe('trial_expired'); // fail closed — cannot start a new recording
    await db.close();
  });

  it('boundary: just-before expiry records; just-after expiry fails closed', async () => {
    const before = await make(`INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at)
      VALUES ('${USER}', 'free', now() - interval '30 days', now() + interval '60 seconds')`);
    expect(await tier(before)).toBe('pro');
    expect(await record(before, 'private')).toBeNull();
    await before.close();

    const after = await make(`INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at)
      VALUES ('${USER}', 'free', now() - interval '30 days', now() - interval '60 seconds')`);
    expect(await tier(after)).toBe('free');
    expect(await record(after, 'private')).toBe('trial_expired');
    await after.close();
  });

  it("the enforcement migration restricts tier_configs.pro to Private-only (no cloud/browser/native)", async () => {
    const db = await make(TRIAL_ACTIVE);
    const engines = (await db.query<{ allowed_engines: string[] }>(
      `SELECT allowed_engines FROM public.tier_configs WHERE tier_name='pro'`)).rows[0].allowed_engines;
    expect(engines).toContain('private');
    expect(engines).not.toContain('cloud');
    expect(engines).not.toContain('browser');
    expect(engines).not.toContain('native');
    await db.close();
  });
});
