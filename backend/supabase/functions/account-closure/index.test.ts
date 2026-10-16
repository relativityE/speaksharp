import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@16';
import { buildDependencies, handler } from './index.ts';
import { handleClosureRequest } from '../_shared/accountClosureRequest.ts';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 } from '../_shared/accountClosureRuntimeBinding.ts';

const OWNER = '10000000-0000-4000-8000-000000000001';
const REQUEST = '20000000-0000-4000-8000-000000000002';
const ATTESTATION = '30000000-0000-4000-8000-000000000003';

function fixture() {
  const calls: { name: string; args: unknown }[] = [];
  const settings = { deletedCustomer: false, authAbsent: true, customerOwner: 'cus', storageRemains: false,
    deleteThrows: false, readThrows: false, authorityExpired: false, authorityPhase: 'processing',
    journalResponseLost: '' as '' | 'committed' | 'not-committed', journalFailures: 0,
    authUnknownBeforeDelete: false,
    checkouts: [] as {id:string;status:string;client_reference_id:string;metadata:{userId:string};customer:string|null}[],
    pending: [] as {operation_id:string;session_id:string|null}[] };
  let removed = false; let deleteSent = false;
  const validFrom = Date.now() - 1000; const expiresAt = validFrom + 600_000;
  const scope = { attestationId: ATTESTATION, generation: '0', bindingDigest: 'a'.repeat(64),
    context: { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64), migrationDigest: ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256,
      projectId: 'fixture-project', environment: 'production' } };
  const environment: Record<string, string> = { SITE_URL: 'https://example.test', SUPABASE_URL: 'https://fixture-project.supabase.co',
    DENO_DEPLOYMENT_ID: 'fixture-project_function_1',
    ACCOUNT_CLOSURE_RUNTIME_BINDING: JSON.stringify({ version: 1, deploymentId: 'fixture-project_function_1', scope }) };
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const lost = name === 'record_account_closure_auth_state_with_drain' && args.p_state === 'auth_unknown'
        && settings.journalResponseLost && settings.journalFailures++ === 0;
      if (lost && settings.journalResponseLost === 'not-committed') throw new Error('lost journal response');
      if (name === 'record_account_closure_auth_state_with_drain') settings.authorityPhase = String(args.p_state);
      if (lost) throw new Error('lost journal response');
      const data = name === 'inspect_account_closure_checkouts' ? settings.pending
        : name === 'inspect_account_closure_authority' ? {
          attempt: { userId: OWNER, requestId: REQUEST, email: 'user@example.test', phase: settings.authorityPhase },
          authority: { userId: OWNER, requestId: REQUEST, generation: scope.generation, bindingDigest: scope.bindingDigest,
            validFrom, expiresAt: settings.authorityExpired ? Date.now() - 1 : expiresAt } }
        : name === 'claim_account_closure_token_with_drain' ? [{ user_id: OWNER, email: 'user@example.test',
        customer_id: 'cus', request_id: REQUEST, expires_at: new Date(Date.now() + 900_000).toISOString() }]
        : name === 'list_account_closure_storage' ? (!removed || settings.storageRemains ? [{ bucket_id: 'audio', name: 'owned/file' }] : [])
        : name === 'verify_account_closure_residue_with_drain' ? true : name === 'issue_account_closure_token_with_drain' ? [{ request_id: REQUEST }] : null;
      return { data, error: null };
    },
    auth: { admin: {
      deleteUser: async (id: string, soft: boolean) => { calls.push({ name: 'deleteUser', args: { id, soft } });
        deleteSent = true;
        if (settings.deleteThrows) throw new Error('lost delete response'); return { error: null }; },
      getUserById: async () => { calls.push({ name: 'getUserById', args: OWNER });
        if (settings.readThrows) throw new Error('read timeout');
        if (!deleteSent && settings.authUnknownBeforeDelete) return { data: { user: null }, error: null };
        return settings.authAbsent && deleteSent
        ? { data: { user: null }, error: { status: 404, code: 'user_not_found' } }
        : { data: { user: { id: OWNER } }, error: null }; },
    } },
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      calls.push({ name: 'storageRemove', args: { bucket, paths } }); removed = true; return { error: null };
    } }) },
  } as unknown as SupabaseClient;
  const auth = { auth: {
    getUser: async () => ({ data: { user: { id: OWNER, email: 'user@example.test', email_confirmed_at: '2026-10-13' } }, error: null }),
    signInWithOtp: async (args: unknown) => { calls.push({ name: 'sendLink', args }); return { error: null }; },
  } } as unknown as SupabaseClient;
  const stripe = {
    checkout: { sessions: {
      list: async () => ({data:settings.checkouts,has_more:false}),
      retrieve: async (id:string) => settings.checkouts.find((session)=>session.id===id),
    } },
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
  const deps = buildDependencies((key) => environment[key], admin, auth, stripe);
  const adapters = deps.closure(new Request('https://example.test'));
  return { calls, settings, deps, adapters, stripe, environment, scope };
}

Deno.test('production adapter constructs the Supabase OTP call, disables new-user creation, preserves the exact redirect', async () => {
  const { calls, deps } = fixture();
  await deps.sendLink('user@example.test', 'https://example.test/account/delete?account_deletion_token=secret');
  assertEquals(calls, [{ name: 'sendLink', args: { email: 'user@example.test', options: {
    shouldCreateUser: false, emailRedirectTo: 'https://example.test/account/delete?account_deletion_token=secret',
  } } }]);
});
for (const outcome of ['committed', 'not-committed'] as const) {
  Deno.test(`ambiguous pre-DELETE journal ${outcome} acknowledgment resumes only the same unsent action`, async () => {
    const { adapters, calls, settings } = fixture();
    await adapters.consumeProof(OWNER, 'a'.repeat(64)); settings.journalResponseLost = outcome;
    assertEquals(await adapters.deleteAuthUser(OWNER), { deleted: true });
    const acknowledgments = calls.filter((c) => c.name === 'record_account_closure_auth_state_with_drain'
      && (c.args as { p_state: string }).p_state === 'auth_unknown');
    assertEquals(acknowledgments.length, 2);
    assertEquals(acknowledgments.every((c) => (c.args as { p_user_id: string; p_request_id: string }).p_user_id === OWNER
      && (c.args as { p_request_id: string }).p_request_id === REQUEST), true);
    assertEquals(calls.filter((c) => c.name === 'deleteUser').length, 1);
    assertEquals(calls.findIndex((c) => c.name === 'getUserById') < calls.findIndex((c) => c.name === 'deleteUser'), true);
  });
}
Deno.test('unknown Auth during pre-DELETE continuation preserves the hold and never dispatches DELETE', async () => {
  const { adapters, calls, settings } = fixture();
  await adapters.consumeProof(OWNER, 'a'.repeat(64));
  settings.journalResponseLost = 'committed'; settings.authUnknownBeforeDelete = true;
  assertEquals(await adapters.deleteAuthUser(OWNER), { deleted: null });
  assertEquals(settings.authorityPhase, 'auth_unknown');
  assertEquals(calls.some((c) => c.name === 'deleteUser'), false);
});
Deno.test('an already dispatched uncertain DELETE is never retried within the invocation', async () => {
  const { adapters, calls, settings } = fixture();
  await adapters.consumeProof(OWNER, 'a'.repeat(64)); settings.deleteThrows = true;
  assertEquals(await adapters.deleteAuthUser(OWNER), { deleted: null });
  assertEquals(await adapters.deleteAuthUser(OWNER), { deleted: null });
  assertEquals(calls.filter((c) => c.name === 'deleteUser').length, 1);
  assertEquals(settings.authorityPhase, 'auth_unknown');
});
Deno.test('concurrent adapter entries cannot dispatch two Auth DELETEs', async () => {
  const { adapters, calls } = fixture(); await adapters.consumeProof(OWNER, 'a'.repeat(64));
  const results = await Promise.all([adapters.deleteAuthUser(OWNER), adapters.deleteAuthUser(OWNER)]);
  assertEquals(calls.filter((c) => c.name === 'deleteUser').length, 1);
  assertEquals(results.some((result) => result.deleted === true), true);
  assertEquals(results.some((result) => result.deleted === null), true);
});
Deno.test('production token claim sends only SHA-256, and uses the authoritative proof for billing settlement', async () => {
  const { calls, adapters, scope } = fixture();
  const token = 'a'.repeat(64);
  const proof = await adapters.consumeProof(OWNER, token);
  assertEquals(proof?.customerId, 'cus');
  const hash = (calls[0].args as { p_token_hash: string }).p_token_hash;
  assertEquals(/^[a-f0-9]{64}$/.test(hash), true);
  assertEquals(hash === token, false);
  await adapters.settleBilling(OWNER, [{ id: 'sub', status: 'canceled' }]);
  assertEquals(calls.find((c)=>c.name==='settle_account_closure_billing_with_drain'), { name: 'settle_account_closure_billing_with_drain', args: {
    p_user_id: OWNER, p_customer_id: 'cus', p_request_id: REQUEST, p_subscriptions: [{ id: 'sub', status: 'canceled' }],
    p_attestation_id: ATTESTATION, p_generation: '0', p_binding_digest: 'a'.repeat(64),
    p_context: scope.context,
  } });
});
Deno.test('legacy open checkout on a null-customer account blocks closure, including later pages', async () => {
  const {adapters,stripe}=fixture(); let page=0;
  stripe.checkout.sessions.list=(() => Promise.resolve(++page===1
    ? {has_more:true,data:[{id:'unrelated',status:'expired',client_reference_id:'other'}]}
    : {has_more:false,data:[{id:'open',status:'open',client_reference_id:OWNER,customer:null}]})) as unknown as typeof stripe.checkout.sessions.list;
  assertEquals(await adapters.verifyCheckouts(OWNER,null),false);
  assertEquals(page,2);
});
Deno.test('completed legacy checkout with uncaptured customer refuses customer-null deletion', async () => {
  const {adapters,settings}=fixture();
  settings.checkouts=[{id:'complete',status:'complete',client_reference_id:OWNER,metadata:{userId:OWNER},customer:'late'}];
  assertEquals(await adapters.verifyCheckouts(OWNER,null),false);
  assertEquals(await adapters.verifyCheckouts(OWNER,'late'),true);
});
Deno.test('known expired checkout is reconciled before claim; open checkout is never expired by local time', async () => {
  const {adapters,settings,calls}=fixture();
  settings.pending=[{operation_id:'operation',session_id:'cs'}];
  settings.checkouts=[{id:'cs',status:'open',client_reference_id:OWNER,metadata:{userId:OWNER},customer:null}];
  assertEquals(await adapters.consumeProof(OWNER,'a'.repeat(64)),null);
  assertEquals(calls.some((c)=>c.name==='claim_account_closure_token_with_drain'),false);
  settings.checkouts[0].status='expired';
  await adapters.consumeProof(OWNER,'a'.repeat(64));
  const names=calls.map((c)=>c.name);
  assertEquals(names.indexOf('reconcile_account_closure_checkout_with_drain')<names.indexOf('claim_account_closure_token_with_drain'),true);
});
Deno.test('interrupted checkout issuance remains a durable hold without guessing a Stripe identity', async () => {
  const {adapters,settings,calls}=fixture(); settings.pending=[{operation_id:'operation',session_id:null}];
  assertEquals(await adapters.consumeProof(OWNER,'a'.repeat(64)),null);
  assertEquals(calls.some((c)=>c.name==='claim_account_closure_token_with_drain'),false);
});
Deno.test('production adapter cancels without invoicing/proration and supplies a stable idempotency key', async () => {
  const { calls, adapters } = fixture();
  await adapters.consumeProof(OWNER, 'a'.repeat(64));
  await adapters.cancelSubscription('sub', { invoice_now: false, prorate: false, idempotencyKey: 'stable' });
  assertEquals(calls.find((c) => c.name === 'cancelSubscription'), { name: 'cancelSubscription', args: { id: 'sub', options: {
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
  await adapters.consumeProof(OWNER, 'a'.repeat(64));
  assertEquals(await adapters.deleteCustomer('cus'), { deleted: true });
  assertEquals(calls.some((c) => c.name === 'deleteCustomer'), false);
});
Deno.test('storage cleanup removes only server-enumerated owned paths and requires empty readback', async () => {
  const { adapters, calls } = fixture();
  await adapters.consumeProof(OWNER, 'a'.repeat(64));
  await adapters.removeOwnedStorage(OWNER);
  assertEquals(calls.find((c) => c.name === 'storageRemove'), { name: 'storageRemove', args: { bucket: 'audio', paths: ['owned/file'] } });
});
Deno.test('storage residue blocks auth deletion', async () => {
  const { adapters, settings } = fixture(); settings.storageRemains = true;
  await adapters.consumeProof(OWNER, 'a'.repeat(64));
  await assertRejects(() => adapters.removeOwnedStorage(OWNER), Error, 'storage_residue');
});
Deno.test('auth deletion requires authoritative not-found readback, never a successful delete response alone', async () => {
  const { settings, adapters } = fixture(); settings.authAbsent = false;
  await adapters.consumeProof(OWNER, 'a'.repeat(64));
  assertEquals(await adapters.deleteAuthUser(OWNER), { deleted: null });
  // A second destructive attempt cannot adopt the retained auth_unknown claim.
  assertEquals(await adapters.deleteAuthUser(OWNER), { deleted: null });
  const fresh = fixture(); await fresh.adapters.consumeProof(OWNER, 'a'.repeat(64));
  assertEquals(await fresh.adapters.deleteAuthUser(OWNER), { deleted: true });
});
for (const mode of ['deleteThrows', 'readThrows'] as const) {
  Deno.test(`auth deletion ${mode} preserves unknown intent and never records false non-deletion`, async () => {
    const { settings, adapters, calls } = fixture(); settings[mode] = true;
    await adapters.consumeProof(OWNER, 'a'.repeat(64));
    assertEquals(await adapters.deleteAuthUser(OWNER), { deleted: null });
    const journalIndex = calls.findIndex((c) => c.name === 'record_account_closure_auth_state_with_drain');
    assertEquals(journalIndex > -1 && journalIndex < calls.findIndex((c) => c.name === 'deleteUser'), true);
    assertEquals(calls.filter((c) => c.name === 'record_account_closure_auth_state_with_drain').map((c) =>
      (c.args as { p_state: string }).p_state), ['auth_unknown']);
  });
}

Deno.test('missing binding or wrong executing worker refuses before claim/provider work', async () => {
  for (const setting of ['ACCOUNT_CLOSURE_RUNTIME_BINDING', 'DENO_DEPLOYMENT_ID']) {
    const { environment, adapters, calls } = fixture(); delete environment[setting];
    await assertRejects(() => adapters.consumeProof(OWNER, 'a'.repeat(64)));
    assertEquals(calls.length, 0);
  }
});
Deno.test('handler rejects missing, malformed and mismatched backend bindings before any outbound bearer request', async () => {
  for (const mode of ['missing', 'malformed', 'foreign', 'worker']) {
    const { environment } = fixture();
    Object.assign(environment, { SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' });
    if (mode === 'missing') delete environment.ACCOUNT_CLOSURE_RUNTIME_BINDING;
    else if (mode === 'malformed') environment.ACCOUNT_CLOSURE_RUNTIME_BINDING = 'not-json';
    else if (mode === 'foreign') environment.SUPABASE_URL = 'https://foreign.example.test';
    else environment.DENO_DEPLOYMENT_ID = 'fixture-project_different_2';
    const original = globalThis.fetch; const outbound: string[] = [];
    globalThis.fetch = (input) => { outbound.push(String(input)); return Promise.resolve(new Response('{}', { status: 401 })); };
    try {
      const response = await handler(new Request('https://example.test', { method: 'POST',
        headers: { Authorization: 'Bearer synthetic-user-token' },
        body: JSON.stringify({ action: 'request' }) }), (key) => environment[key]);
      assertEquals(outbound.length, 0, `${mode}: bearer authentication escaped before target validation`);
      assertEquals(response.status, 503);
    } finally { globalThis.fetch = original; }
  }
});
Deno.test('expired current drain blocks every subsequent irreversible provider/storage boundary', async () => {
  for (const boundary of ['cancel', 'customer', 'storage', 'auth']) {
    const { adapters, calls, settings } = fixture();
    await adapters.consumeProof(OWNER, 'a'.repeat(64)); settings.authorityExpired = true;
    const operation = boundary === 'cancel' ? () => adapters.cancelSubscription('sub', { invoice_now: false, prorate: false, idempotencyKey: 'test' })
      : boundary === 'customer' ? () => adapters.deleteCustomer('cus')
      : boundary === 'storage' ? () => adapters.removeOwnedStorage(OWNER) : () => adapters.deleteAuthUser(OWNER);
    await assertRejects(operation);
    assertEquals(calls.some((c) => ['cancelSubscription', 'deleteCustomer', 'storageRemove', 'deleteUser'].includes(c.name)), false);
  }
});
Deno.test('context drift after a provider call preserves the uncertain fence instead of finishing/replaying', async () => {
  const { adapters, calls, stripe, environment, deps } = fixture();
  await adapters.consumeProof(OWNER, 'a'.repeat(64));
  stripe.subscriptions.cancel = (() => { delete environment.DENO_DEPLOYMENT_ID; return Promise.resolve({}); }) as unknown as typeof stripe.subscriptions.cancel;
  await assertRejects(() => adapters.cancelSubscription('sub', { invoice_now: false, prorate: false, idempotencyKey: 'test' }));
  await deps.finish(OWNER, REQUEST);
  assertEquals(calls.some((c) => c.name === 'finish_account_closure_attempt'), false);
});
Deno.test('public confirm composes guarded claim, deletion and accepted recovery with persisted completion readback', async () => {
  const { deps, calls, settings } = fixture();
  const response = await handleClosureRequest(new Request('https://example.test', { method: 'POST',
    body: JSON.stringify({ action: 'confirm', token: 'a'.repeat(64), confirmIrreversible: true }) }), deps);
  assertEquals(response.status, 200);
  assertEquals((await response.json()).outcome, 'deleted');
  assertEquals(settings.authorityPhase, 'completed');
  assertEquals(calls.filter((c) => c.name === 'deleteUser').length, 1);
  assertEquals(calls.filter((c) => c.name === 'record_account_closure_auth_state_with_drain')
    .map((c) => (c.args as { p_state: string }).p_state), ['auth_unknown', 'auth_deleted', 'completed']);
  assertEquals(calls.some((c) => ['claim_account_closure_token', 'settle_account_closure_billing',
    'record_account_closure_auth_state', 'verify_account_closure_residue'].includes(c.name)), false);
});
