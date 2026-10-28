// @vitest-environment node
// Executes the actual migrations in PostgreSQL WASM; native race proof is separate.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { completionBootstrap } from '../db/account-completion-fixture.mjs';

const scope = 'a'.repeat(64);
const candidate = 'backend/supabase/migrations/20261027192550_account_completion_billing_settlement.sql';
const signature = 'public.settle_account_completion_billing_v1(uuid,uuid,uuid,text,jsonb)';
let db: PGlite, serial = 0, beforeTables: unknown;
const consumed = new Map<string, { file: string; sha256: string; beforeSha256: string; afterSha256: string }>();
async function executeSource(file: string) {
  const bytes = readFileSync(file), beforeSha256 = createHash('sha256').update(bytes).digest('hex');
  const result = await db.exec(bytes.toString('utf8'));
  const afterSha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(afterSha256, 'SQL bytes remain unchanged across actual execution').toBe(beforeSha256);
  consumed.set(file, { file, sha256: beforeSha256, beforeSha256, afterSha256 });
  return result;
}
type Account = { user: string; request: string; execution: string; customer: string; subscription: string };
async function query<T extends Record<string, unknown>>(text: string, args: unknown[] = [], role?: string) {
  await db.exec('RESET ROLE');
  if (role) await db.exec(`SET ROLE ${role}`);
  return (await db.query<T>(text, args)).rows;
}
async function value(text: string, args: unknown[] = [], role?: string) {
  return Object.values((await query(text, args, role))[0] ?? {})[0];
}
async function seed(intent = 'started'): Promise<Account> {
  const n = ++serial, user = `c0110000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const hash = String(n).padStart(64, 'a'), statusHash = String(n).padStart(64, 'c');
  const customer = `cus_synthetic_${n}`, subscription = `sub_synthetic_${n}`;
  await query('INSERT INTO auth.users VALUES($1,$2,now())', [user, `settlement-${n}@example.invalid`]);
  await query("UPDATE user_profiles SET subscription_status='pro',stripe_customer_id=$2,stripe_subscription_id=$3 WHERE id=$1",
    [user, customer, subscription]);
  await value('SELECT issue_account_closure_pending_token($1,$2)', [user, hash], 'service_role');
  const request = await value('SELECT request_id FROM account_closure_tokens WHERE user_id=$1', [user]) as string;
  await value('SELECT begin_account_closure_pending($1,$2,true)', [user, hash], 'service_role');
  await query('INSERT INTO account_completion_coverage VALUES($1,$2,$3,$4,$5)',
    [user, request, scope, 'synthetic fixture coverage; not provider evidence', 'synthetic portal settlement']);
  await value('SELECT issue_account_completion_status_v1($1,$2,$3,$4)', [user, request, scope, statusHash], 'service_role');
  expect(await value('SELECT acknowledge_account_completion_status_v1($1,$2,$3,$4)', [user, request, scope, statusHash], 'service_role')).toBe(true);
  const grant = await value('SELECT claim_account_pending_completion_v1($1,$2,$3)', [user, request, scope], 'service_role') as { executionId: string };
  expect(grant.executionId).toBeTypeOf('string');
  const execution = grant.executionId;
  if (intent !== 'absent') {
    await value("SELECT begin_account_completion_stage_v1($1,$2,$3,$4,'settle_billing')", [user, request, execution, scope], 'service_role');
    if (intent !== 'started') await query("UPDATE account_completion_stages SET phase=$2 WHERE execution_id=$1 AND key='settle_billing'", [execution, intent]);
  }
  return { user, request, execution, customer, subscription };
}
const terminal = (a: Account) => [{ id: a.subscription, status: 'canceled' }];
const settle = (a: Account, subscriptions: unknown = terminal(a), binding = scope) => value(
  'SELECT settle_account_completion_billing_v1($1,$2,$3,$4,$5::jsonb)',
  [a.user, a.request, a.execution, binding, JSON.stringify(subscriptions)], 'service_role');
async function unchanged(a: Account) {
  expect(await value('SELECT subscription_status FROM user_profiles WHERE id=$1', [a.user])).toBe('pro');
  expect(await value('SELECT stripe_subscription_id FROM user_profiles WHERE id=$1', [a.user])).toBe(a.subscription);
  expect(await value('SELECT count(*)::int FROM stripe_subscription_tombstones WHERE subscription_id=$1', [a.subscription])).toBe(0);
}
const tableAcls = () => query("SELECT relname,relacl::text FROM pg_class WHERE oid IN ('public.user_profiles'::regclass,'public.account_completion_executions'::regclass,'public.account_completion_stages'::regclass,'public.account_completion_configuration'::regclass) ORDER BY relname");

beforeAll(async () => {
  db = new PGlite(); await db.exec(completionBootstrap());
  await db.exec(readFileSync('backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql', 'utf8'));
  beforeTables = await tableAcls();
  await executeSource(candidate);
}, 30000);
beforeEach(async () => { await query('UPDATE account_completion_configuration SET enabled=true,scope_digest=$1', [scope]); });
afterAll(async () => {
  await db?.close();
  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING ?? 'null');
  if (binding?.sql) writeFileSync(binding.sql.witnessFile, JSON.stringify({ schemaVersion: 1,
    phaseId: binding.phaseId, bindingSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    consumer: 'tests/unit/accountCompletionBillingSettlement.test.ts', consumed: [...consumed.values()] }));
});

describe('completion-grant billing settlement: actual SQL/ACLs', () => {
  it('admits only service_role on the new narrow surface, preserving existing table and base-RPC ACLs', async () => {
    expect(await tableAcls()).toEqual(beforeTables);
    for (const role of ['anon', 'authenticated']) expect(await value('SELECT has_function_privilege($1,$2,$3)', [role, signature, 'EXECUTE'])).toBe(false);
    expect(await value('SELECT has_function_privilege($1,$2,$3)', ['service_role', signature, 'EXECUTE'])).toBe(true);
    expect(await value('SELECT has_function_privilege($1,$2,$3)', ['service_role', 'public.settle_account_closure_billing(uuid,uuid,text,jsonb)', 'EXECUTE'])).toBe(false);
  });
  it('settles the bound paid customer and atomically consumes its one started intent', async () => {
    const a = await seed(); expect(await settle(a)).toBe(true);
    expect(await value('SELECT subscription_status FROM user_profiles WHERE id=$1', [a.user])).toBe('free');
    expect(await value('SELECT customer_id FROM stripe_subscription_tombstones WHERE subscription_id=$1', [a.subscription])).toBe(a.customer);
    expect(await value("SELECT phase FROM account_completion_stages WHERE execution_id=$1 AND key='settle_billing'", [a.execution])).toBe('completed');
    const receipt = await value("SELECT finish_account_completion_stage_v1($1,$2,$3,$4,'settle_billing','completed')", [a.user, a.request, a.execution, scope], 'service_role') as { phase: string };
    expect(receipt.phase).toBe('completed');
    await expect(settle(a)).rejects.toThrow('intent unavailable');
  });
  it.each(['user', 'request', 'execution', 'scope'])('wrong %s cannot mutate billing', async field => {
    const a = await seed(), other = await seed();
    const wrong = { ...a, ...(field === 'scope' ? {} : { [field]: other[field as keyof Account] }) };
    await expect(settle(wrong, terminal(a), field === 'scope' ? 'b'.repeat(64) : scope)).rejects.toThrow();
    await unchanged(a); await unchanged(other);
  });
  it.each(['absent', 'unknown', 'completed'])('%s dispatch intent cannot authorize settlement', async intent => {
    const a = await seed(intent); await expect(settle(a)).rejects.toThrow('intent unavailable'); await unchanged(a);
  });
  it.each(['disabled', 'changed', 'expired'])('%s current authority refuses without partial SQL effects', async state => {
    const a = await seed();
    if (state === 'disabled') await query('UPDATE account_completion_configuration SET enabled=false');
    if (state === 'changed') await query('UPDATE account_completion_configuration SET scope_digest=$1', ['b'.repeat(64)]);
    if (state === 'expired') await query("UPDATE account_completion_executions SET expires_at=clock_timestamp()-interval '1 second' WHERE execution_id=$1", [a.execution]);
    await expect(settle(a)).rejects.toThrow('unavailable'); await unchanged(a);
  });
  it.each([null, {}, 'text', [], [{ id: 'foreign', status: 'canceled' }], [{ id: '', status: 'active' }]])(
    'malformed or incomplete terminal subscription snapshot %j rolls back', async subscriptions => {
      const a = await seed(); await expect(settle(a, subscriptions)).rejects.toThrow(); await unchanged(a);
      expect(await value("SELECT phase FROM account_completion_stages WHERE execution_id=$1 AND key='settle_billing'", [a.execution])).toBe('started');
    });
  it('customer identity comes from the grant and must still match the serialized profile', async () => {
    const a = await seed(); await query('UPDATE account_completion_executions SET customer_id=$2 WHERE execution_id=$1', [a.execution, 'cus_foreign']);
    await expect(settle(a)).rejects.toThrow('billing identity mismatch'); await unchanged(a);
  });
  it('executes the full-chain SQL oracle in the bounded fixture as a syntax/logic preflight, not real-schema proof', async () => {
    // The fixture intentionally has a minimal Auth schema. These two unused metadata
    // columns only permit the real-chain INSERT syntax; hosted replay still proves real Auth/signup behavior.
    await db.exec('RESET ROLE; ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb, ADD COLUMN raw_user_meta_data jsonb;');
    await query('UPDATE account_completion_configuration SET enabled=false,scope_digest=NULL');
    const result = await executeSource('tests/db/account-completion-billing-full-chain-invariants.sql');
    expect(result.at(-1)?.rows).toEqual([{ '?column?': 'ACCOUNT COMPLETION BILLING REAL-SCHEMA INVARIANTS PASSED' }]);
    expect(await value('SELECT enabled FROM account_completion_configuration')).toBe(false);
    expect(await value('SELECT scope_digest FROM account_completion_configuration')).toBeNull();
    expect(await value("SELECT count(*)::int FROM auth.users WHERE id='b9190000-0000-4000-8000-000000000001'")).toBe(0);
  });
});
