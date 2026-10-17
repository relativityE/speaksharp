// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    ${source('20261016180000_account_closure_drain_enforcement.sql')}
    ${source('20261017200000_checkout_rejection_recovery.sql')} RESET ROLE;
    INSERT INTO auth.users VALUES('${U}','rejection-matrix@example.test',now());`);
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
});
