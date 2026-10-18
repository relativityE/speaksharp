// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pendingBootstrap } from './account-closure-pending-fixture.mjs';
import { handleClosureRequest, type ClosureRequestDependencies } from '../../backend/supabase/functions/_shared/accountClosureRequest';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);
let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(pendingBootstrap()); }, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`BEGIN; INSERT INTO auth.users VALUES('${A}','a@example.test',now()),('${B}','b@example.test',now());`);
});
afterEach(async () => { await db.exec('ROLLBACK'); });
async function roleQuery(role: string, sql: string, args: unknown[] = [], owner = A) {
  await db.exec('SAVEPOINT request');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    const result = await db.query(sql, args);
    await db.exec('RESET ROLE; RELEASE SAVEPOINT request');
    return result;
  } catch (error) { await db.exec('ROLLBACK TO SAVEPOINT request; RELEASE SAVEPOINT request'); throw error; }
}
const service = (sql: string, args: unknown[] = []) => roleQuery('service_role', sql, args);
const issue = () => service('SELECT * FROM issue_account_closure_pending_token($1,$2)', [A, HASH]);
const pending = () => service('SELECT begin_account_closure_pending($1,$2,true) AS status', [A, HASH]);
const begin = async (user = A) => (await service('SELECT begin_account_checkout($1) AS id', [user])).rows[0].id as string;
const state = async () => (await service('SELECT inspect_account_closure_pending($1) AS status', [A])).rows[0].status;
const complete = (op: string, user = A, customer = 'cus_a', subscription = 'sub_a') => service(
  'SELECT apply_account_checkout_snapshot($1,$2,$3,$4,$5,$6,$7,true) AS result',
  [user, op, 'cs_a', 'evt_a', subscription, customer, 'active']);

describe('inactive pending/checkout successor on the actual enforcement chain', () => {
  it('applies without enabling deletion; emailed proof alone leaves checkout open', async () => {
    await issue(); expect(await begin()).toBeTruthy(); expect(await state()).toBeNull();
    expect((await db.query('SELECT checkout_workers_drained,evidence_reference FROM account_billing_coordination')).rows)
      .toEqual([{ checkout_workers_drained: false, evidence_reference: null }]);
  });
  it('consumes busy checkout confirmation once, rejects new A admission/reuse and lets B proceed', async () => {
    await issue(); const op = await begin();
    await service('SELECT record_account_checkout($1,$2,$3)', [A, op, 'cs_a']);
    const first = (await pending()).rows[0].status;
    expect(first).toMatchObject({ phase: 'pending', checkoutPending: 1, destructiveEnabled: false });
    expect((await pending()).rows[0].status).toEqual(first);
    await expect(begin()).rejects.toThrow('billing operation pending'); expect(await begin(B)).toBeTruthy();
    expect((await service('SELECT confirm_account_checkout_reuse($1,$2,$3) AS reusable', [A, op, 'cs_a'])).rows)
      .toEqual([{ reusable: false }]);
    expect((await db.query('SELECT phase,consumed_at IS NOT NULL AS consumed FROM account_closure_tokens')).rows)
      .toEqual([{ phase: 'processing', consumed: true }]);
  });
  it.each(['issuing','open','unknown'])('settles the exact pre-admitted %s operation through the canonical snapshot and billing trigger', async phase => {
    await issue(); const op = await begin();
    if (phase === 'open') await service('SELECT record_account_checkout($1,$2,$3)', [A, op, 'cs_a']);
    if (phase === 'unknown') await db.query("UPDATE account_checkout_operations SET phase='unknown' WHERE operation_id=$1", [op]);
    await pending(); expect((await complete(op)).rows[0].result).toMatchObject({ success: true });
    expect(await state()).toMatchObject({ phase: 'pending', checkoutPending: 0, destructiveEnabled: false });
    expect((await db.query('SELECT stripe_customer_id,stripe_subscription_id,subscription_status FROM user_profiles WHERE id=$1', [A])).rows)
      .toEqual([{ stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a', subscription_status: 'pro' }]);
    expect((await db.query('SELECT * FROM account_checkout_snapshot_permits')).rows).toEqual([]);
    expect((await complete(op)).rows[0].result).toMatchObject({ success: true });
  });
  it('permits exact provider-confirmed expiry after pending and token expiry, without reopening', async () => {
    await issue(); const op = await begin(); await service('SELECT record_account_checkout($1,$2,$3)', [A, op, 'cs_a']);
    await pending(); await db.exec("UPDATE account_closure_tokens SET expires_at=clock_timestamp()-interval '1 second'");
    await service('SELECT reconcile_account_checkout_expiry($1,$2,$3)', [A, op, 'cs_a']);
    await service('SELECT reconcile_account_checkout_expiry($1,$2,$3)', [A, op, 'cs_a']);
    expect(await state()).toMatchObject({ phase: 'pending', checkoutPending: 0 });
    await expect(begin()).rejects.toThrow('billing operation pending');
  });
  it('keeps a previously settled checkout eligible for an exact duplicate callback after confirmation', async () => {
    await issue(); const op = await begin(); await complete(op); await pending();
    expect((await complete(op)).rows[0].result).toMatchObject({ success: true });
    expect(await state()).toMatchObject({ phase: 'pending', checkoutPending: 0 });
  });
  it.each([
    [false,'canceled'],[true,'canceled'],[false,'incomplete_expired'],[true,'incomplete_expired'],
  ] as const)('terminal checkout redelivery commits canonical revocation and idempotent settlement (pending=%s, terminal=%s)', async (confirmed, terminal) => {
    await issue(); const op = await begin(); await complete(op);
    if (confirmed) await pending();
    const result = await service("SELECT apply_account_checkout_snapshot($1,$2,'cs_a','evt_terminal','sub_a','cus_a',$3,false) AS result", [A, op, terminal]);
    expect(result.rows[0].result).toMatchObject({ success: true });
    expect((await db.query('SELECT subscription_status,stripe_customer_id,stripe_subscription_id FROM user_profiles WHERE id=$1', [A])).rows)
      .toEqual([{ subscription_status: 'free', stripe_customer_id: 'cus_a', stripe_subscription_id: null }]);
    expect((await db.query('SELECT customer_id,terminal_status FROM stripe_subscription_tombstones WHERE subscription_id=$1', ['sub_a'])).rows)
      .toEqual([{ customer_id: 'cus_a', terminal_status: terminal }]);
    expect((await db.query('SELECT phase FROM account_checkout_operations WHERE operation_id=$1', [op])).rows).toEqual([{ phase: 'settled' }]);
    const again = await service("SELECT apply_account_checkout_snapshot($1,$2,'cs_a','evt_terminal','sub_a','cus_a',$3,false) AS result", [A, op, terminal]);
    expect(again.rows[0].result).toMatchObject({ success: true });
    const pendingStatus = expect.objectContaining({ phase: 'pending', checkoutPending: 0 });
    const expected = confirmed ? pendingStatus : null;
    expect(await state()).toEqual(expected);
    await expect(complete(op, A, 'cus_wrong')).rejects.toThrow('checkout ownership mismatch');
    await expect(complete(op)).rejects.toThrow('checkout snapshot refused');
    expect((await db.query('SELECT subscription_status,stripe_subscription_id FROM user_profiles WHERE id=$1', [A])).rows)
      .toEqual([{ subscription_status: 'free', stripe_subscription_id: null }]);
  });
  it('a provider-proven parameter rejection settles admitted issuance without allowing a replacement', async () => {
    await issue(); const op = await begin(); await pending();
    expect((await service("SELECT reconcile_rejected_account_checkout($1,$2,'req_pending','parameter_missing','line_items') AS settled", [A, op])).rows)
      .toEqual([{ settled: true }]);
    expect(await state()).toMatchObject({ phase: 'pending', checkoutPending: 0 });
    await expect(begin()).rejects.toThrow('billing operation pending');
  });
  it('refuses wrong owner/operation/session and conflicting customer/subscription without partial changes', async () => {
    await issue(); const op = await begin(); await pending();
    await expect(complete(op, B)).rejects.toThrow('checkout ownership mismatch');
    await expect(complete(B)).rejects.toThrow('checkout ownership mismatch');
    await complete(op);
    await expect(complete(op, A, 'cus_wrong')).rejects.toThrow('checkout ownership mismatch');
    await expect(complete(op, A, 'cus_a', 'sub_wrong')).rejects.toThrow('checkout ownership mismatch');
    await expect(service('SELECT reconcile_account_checkout_expiry($1,$2,$3)', [A, op, 'cs_wrong'])).rejects.toThrow('checkout ownership mismatch');
    expect((await db.query('SELECT stripe_customer_id FROM user_profiles WHERE id=$1', [A])).rows).toEqual([{ stripe_customer_id: 'cus_a' }]);
  });
  it('rejects direct new billing attachment and rolls back canonical receipt/permit on refused price', async () => {
    await issue(); const op = await begin(); await pending();
    const unbound = await service("SELECT apply_stripe_subscription_snapshot('evt_direct','sub_bad','cus_bad','active',true,false,NULL,$1) AS result", [A]);
    expect(unbound.rows[0].result).toMatchObject({ success: false });
    await expect(service("SELECT apply_account_checkout_snapshot($1,$2,'cs_a','evt_bad','sub_a','cus_a','active',false)", [A, op]))
      .rejects.toThrow('checkout snapshot refused');
    expect((await db.query('SELECT * FROM processed_webhook_events')).rows).toEqual([]);
    expect((await db.query('SELECT * FROM account_checkout_snapshot_permits')).rows).toEqual([]);
    expect(await state()).toMatchObject({ checkoutPending: 1 });
  });
  it('keeps confirmed pending on finish, after expiry, and denies all destructive phase transitions', async () => {
    await issue(); await pending();
    const row = (await db.query('SELECT request_id FROM account_closure_attempts')).rows[0];
    await service('SELECT finish_account_closure_attempt($1,$2)', [A, row.request_id]);
    await db.exec("UPDATE account_closure_tokens SET expires_at=clock_timestamp()-interval '1 second'");
    expect((await pending()).rows[0].status).toEqual(await state());
    await expect(roleQuery('closure_owner', 'SELECT record_account_closure_auth_state($1,$2,$3)', [A, row.request_id, 'auth_unknown']))
      .rejects.toThrow('invalid closure transition');
    expect((await roleQuery('closure_owner', 'SELECT * FROM claim_account_closure_token($1,$2)', [A, HASH])).rows).toEqual([]);
    expect(await state()).toMatchObject({ phase: 'pending', destructiveEnabled: false });
  });
  it('owner status survives reload without token; private grants forbid other-account reads/confirmation', async () => {
    await issue(); await pending();
    expect((await roleQuery('authenticated', 'SELECT account_closure_pending_status() AS status')).rows[0].status).toEqual(await state());
    expect((await roleQuery('authenticated', 'SELECT account_closure_pending_status() AS status', [], B)).rows[0].status).toBeNull();
    for (const role of ['anon','authenticated']) {
      await expect(roleQuery(role, 'SELECT inspect_account_closure_pending($1)', [A])).rejects.toThrow('permission denied');
      await expect(roleQuery(role, 'SELECT begin_account_closure_pending($1,$2,true)', [A, HASH])).rejects.toThrow('permission denied');
      await expect(roleQuery(role, 'SELECT * FROM account_checkout_snapshot_permits')).rejects.toThrow('permission denied');
    }
  });
  it('invalid confirmation cannot consume proof or establish pending', async () => {
    await issue();
    await expect(service('SELECT begin_account_closure_pending($1,$2,false)', [A, HASH])).rejects.toThrow('explicit confirmation required');
    expect((await service('SELECT begin_account_closure_pending($1,$2,true) AS status', [B, HASH])).rows[0].status).toBeNull();
    await db.exec("UPDATE account_closure_tokens SET expires_at=clock_timestamp()-interval '1 second'");
    expect((await pending()).rows[0].status).toBeNull(); expect(await state()).toBeNull();
  });
  it('real request handler consumes authenticated confirmation into pending and recovers a lost reply via owner status', async () => {
    const destructive = vi.fn(() => { throw new Error('must not reach destructive adapters'); });
    const deps: ClosureRequestDependencies = {
      authenticate: async () => ({ id: A, email: 'a@example.test' }), siteUrl: 'https://example.test',
      randomToken: () => 'b'.repeat(64), hashToken: async () => HASH,
      issue: async () => (await issue()).rows.length === 1, revoke: async () => {}, sendLink: async () => {},
      closure: destructive, finish: vi.fn(), pending: {
        confirm: async (user, hash) => (await service('SELECT begin_account_closure_pending($1,$2,true) AS status', [user, hash])).rows[0].status,
        status: async () => (await roleQuery('authenticated', 'SELECT account_closure_pending_status() AS status')).rows[0].status,
      },
    };
    const request = (body: object) => new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) });
    expect((await handleClosureRequest(request({ action: 'request' }), deps)).status).toBe(200);
    await begin();
    expect((await handleClosureRequest(request({ action: 'confirm', token: 'b'.repeat(64), confirmIrreversible: true, userId: B }), deps)).status).toBe(202);
    // Drop the confirm response; a new status request needs neither token nor destructive flag.
    const recovered = await handleClosureRequest(request({ action: 'status', userId: B }), deps);
    expect(await recovered.json()).toMatchObject({ outcome: 'pending', phase: 'pending', checkoutPending: 1, destructiveEnabled: false });
    expect(destructive).not.toHaveBeenCalled(); expect(deps.finish).not.toHaveBeenCalled();
  });
});
