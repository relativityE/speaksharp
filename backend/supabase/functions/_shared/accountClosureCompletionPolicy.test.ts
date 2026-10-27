import { strict as a } from 'node:assert';
import { createAccountCompletionPolicy, createServerCompletionPolicyPorts, type CompletionPolicyPorts } from './accountClosureCompletionPolicy.ts';
import type { CompletionGrant } from './accountClosureCompletion.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@16';

const USER = '10000000-0000-4000-8000-000000000001', REQUEST = '20000000-0000-4000-8000-000000000002';
function fixture() {
  const grant: CompletionGrant = { userId: USER, requestId: REQUEST, executionId: '30000000-0000-4000-8000-000000000003',
    scopeDigest: 'e'.repeat(64), expiresAt: 10000, proof: { userId: USER, requestId: REQUEST, email: 'synthetic@example.invalid', customerId: 'cus_owned', expiresAt: 10000 },
    settled: { checkout: true, saves: true, coaching: true, portal: true } };
  const state = { now: 100, effects: [] as string[], current: true, canceled: false, wrongCustomer: false, repeat: false,
    objects: [{ bucket: 'synthetic', name: `${USER}/a` }], customerRead: 0, expireOnRead: false };
  const ports: CompletionPolicyPorts = {
    now: () => state.now, verifyCheckouts: async () => true,
    customer: async id => { state.customerRead++; if (state.expireOnRead) state.now = grant.expiresAt; return { id }; },
    subscriptions: async () => ({ data: [{ id: 'sub_owned', status: state.canceled ? 'canceled' : 'active',
      customerId: state.wrongCustomer ? 'cus_other' : 'cus_owned' }], hasMore: state.repeat }),
    cancelSubscription: async id => { state.effects.push('cancel'); state.canceled = true; return { id, status: 'canceled', customerId: 'cus_owned' }; },
    settleBilling: async () => { state.effects.push('settle'); }, deleteCustomer: async id => { state.effects.push('customer'); return { id, deleted: true }; },
    preserveTrialEmail: async () => { state.effects.push('retain'); }, listStorage: async () => structuredClone(state.objects),
    removeStorageObject: async () => { state.effects.push('storage'); state.objects = []; },
    deleteAuthUser: async g => { state.effects.push('auth'); return { userId: g.userId, deleted: true }; },
  };
  const policy = createAccountCompletionPolicy(grant, ports, async () => { if (!state.current) throw new Error('stale'); });
  return { grant, state, ports, policy };
}
Deno.test('paid policy binds subscription cancellation/settlement and storage to the new grant', async () => {
  const f = fixture(); a.equal((await f.policy.listSubscriptions('cus_owned')).complete, true);
  await f.policy.cancelSubscription('sub_owned', { invoice_now: false, prorate: false, idempotencyKey: `account-closure:${REQUEST}:sub_owned` });
  await f.policy.settleBilling(USER, (await f.policy.listSubscriptions('cus_owned')).subscriptions);
  a.deepEqual(await f.policy.deleteCustomer('cus_owned'), { deleted: true });
  await f.policy.removeOwnedStorage(USER); a.deepEqual(f.state.effects, ['cancel', 'settle', 'customer', 'storage']);
});
Deno.test('customer lookup expiring or invalidating authority cannot dispatch DELETE', async () => {
  const expired = fixture(); expired.state.expireOnRead = true;
  await a.rejects(() => expired.policy.deleteCustomer('cus_owned')); a.deepEqual(expired.state.effects, []);
  const stale = fixture(); stale.state.current = false;
  await a.rejects(() => stale.policy.deleteCustomer('cus_owned')); a.deepEqual(stale.state.effects, []);
});
Deno.test('foreign subscription ownership and nonprogressing pages refuse', async () => {
  const f = fixture(); f.state.wrongCustomer = true; await a.rejects(() => f.policy.listSubscriptions('cus_owned'));
  f.state.wrongCustomer = false; f.state.repeat = true; await a.rejects(() => f.policy.listSubscriptions('cus_owned'));
  a.deepEqual(f.state.effects, []);
});
Deno.test('unknown subscription, wrong account and wrong trial email cannot reach effect ports', async () => {
  const f = fixture();
  await a.rejects(() => f.policy.cancelSubscription('sub_other', { invoice_now: false, prorate: false, idempotencyKey: 'wrong' }));
  await a.rejects(() => f.policy.removeOwnedStorage('other'));
  await a.rejects(() => f.policy.preserveTrialEmail(USER, 'other@example.invalid'));
  a.deepEqual(f.state.effects, []);
});
Deno.test('each storage object gets current authority; stale successor is not removed', async () => {
  const f = fixture(); f.state.objects.push({ bucket: 'synthetic', name: `${USER}/b` });
  f.ports.removeStorageObject = async () => { f.state.effects.push('storage'); f.state.current = false; };
  await a.rejects(() => f.policy.removeOwnedStorage(USER)); a.deepEqual(f.state.effects, ['storage']);
});
Deno.test('wrong Auth deletion receipt cannot become accountDeleted true', async () => {
  const f = fixture(); f.ports.deleteAuthUser = async () => ({ userId: 'foreign', deleted: true });
  a.deepEqual(await f.policy.deleteAuthUser(USER), { deleted: null });
});
Deno.test('real server settlement adapter calls only new-grant RPC and refuses missing schema', async () => {
  const f = fixture(), calls: { name: string; args: unknown }[] = [];
  const admin = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: null, error: { code: 'missing_rpc' } }; } };
  const ports = createServerCompletionPolicyPorts({ projectId: 'fixture-project', environment: 'production',
    url: 'https://fixture-project.supabase.co', scopeDigest: f.grant.scopeDigest }, admin as unknown as SupabaseClient, {} as Stripe);
  await a.rejects(() => ports.settleBilling(f.grant, []));
  a.deepEqual(calls, [{ name: 'settle_account_completion_billing_v1', args: { p_user_id: USER, p_request_id: REQUEST,
    p_execution_id: f.grant.executionId, p_scope_digest: f.grant.scopeDigest, p_subscriptions: [] } }]);
  await a.rejects(() => ports.verifyCheckouts(f.grant));
});
Deno.test('real server policy refuses missing provider before any grant or RPC', () => {
  a.throws(() => createServerCompletionPolicyPorts({ projectId: 'fixture-project', environment: 'production',
    url: 'https://fixture-project.supabase.co', scopeDigest: 'e'.repeat(64) }, {} as SupabaseClient, null), /provider_unavailable/);
});
