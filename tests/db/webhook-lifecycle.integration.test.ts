// #1282 finding-1 EXECUTED proof: Pro → recoverable lapse → renewal → Pro, run against a REAL
// PostgreSQL (PGlite — Postgres compiled to WASM). Unlike the static contract test (which only inspects
// SQL text) and the Deno test (which only checks Edge routing), this suite APPLIES the webhook migration
// VERBATIM from disk and EXECUTES process_stripe_webhook_event through the full lifecycle, asserting the
// real row + entitlement transitions. The bootstrap stubs only dependencies (roles, table shapes, the
// #1282 resolver); the artefact under test is never rewritten.
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
const SUB = 'sub_test_1282';
const CUS = 'cus_test_1282';

async function freshDbWithPaidPro() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION); // applied verbatim — also proves the ADD COLUMN last_stripe_event_at
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

type RpcResult = { success: string | null; skipped: string | null; warning: string | null; error: string | null };
const call = async (db: PGlite, eventId: string, eventType: string, action: string, created: number): Promise<RpcResult> =>
  (await db.query<RpcResult>(
    `SELECT r->>'success' AS success, r->>'skipped' AS skipped, r->>'warning' AS warning, r->>'error' AS error
     FROM (SELECT public.process_stripe_webhook_event('${eventId}', '${eventType}', '${action}', NULL, '${SUB}', '${CUS}', ${created}) AS r) x`,
  )).rows[0];

describe('#1282 webhook lifecycle (executed in PGlite)', () => {
  it('Pro → recoverable lapse (keeps sub id) → renewal → Pro restored', async () => {
    const db = await freshDbWithPaidPro();
    expect(await tier(db)).toBe('pro');

    // Recoverable lapse: invoice.payment_failed → lapse_pro.
    const lapse = await call(db, 'evt_lapse', 'invoice.payment_failed', 'lapse_pro', 1000);
    expect(lapse.error).toBeNull();
    let p = await profile(db);
    expect(p.subscription_status).toBe('free');       // access suspended
    expect(p.stripe_subscription_id).toBe(SUB);       // FINDING-1 FIX: subscription id PRESERVED
    expect(await tier(db)).toBe('free');

    // Successful recovery: invoice.payment_succeeded → renew_pro (keyed on the preserved sub id).
    const renew = await call(db, 'evt_renew', 'invoice.payment_succeeded', 'renew_pro', 2000);
    expect(renew.error).toBeNull();
    p = await profile(db);
    expect(p.subscription_status).toBe('pro');
    expect(p.stripe_subscription_id).toBe(SUB);
    expect(await tier(db)).toBe('pro');               // Pro RESTORED after recovery
    await db.close();
  });

  it('terminal cancellation clears the sub id but preserves the customer id', async () => {
    const db = await freshDbWithPaidPro();
    const r = await call(db, 'evt_del', 'customer.subscription.deleted', 'downgrade_to_free', 1000);
    expect(r.error).toBeNull();
    const p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBeNull();      // terminal → cleared (not recoverable)
    expect(p.stripe_customer_id).toBe(CUS);           // preserved for portal/history
    await db.close();
  });

  it('a stale renewal arriving AFTER terminal cancellation cannot reactivate the account', async () => {
    // Explicitly required: canceled accounts must not be reactivated by reordered events. Terminal
    // cancellation (created=5000) clears the sub id and advances the watermark; a stale renewal
    // (created=1000, delivered late) must NOT restore Pro. Two independent defenses hold: the sub id is
    // gone (renew_pro is subscription-keyed → matches nothing) AND the watermark is newer than the
    // stale event. A genuine re-subscription is a NEW checkout (upgrade_to_pro on user id), never a
    // renew_pro on the dead subscription id.
    const db = await freshDbWithPaidPro();
    const cancel = await call(db, 'evt_cancel', 'customer.subscription.deleted', 'downgrade_to_free', 5000);
    expect(cancel.error).toBeNull();
    let p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBeNull();

    const staleRenew = await call(db, 'evt_stale_renew', 'invoice.payment_succeeded', 'renew_pro', 1000);
    expect(staleRenew.error).toBeNull();
    p = await profile(db);
    expect(p.subscription_status).toBe('free');       // still canceled — NOT reactivated
    expect(p.stripe_subscription_id).toBeNull();
    expect(await tier(db)).toBe('free');
    await db.close();
  });

  it('ignores an out-of-order (older) event and never regresses newer state', async () => {
    const db = await freshDbWithPaidPro();
    await call(db, 'evt_new', 'invoice.payment_succeeded', 'renew_pro', 5000); // newer sets watermark
    const older = await call(db, 'evt_old', 'invoice.payment_failed', 'lapse_pro', 1000); // older → ignored
    expect(older.warning).toBe('ignored_out_of_order');
    const p = await profile(db);
    expect(p.subscription_status).toBe('pro');        // not regressed
    expect(await tier(db)).toBe('pro');
    await db.close();
  });

  it('is idempotent on duplicate event ids (replay skipped)', async () => {
    const db = await freshDbWithPaidPro();
    await call(db, 'evt_dup', 'invoice.payment_failed', 'lapse_pro', 1000);
    const replay = await call(db, 'evt_dup', 'invoice.payment_failed', 'lapse_pro', 1000); // same id
    expect(replay.skipped).toBe('true');
    await db.close();
  });
});

describe('#1266 webhook DB prerequisite — OLD-Edge + NEW-DB compatibility (deployment-order safety)', () => {
  // Proves the database-first split is safe: after this migration is applied, the PRE-#1282 Edge webhook
  // (which calls the 6-arg process_stripe_webhook_event with only the legacy actions) still works — the
  // migration keeps a 6-arg shim delegating to the 7-arg function. So there is no incompatible window:
  //   • old Edge + new DB (this test) and new Edge + new DB (the suite above) both pass.
  const legacy6 = async (db: PGlite, eventId: string, eventType: string, action: string, userId: string | null) =>
    (await db.query<{ error: string | null }>(
      `SELECT (public.process_stripe_webhook_event('${eventId}', '${eventType}', '${action}', ${userId ? `'${userId}'` : 'NULL'}, '${SUB}', '${CUS}') ->> 'error') AS error`,
    )).rows[0];

  it('the pre-#1282 6-arg contract + legacy actions still resolve and mutate correctly', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(MIGRATION);
    await db.exec(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${USER}', 'free')`);

    // Legacy upgrade_to_pro via the 6-arg overload (old Edge shape) — the shim must accept it.
    const up = await legacy6(db, 'evt_legacy_up', 'checkout.session.completed', 'upgrade_to_pro', USER);
    expect(up.error).toBeNull();
    let p = await profile(db);
    expect(p.subscription_status).toBe('pro');
    expect(p.stripe_subscription_id).toBe(SUB);

    // Legacy downgrade_to_free via the 6-arg overload — also accepted (clears the sub id).
    const down = await legacy6(db, 'evt_legacy_down', 'customer.subscription.deleted', 'downgrade_to_free', null);
    expect(down.error).toBeNull();
    p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBeNull();
    await db.close();
  });

  it('is idempotent — re-applying the migration succeeds and behavior is preserved', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    await db.exec(MIGRATION);
    await db.exec(MIGRATION); // re-apply: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE must not error
    await db.exec(
      `INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id, stripe_customer_id)
       VALUES ('${USER}', 'pro', '${SUB}', '${CUS}')`,
    );
    const r = await call(db, 'evt_idem', 'invoice.payment_failed', 'lapse_pro', 1000);
    expect(r.error).toBeNull();
    const p = await profile(db);
    expect(p.subscription_status).toBe('free');
    expect(p.stripe_subscription_id).toBe(SUB); // lapse still preserves the sub id after a re-apply
    await db.close();
  });
});
