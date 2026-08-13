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
const FOUNDATION = MIG('20260812040000_thirty_day_trial_lifecycle_1282.sql');
const ENFORCEMENT = MIG('20260812041000_trial_expiry_fail_closed_1282.sql');

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
    `SELECT public.effective_subscription_tier(subscription_status, trial_expires_at, stripe_subscription_id, subscription_id,
                                                commercial_trial_granted_at) AS t
     FROM public.user_profiles WHERE id='${USER}'`)).rows[0].t;
/** Attempt to record `seconds` on `engine`; returns the RPC error (null on success). */
const record = async (db: PGlite, engine: string, seconds = 60): Promise<string | null> => {
  await act(db);
  return (await db.query<{ error: string | null }>(
    `SELECT (public.update_user_usage(${seconds}, '${engine}', gen_random_uuid()) ->> 'error') AS error`)).rows[0].error;
};

const TRIAL_ACTIVE = `INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at, commercial_trial_granted_at)
  VALUES ('${USER}', 'free', now() - interval '5 days', now() + interval '25 days', now() - interval '5 days')`;
const TRIAL_EXPIRED = `INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at, commercial_trial_granted_at)
  VALUES ('${USER}', 'free', now() - interval '40 days', now() - interval '10 days', now() - interval '40 days')`;
const PAID = `INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id)
  VALUES ('${USER}', 'pro', 'sub_paid')`;

describe('#1282 trial/expiry + Private-only journey (executed in PGlite)', () => {
  it('new-account provisioning atomically stamps one immutable 30-day commercial grant', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(FOUNDATION);
    await db.exec(`CREATE TRIGGER on_auth_user_created_trial
      AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user()`);
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${USER}')`);
    const row = (await db.query<{ marked: boolean; seconds: number }>(
      `SELECT commercial_trial_granted_at IS NOT NULL AS marked,
              EXTRACT(EPOCH FROM (trial_expires_at - trial_started_at))::int AS seconds
       FROM public.user_profiles WHERE id='${USER}'`,
    )).rows[0];
    expect(row.marked).toBe(true);
    expect(row.seconds).toBe(30 * 24 * 60 * 60);
    await expect(db.exec(`UPDATE public.user_profiles SET commercial_trial_granted_at = NULL WHERE id='${USER}'`))
      .rejects.toThrow(/immutable/);
    await db.close();
  });

  it('a live trial resolves to effective pro and records ONLY via the Private engine', async () => {
    const db = await make(TRIAL_ACTIVE);
    expect(await tier(db)).toBe('pro');
    expect(await record(db, 'private')).toBeNull(); // exact customer Private token succeeds
    for (const forbidden of ['cloud', 'browser', 'native', 'transformers-js', 'whisper-turbo', 'transformers-js-v4', 'private-v4']) {
      expect(await record(db, forbidden)).toBe('engine_not_allowed_for_tier');
    }
    await db.close();
  });

  it('a paid account resolves to pro and is likewise Private-only (unaffected by trial state)', async () => {
    const db = await make(PAID);
    expect(await tier(db)).toBe('pro');
    expect(await record(db, 'private')).toBeNull();
    for (const forbidden of ['cloud', 'browser', 'native', 'transformers-js', 'whisper-turbo', 'transformers-js-v4', 'private-v4']) {
      expect(await record(db, forbidden)).toBe('engine_not_allowed_for_tier');
    }
    await db.close();
  });

  it('an EXPIRED unpaid trial fails closed: no new recording, even via Private', async () => {
    const db = await make(TRIAL_EXPIRED);
    expect(await tier(db)).toBe('free');
    expect(await record(db, 'private')).toBe('trial_expired'); // fail closed — cannot start a new recording
    await db.close();
  });

  it('boundary: just-before expiry records; just-after expiry fails closed', async () => {
    const before = await make(`INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at, commercial_trial_granted_at)
      VALUES ('${USER}', 'free', now() - interval '30 days', now() + interval '60 seconds', now() - interval '30 days')`);
    expect(await tier(before)).toBe('pro');
    expect(await record(before, 'private')).toBeNull();
    await before.close();

    const after = await make(`INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at, commercial_trial_granted_at)
      VALUES ('${USER}', 'free', now() - interval '30 days', now() - interval '60 seconds', now() - interval '30 days')`);
    expect(await tier(after)).toBe('free');
    expect(await record(after, 'private')).toBe('trial_expired');
    await after.close();
  });

  it('exact expiry is denied and an unmarked legacy window cannot grant access', async () => {
    const exact = await make(`INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at, commercial_trial_granted_at)
      VALUES ('${USER}', 'free', now() - interval '30 days', now(), now() - interval '30 days')`);
    expect(await record(exact, 'private')).toBe('trial_expired');
    await exact.close();

    const unmarked = await make(`INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at)
      VALUES ('${USER}', 'free', now(), now() + interval '30 days')`);
    expect(await record(unmarked, 'private')).toBe('trial_expired');
    await unmarked.close();
  });

  it('client-clock claims cannot extend or shorten the server-authoritative window', async () => {
    const active = await make(TRIAL_ACTIVE);
    await active.exec(`SELECT set_config('app.client_now', '2099-01-01T00:00:00Z', false)`);
    expect(await record(active, 'private')).toBeNull();
    await active.close();

    const expired = await make(TRIAL_EXPIRED);
    await expired.exec(`SELECT set_config('app.client_now', '2000-01-01T00:00:00Z', false)`);
    expect(await record(expired, 'private')).toBe('trial_expired');
    await expired.close();
  });

  it('legacy sample exhaustion and former daily/monthly thresholds never deny active trial or paid use', async () => {
    for (const entitlement of [TRIAL_ACTIVE, PAID]) {
      const db = await make(entitlement);
      await db.exec(`UPDATE public.user_profiles
        SET private_sample_seconds_used = 300, daily_usage_seconds = 7201,
            native_usage_seconds = 180001, cloud_usage_seconds = 180001
        WHERE id = '${USER}'`);
      expect(await record(db, 'private')).toBeNull();
      const limit = (await db.query<{ can_start: string; daily_limit: string }>(
        `SELECT public.check_usage_limit()->>'can_start' AS can_start,
                public.check_usage_limit()->>'daily_limit' AS daily_limit`,
      )).rows[0];
      expect(limit.can_start).toBe('true');
      expect(limit.daily_limit).toBe('-1');
      await db.close();
    }
  });

  it('expiry is rechecked at save time and the 600-second per-recording safety cap is shared', async () => {
    const active = await make(TRIAL_ACTIVE);
    await act(active);
    const sessionId = '00000000-0000-0000-0000-0000000000d1';
    await active.exec(`INSERT INTO public.sessions (id, user_id, duration, status) VALUES ('${sessionId}', '${USER}', 0, 'active')`);
    const saved = (await active.query<{ success: string }>(
      `SELECT public.complete_session('${sessionId}', 'completed', 'safe transcript', 900, NULL)->>'success' AS success`,
    )).rows[0];
    expect(saved.success).toBe('true');
    expect((await active.query<{ duration: number }>(`SELECT duration FROM public.sessions WHERE id='${sessionId}'`)).rows[0].duration).toBe(600);
    await active.close();

    const expired = await make(TRIAL_EXPIRED);
    await act(expired);
    await expired.exec(`INSERT INTO public.sessions (id, user_id, duration, status) VALUES ('${sessionId}', '${USER}', 0, 'active')`);
    const denied = (await expired.query<{ error: string }>(
      `SELECT public.complete_session('${sessionId}', 'completed', 'must not persist', 60, NULL)->>'error' AS error`,
    )).rows[0];
    expect(denied.error).toBe('trial_expired');
    expect((await expired.query<{ transcript: string | null }>(`SELECT transcript FROM public.sessions WHERE id='${sessionId}'`)).rows[0].transcript).toBeNull();
    await expired.close();
  });

  it("the enforcement migration restricts tier_configs.pro to Private-only (no cloud/browser/native)", async () => {
    const db = await make(TRIAL_ACTIVE);
    const engines = (await db.query<{ allowed_engines: string[] }>(
      `SELECT allowed_engines FROM public.tier_configs WHERE tier_name='pro'`)).rows[0].allowed_engines;
    expect(engines).toEqual(['private']);
    expect(engines).not.toContain('cloud');
    expect(engines).not.toContain('browser');
    expect(engines).not.toContain('native');
    await db.close();
  });
});
