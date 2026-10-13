import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@16';
import { buildDependencies } from './index.ts';

function fixture() {
  const calls: { name: string; args: unknown }[] = [];
  const settings = { deletedCustomer: false, authAbsent: true, customerOwner: 'cus', storageRemains: false };
  let removed = false;
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const data = name === 'claim_account_closure_token' ? [{ user_id: 'owner', email: 'user@example.test',
        customer_id: 'cus', request_id: 'request', expires_at: new Date(Date.now() + 900_000).toISOString() }]
        : name === 'list_account_closure_storage' ? (!removed || settings.storageRemains ? [{ bucket_id: 'audio', name: 'owned/file' }] : [])
        : name === 'verify_account_closure_residue' ? true : name === 'issue_account_closure_token' ? [{ request_id: 'request' }] : null;
      return { data, error: null };
    },
    auth: { admin: {
      deleteUser: async (id: string, soft: boolean) => { calls.push({ name: 'deleteUser', args: { id, soft } }); return { error: null }; },
      getUserById: async () => settings.authAbsent
        ? { data: { user: null }, error: { status: 404, code: 'user_not_found' } }
        : { data: { user: { id: 'owner' } }, error: null },
    } },
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      calls.push({ name: 'storageRemove', args: { bucket, paths } }); removed = true; return { error: null };
    } }) },
  } as unknown as SupabaseClient;
  const auth = { auth: {
    getUser: async () => ({ data: { user: { id: 'owner', email: 'user@example.test', email_confirmed_at: '2026-10-13' } }, error: null }),
    signInWithOtp: async (args: unknown) => { calls.push({ name: 'sendLink', args }); return { error: null }; },
  } } as unknown as SupabaseClient;
  const stripe = {
    customers: {
      retrieve: async (id: string) => ({ id, deleted: settings.deletedCustomer }),
      del: async (id: string) => { calls.push({ name: 'deleteCustomer', args: id }); return { id, deleted: true }; },
    },
    subscriptions: {
      list: async (args: unknown) => { calls.push({ name: 'listSubscriptions', args });
        return { has_more: false, data: [{ id: 'sub', status: 'canceled', customer: settings.customerOwner }] }; },
      cancel: async (id: string, options: unknown, request: unknown) => { calls.push({ name: 'cancelSubscription', args: { id, options, request } }); },
    },
  } as unknown as Stripe;
  const deps = buildDependencies((key) => key === 'SITE_URL' ? 'https://example.test' : undefined, admin, auth, stripe);
  const adapters = deps.closure(new Request('https://example.test'));
  return { calls, settings, deps, adapters, stripe };
}

Deno.test('production adapter constructs the Supabase OTP call, disables new-user creation, preserves the exact redirect', async () => {
  const { calls, deps } = fixture();
  await deps.sendLink('user@example.test', 'https://example.test/account/delete?account_deletion_token=secret');
  assertEquals(calls, [{ name: 'sendLink', args: { email: 'user@example.test', options: {
    shouldCreateUser: false, emailRedirectTo: 'https://example.test/account/delete?account_deletion_token=secret',
  } } }]);
});
Deno.test('production token claim sends only SHA-256, and uses the authoritative proof for billing settlement', async () => {
  const { calls, adapters } = fixture();
  const token = 'a'.repeat(64);
  const proof = await adapters.consumeProof('owner', token);
  assertEquals(proof?.customerId, 'cus');
  const hash = (calls[0].args as { p_token_hash: string }).p_token_hash;
  assertEquals(/^[a-f0-9]{64}$/.test(hash), true);
  assertEquals(hash === token, false);
  await adapters.settleBilling('owner', [{ id: 'sub', status: 'canceled' }]);
  assertEquals(calls[1], { name: 'settle_account_closure_billing', args: {
    p_user_id: 'owner', p_customer_id: 'cus', p_request_id: 'request', p_subscriptions: [{ id: 'sub', status: 'canceled' }],
  } });
});
Deno.test('production adapter cancels without invoicing/proration and supplies a stable idempotency key', async () => {
  const { calls, adapters } = fixture();
  await adapters.cancelSubscription('sub', { invoice_now: false, prorate: false, idempotencyKey: 'stable' });
  assertEquals(calls[0], { name: 'cancelSubscription', args: { id: 'sub', options: {
    invoice_now: false, prorate: false,
  }, request: { idempotencyKey: 'stable' } } });
});
Deno.test('production subscription enumeration refuses an entry belonging to another customer', async () => {
  const { settings, adapters } = fixture(); settings.customerOwner = 'someone-else';
  await assertRejects(() => adapters.listSubscriptions('cus'), Error, 'subscription_identity_mismatch');
});
Deno.test('production adapter follows all subscription pages rather than trusting the first page', async () => {
  const { stripe, adapters, calls } = fixture(); let n = 0;
  stripe.subscriptions.list = ((args: unknown) => {
    calls.push({ name: 'page', args }); n++;
    return Promise.resolve(n === 1 ? { has_more: true, data: [{ id: 'first', status: 'canceled', customer: 'cus' }] }
      : { has_more: false, data: [{ id: 'second', status: 'canceled', customer: 'cus' }] });
  }) as unknown as typeof stripe.subscriptions.list;
  assertEquals(await adapters.listSubscriptions('cus'), { complete: true, subscriptions: [
    { id: 'first', status: 'canceled' }, { id: 'second', status: 'canceled' },
  ] });
  assertEquals((calls[1].args as { starting_after: string }).starting_after, 'first');
});
Deno.test('confirmed already-deleted customer permits recovery without another destructive API call', async () => {
  const { settings, adapters, calls } = fixture(); settings.deletedCustomer = true;
  assertEquals(await adapters.deleteCustomer('cus'), { deleted: true });
  assertEquals(calls.length, 0);
});
Deno.test('storage cleanup removes only server-enumerated owned paths and requires empty readback', async () => {
  const { adapters, calls } = fixture();
  await adapters.removeOwnedStorage('owner');
  assertEquals(calls.find((c) => c.name === 'storageRemove'), { name: 'storageRemove', args: { bucket: 'audio', paths: ['owned/file'] } });
});
Deno.test('storage residue blocks auth deletion', async () => {
  const { adapters, settings } = fixture(); settings.storageRemains = true;
  await assertRejects(() => adapters.removeOwnedStorage('owner'), Error, 'storage_residue');
});
Deno.test('auth deletion requires authoritative not-found readback, never a successful delete response alone', async () => {
  const { settings, adapters } = fixture(); settings.authAbsent = false;
  assertEquals(await adapters.deleteAuthUser('owner'), { deleted: false });
  settings.authAbsent = true;
  assertEquals(await adapters.deleteAuthUser('owner'), { deleted: true });
});
