// #1287 — EXECUTED proof (real PostgreSQL via PGlite) for the canonical-snapshot webhook DB prerequisite.
// Entitlement is decided by the CURRENT Stripe subscription state the Edge hydrates and passes, NOT by
// event action or arrival order — so unordered and same-second delivery converge. Applies the migration
// VERBATIM over a production-shaped bootstrap and executes apply_stripe_subscription_snapshot.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260812002000_webhook_lifecycle_completeness_1282.sql'),
  'utf8',
);
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'webhook-lifecycle-bootstrap.sql'), 'utf8');

const USER = '00000000-0000-0000-0000-0000000000a1';
const SUB = 'sub_test_1287';
const CUS = 'cus_test_1287';

async function freshDbWithPaidPro() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION); // adds the audit column + the snapshot RPC (proves the ADD COLUMN too)
  await db.exec(
    `INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id, stripe_customer_id)
     VALUES ('${USER}', 'pro', '${SUB}', '${CUS}')`,
  );
  return db;
}

type Profile = { subscription_status: string; stripe_subscription_id: string | null; stripe_customer_id: string | null };
const profile = async (db: PGlite): Promise<Profile> =>
  (await db.query<Profile>(
    `SELECT subscription_status, stripe_subscription_id, stripe_customer_id FROM public.user_profiles WHERE id = '${USER}'`,
  )).rows[0];

const tier = async (db: PGlite): Promise<string> =>
  (await db.query<{ t: string }>(
    `SELECT public.effective_subscription_tier(subscription_status, trial_expires_at, stripe_subscription_id, subscription_id) AS t
     FROM public.user_profiles WHERE id = '${USER}'`,
  )).rows[0].t;

type Rpc = { success: string | null; skipped: string | null; entitlement: string | null; error: string | null };
/** Apply a canonical snapshot: the CURRENT Stripe subscription status the Edge hydrated. */
const snapshot = async (db: PGlite, eventId: string, status: string, created: number, userId?: string): Promise<Rpc> =>
  (await db.query<Rpc>(
    `SELECT r->>'success' AS success, r->>'skipped' AS skipped, r->>'entitlement' AS entitlement, r->>'error' AS error
     FROM (SELECT public.apply_stripe_subscription_snapshot(
        '${eventId}', '${SUB}', '${CUS}', '${status}', false, NULL, ${userId ? `'${userId}'` : 'NULL'}, ${created}) AS r) x`,
  )).rows[0];

describe('#1287 canonical subscription snapshot (executed in PGlite)', () => {
  it('active -> Pro; past_due -> Free but KEEPS the sub id (recoverable); active again -> Pro restored', async () => {
    const db = await freshDbWithPaidPro();
    expect(await tier(db)).toBe('pro');

    expect((await snapshot(db, 'e1', 'past_due', 1000)).error).toBeNull();
    let p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBe(SUB);      // recoverable lapse keeps the id
    expect(await tier(db)).toBe('free');

    expect((await snapshot(db, 'e2', 'active', 2000)).entitlement).toBe('pro');
    p = await profile(db);
    expect(p.subscription_status).toBe('pro');
    expect(p.stripe_subscription_id).toBe(SUB);
    expect(await tier(db)).toBe('pro');               // recovery restores Pro
    await db.close();
  });

  it('canceled -> Free and CLEARS the sub id; a later active snapshot cannot reactivate', async () => {
    const db = await freshDbWithPaidPro();
    expect((await snapshot(db, 'e_cancel', 'canceled', 5000)).error).toBeNull();
    let p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBeNull();     // terminal clears the id
    expect(p.stripe_customer_id).toBe(CUS);          // customer id preserved

    // A stale/duplicate 'active' snapshot for the dead subscription id matches nothing → no reactivation.
    const stale = await snapshot(db, 'e_stale', 'active', 1000);
    expect(stale.error).toBeNull();
    p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(await tier(db)).toBe('free');
    await db.close();
  });

  it('same-second failure→renew and renew→failure BOTH converge to the current (hydrated) snapshot', async () => {
    // The Edge hydrates the CURRENT Stripe subscription; both same-second events carry that same status.
    // Case A: current is 'active' (renewal won at Stripe) — both events apply active → Pro.
    const dbA = await freshDbWithPaidPro();
    await snapshot(dbA, 'a1', 'active', 1000); // same created time
    await snapshot(dbA, 'a2', 'active', 1000);
    expect((await profile(dbA)).subscription_status).toBe('pro');
    await dbA.close();

    // Case B: current is 'past_due' (failure won at Stripe) — both events apply past_due → Free, id kept.
    const dbB = await freshDbWithPaidPro();
    await snapshot(dbB, 'b1', 'past_due', 1000);
    await snapshot(dbB, 'b2', 'past_due', 1000);
    const p = await profile(dbB);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBe(SUB);
    await dbB.close();
  });

  it('duplicate event id is idempotent (skipped, no double application)', async () => {
    const db = await freshDbWithPaidPro();
    await snapshot(db, 'dup', 'past_due', 1000);
    const replay = await snapshot(db, 'dup', 'active', 2000); // same id, different status
    expect(replay.skipped).toBe('true'); // ignored — the first application stands
    expect((await profile(db)).subscription_status).toBe('free'); // not flipped to pro by the replay
    await db.close();
  });

  it('first activation binds by user id (active) and sets the subscription id', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(MIGRATION);
    await db.exec(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${USER}', 'free')`);
    const r = await snapshot(db, 'e_first', 'active', 1000, USER); // p_user_id present
    expect(r.entitlement).toBe('pro');
    const p = await profile(db);
    expect(p.subscription_status).toBe('pro');
    expect(p.stripe_subscription_id).toBe(SUB);
    expect(await tier(db)).toBe('pro');
    await db.close();
  });

  it('the snapshot RPC is service_role-only (least privilege)', async () => {
    const db = await freshDbWithPaidPro();
    const acl = (await db.query<{ has: boolean }>(
      `SELECT has_function_privilege('anon',
        'public.apply_stripe_subscription_snapshot(text,text,text,text,boolean,bigint,uuid,bigint)', 'EXECUTE') AS has`,
    )).rows[0];
    expect(acl.has).toBe(false); // anon cannot execute
    await db.close();
  });

  it('an active snapshot for an UNKNOWN subscription id FAILS CLOSED (no silent zero-row success)', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(MIGRATION);
    // A profile exists, but bound to a DIFFERENT subscription id — SUB maps to nobody and is not terminal.
    await db.exec(
      `INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id, stripe_customer_id)
       VALUES ('${USER}', 'pro', 'sub_other', 'cus_other')`,
    );
    const r = await snapshot(db, 'e_unknown', 'active', 1000); // later-event path, no user id, SUB unbound
    expect(r.success).toBe('false');            // fail closed -> Edge returns non-2xx -> Stripe retries
    expect(r.error).not.toBeNull();
    const p = await profile(db);                // the unrelated profile is untouched
    expect(p.subscription_status).toBe('pro');
    expect(p.stripe_subscription_id).toBe('sub_other');
    await db.close();
  });

  it('first binding REJECTS a subscription id already bound to another profile (no cross-profile rebind)', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(MIGRATION);
    const OTHER = '00000000-0000-0000-0000-0000000000b9';
    // SUB already belongs to OTHER (with its own customer); a checkout binding for USER must not steal it.
    await db.exec(
      `INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id, stripe_customer_id)
       VALUES ('${OTHER}', 'pro', '${SUB}', 'cus_other')`,
    );
    await db.exec(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${USER}', 'free')`);
    const r = await snapshot(db, 'e_collide', 'active', 1000, USER);
    expect(r.success).toBe('false');
    expect(r.error).not.toBeNull();
    expect((await profile(db)).subscription_status).toBe('free'); // USER stays free
    const other = (await db.query<{ s: string }>(
      `SELECT stripe_subscription_id AS s FROM public.user_profiles WHERE id='${OTHER}'`)).rows[0];
    expect(other.s).toBe(SUB); // OTHER keeps its subscription
    await db.close();
  });

  it('first binding REJECTS a profile that already holds a different live subscription id (conflicting billing identity)', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(MIGRATION);
    // USER already has a live subscription; a new checkout for a different sub must fail closed, not overwrite.
    await db.exec(
      `INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id, stripe_customer_id)
       VALUES ('${USER}', 'pro', 'sub_existing', '${CUS}')`,
    );
    const r = await snapshot(db, 'e_conflict', 'active', 1000, USER); // tries to bind SUB while sub_existing lives
    expect(r.success).toBe('false');
    expect(r.error).not.toBeNull();
    expect((await profile(db)).stripe_subscription_id).toBe('sub_existing'); // unchanged
    await db.close();
  });

  it('terminal-late-event convergence: after cancel, LATE active AND past_due snapshots are no-op success', async () => {
    const db = await freshDbWithPaidPro();
    expect((await snapshot(db, 't_cancel', 'canceled', 5000)).error).toBeNull();
    expect((await profile(db)).stripe_subscription_id).toBeNull(); // cleared + tombstoned
    // Out-of-order stale events for the dead subscription converge to Free (cannot reactivate, not unknown).
    expect((await snapshot(db, 't_active', 'active', 1000)).error).toBeNull();
    expect((await snapshot(db, 't_pastdue', 'past_due', 2000)).error).toBeNull();
    const p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBeNull();
    expect(await tier(db)).toBe('free');
    await db.close();
  });
});
