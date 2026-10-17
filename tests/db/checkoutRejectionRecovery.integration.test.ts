// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkoutRejectionQuery, assertCheckoutRejection } from '../../scripts/lib/checkoutRejectionGate.mjs';

const U = '11111111-1111-4111-8111-111111111111';
const source = (name: string) => readFileSync(resolve('backend/supabase/migrations', name), 'utf8');
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  // Reuse the existing scoped schema, with the actual signup and117–120 SQL.
  const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8');
  const bootstrap = fixture.match(/await db\.exec\(`\n([\s\S]*?)`\);/);
  if (!bootstrap) throw new Error('scoped schema fixture missing');
  await db.exec(bootstrap[1]);
  await db.exec(`SET ROLE closure_owner;
    ${source('20260812041600_trial_commercial_grant_on_conflict_1294.sql')}
    CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user();
    ${source('20261013180000_account_closure_tokens.sql')}
    ${source('20261016090000_account_closure_drain_persistence.sql')}
    ${source('20261016180000_account_closure_drain_enforcement.sql')} RESET ROLE;`);
  await gate('before');
  await db.exec(`SET ROLE closure_owner; ${source('20261017200000_checkout_rejection_recovery.sql')} RESET ROLE;
    INSERT INTO auth.users VALUES('${U}','rejection-matrix@example.test',now());`);
  await gate('after');
});
afterEach(async () => { await db.close(); });
async function service(query: string, args: unknown[] = []) {
  return db.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE service_role'); return tx.query(query, args); });
}
async function begin() {
  return ((await service('SELECT begin_account_checkout($1) AS op', [U])).rows[0] as { op: string }).op;
}
const reconcile = (op: string) => service('SELECT reconcile_rejected_account_checkout($1,$2,$3,$4,$5) AS ack',
  [U, op, 'req_matrix', 'parameter_missing', 'line_items']);
async function gate(mode: string) {
  const result = await db.query(checkoutRejectionQuery(mode, source('20261017200000_checkout_rejection_recovery.sql')));
  return assertCheckoutRejection(Object.values(result.rows[0] as Record<string, unknown>)[0], mode);
}

describe('forward checkout rejection SQL', () => {
  it('executes actual service-only/no-session recovery invariants and rolls back every fixture', async () => {
    await db.exec(readFileSync('tests/db/checkout-rejection-recovery.sql', 'utf8'));
    expect((await db.query("SELECT count(*)::int AS n FROM auth.users WHERE email LIKE '%-proof@example.test'")).rows).toEqual([{ n: 0 }]);
  });
  it.each(['unknown', 'sessionless-open', 'closing', 'closure-attempt', 'subscription', 'missing-profile'])('refuses changed %s state without touching it', async (state) => {
    const op = await begin();
    if (state === 'unknown' || state === 'sessionless-open') await db.query('UPDATE account_checkout_operations SET phase=$1 WHERE operation_id=$2', [state === 'unknown' ? 'unknown' : 'open', op]);
    if (state === 'closing') await db.query("UPDATE account_billing_fences SET phase='closing' WHERE user_id=$1", [U]);
    if (state === 'closure-attempt') await db.query("INSERT INTO account_closure_attempts(user_id,request_id,claimed_email,phase) VALUES($1,gen_random_uuid(),'rejection-matrix@example.test','processing')", [U]);
    if (state === 'subscription') await db.query("UPDATE user_profiles SET stripe_subscription_id='sub_concurrent' WHERE id=$1", [U]);
    if (state === 'missing-profile') await db.query('DELETE FROM user_profiles WHERE id=$1', [U]);
    const snapshot = async () => ({ operations: (await db.query('SELECT * FROM account_checkout_operations ORDER BY operation_id')).rows,
      receipts: (await db.query('SELECT * FROM account_checkout_rejections ORDER BY operation_id')).rows });
    const before = await snapshot();
    expect((await reconcile(op)).rows).toEqual([{ ack: false }]);
    expect(await snapshot()).toEqual(before);
  });
  it.each([
    'ALTER TABLE account_checkout_rejections DISABLE ROW LEVEL SECURITY',
    'GRANT SELECT ON account_checkout_rejections TO authenticated',
    'GRANT SELECT(request_id) ON account_checkout_rejections TO service_role',
    'CREATE POLICY leaked ON account_checkout_rejections USING(true)',
    'ALTER TABLE account_checkout_rejections ADD COLUMN extra text',
    'ALTER TABLE account_checkout_rejections ALTER COLUMN param DROP NOT NULL',
    'ALTER TABLE account_checkout_rejections DROP CONSTRAINT account_checkout_rejections_operation_id_fkey',
    'ALTER FUNCTION inspect_rejected_account_checkout(uuid,uuid) SET search_path=public',
    'GRANT EXECUTE ON FUNCTION reconcile_rejected_account_checkout(uuid,uuid,text,text,text) TO anon',
    'REVOKE EXECUTE ON FUNCTION inspect_rejected_account_checkout(uuid,uuid) FROM service_role',
  ])('postflight rejects catalog mutation: %s', async (mutation) => {
    await db.exec(`SET ROLE closure_owner; ${mutation}; RESET ROLE;`);
    await expect(gate('after')).rejects.toThrow('verification failed');
  });
  it('fresh apply requires empty receipts; later verify accepts correctly retained proof', async () => {
    const op = await begin(); await reconcile(op);
    await expect(gate('after')).rejects.toThrow('verification failed');
    await expect(gate('verify')).resolves.toMatchObject({ passed: true });
  });
  it('rejects a changed source checksum and incomplete success receipt', () => {
    expect(() => checkoutRejectionQuery('after', source('20261017200000_checkout_rejection_recovery.sql') + '\n')).toThrow('mode/source');
    expect(() => assertCheckoutRejection({ mode: 'checkout-rejection-after', passed: true, checks: {} }, 'after')).toThrow('verification failed');
  });
});
