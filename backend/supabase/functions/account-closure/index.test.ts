import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@16';
import { buildDependencies, handler, ACCOUNT_COMPLETION_STATUS_PATH } from './index.ts';
import { ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256 } from '../_shared/accountClosureCompletionRuntimeBinding.ts';
import { handleClosureRequest } from '../_shared/accountClosureRequest.ts';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 } from '../_shared/accountClosureRuntimeBinding.ts';

const OWNER = '10000000-0000-4000-8000-000000000001';
const REQUEST = '20000000-0000-4000-8000-000000000002';
const ATTESTATION = '30000000-0000-4000-8000-000000000003';

async function completionFixture() {
  const context = { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64),
    migrationDigest: ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256, projectId: 'fixture-project', environment: 'production' };
  const deploymentId = 'fixture-project_function_2', target = 'https://fixture-project.supabase.co';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(
    [1, deploymentId, context.candidateSha, context.configDigest, context.migrationDigest, context.projectId, context.environment, target],
  ))));
  const scopeDigest = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  const settings: Record<string, string> = { SUPABASE_URL: target, DENO_DEPLOYMENT_ID: deploymentId,
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-unused-network-key',
    ACCOUNT_COMPLETION_RUNTIME_BINDING: JSON.stringify({ version: 1, deploymentId, context, scopeDigest }) };
  const calls: { name: string; args: unknown }[] = [];
  const env = (name: string) => settings[name];
  const factory = (url: string, key: string, options: unknown) => {
    calls.push({ name: 'construct', args: { url, key, options } });
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { error: null, data: name === 'issue_account_completion_status_v1'
          ? { requestId: REQUEST, expiresAt: Date.now() + 60_000 }
          : name === 'acknowledge_account_completion_status_v1' ? true
            : { outcome: 'completed', requestId: REQUEST, canRetry: false, accountDeleted: true, expiresAt: Date.now() + 60_000 } };
      },
      auth: { getUser: async (jwt: string) => {
        calls.push({ name: 'getUser', args: { jwt, url } });
        return { data: { user: { id: OWNER } }, error: null };
      } },
    } as unknown as SupabaseClient;
  };
  const request = (action = 'completion_status_read', path = ACCOUNT_COMPLETION_STATUS_PATH, bearer: string | null = null) => new Request(
    `https://fixture-project.supabase.co${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ action, requestId: REQUEST,
      ...(action === 'completion_status_issue' ? {} : { token: 'f'.repeat(64) }) }) });
  return { settings, calls, env, factory, request, target, scopeDigest };
}

for (const path of [ACCOUNT_COMPLETION_STATUS_PATH, `/functions/v1${ACCOUNT_COMPLETION_STATUS_PATH}`]) {
  Deno.test(`completion status exact path ${path}: cap-only read requires no JWT/Auth call`, async () => {
    const f = await completionFixture(); const request = f.request('completion_status_read', path);
    const response = await handler(request, f.env, f.factory);
    assertEquals(response.status, 200); assertEquals(response.headers.get('Cache-Control'), 'no-store');
    assertEquals(await response.json(), { outcome: 'completed', requestId: REQUEST, canRetry: false, accountDeleted: true });
    assertEquals(f.calls.map(call => call.name), ['construct', 'read_account_completion_status_v1']);
    const data = f.calls[1].args as Record<string, unknown>;
    assertEquals(data.p_scope_digest, f.scopeDigest); assertEquals(data.p_request_id, REQUEST);
    assertEquals(data.p_token_hash === 'f'.repeat(64), false);
  });
}
for (const action of ['completion_status_issue', 'completion_status_ack']) {
  Deno.test(`completion ${action} uses explicit owner JWT on the same client/target as RPC`, async () => {
    const f = await completionFixture(), request = f.request(action, ACCOUNT_COMPLETION_STATUS_PATH, 'synthetic-owner-jwt');
    const response = await handler(request, f.env, f.factory); assertEquals(response.status, 200);
    const body = await response.json(); assertEquals(body.outcome, action.endsWith('issue') ? 'status_capability' : 'status_acknowledged');
    assertEquals(f.calls.filter(call => call.name === 'construct').length, 1);
    assertEquals(f.calls.find(call => call.name === 'getUser')?.args, { jwt: 'synthetic-owner-jwt', url: f.target });
    for (const call of f.calls.filter(call => call.name.endsWith('_v1'))) {
      assertEquals((call.args as Record<string, unknown>).p_scope_digest, f.scopeDigest);
    }
    assertEquals(f.calls.some(call => /delete|complete_account_pending|claim_account/.test(call.name)), false);
  });
  Deno.test(`completion ${action} without live credentials never calls Auth/RPC`, async () => {
    const f = await completionFixture(), response = await handler(f.request(action), f.env, f.factory);
    assertEquals(response.status, 401); assertEquals(f.calls.map(call => call.name), ['construct']);
  });
}
for (const missing of ['ACCOUNT_COMPLETION_RUNTIME_BINDING', 'SUPABASE_URL', 'DENO_DEPLOYMENT_ID', 'SUPABASE_SERVICE_ROLE_KEY']) {
  Deno.test(`completion missing ${missing}: unavailable before SDK construction`, async () => {
    const f = await completionFixture(); delete f.settings[missing];
    const response = await handler(f.request(), f.env, f.factory);
    assertEquals(response.status, 503); assertEquals(await response.json(), { outcome: 'unavailable', canRetry: false });
    assertEquals(f.calls, []);
  });
}
Deno.test('legacy drain binding cannot enable the completion route', async () => {
  const f = await completionFixture(); delete f.settings.ACCOUNT_COMPLETION_RUNTIME_BINDING;
  f.settings.ACCOUNT_CLOSURE_RUNTIME_BINDING = JSON.stringify({ version: 1, deploymentId: f.settings.DENO_DEPLOYMENT_ID, scope: { bindingDigest: f.scopeDigest } });
  const response = await handler(f.request(), f.env, f.factory); assertEquals(response.status, 503); assertEquals(f.calls, []);
});
for (const path of ['/account-closure/completion-status/', '/account-closure/completion-status/extra',
  '/account-closure%2Fcompletion-status', '/account-closure/completion%2Dstatus',
  '/functions/v1/account-closure/completion-status/extra', '/functions/v1/account-closure%2fcompletion-status']) {
  Deno.test(`completion lookalike ${path} cannot select status or legacy SDK`, async () => {
    const f = await completionFixture(), response = await handler(f.request('completion_status_read', path), f.env, f.factory);
    assertEquals(response.status, 404); assertEquals(f.calls, []);
  });
}
Deno.test('common CORS rejection and preflight precede binding/SDK for completion', async () => {
  const f = await completionFixture(); const denied = f.request(); denied.headers.set('Origin', 'https://evil.example.test');
  const rejected = await handler(denied, f.env, f.factory); assertEquals(rejected.status, 403); assertEquals(f.calls, []);
  const options = await handler(new Request(`https://fixture-project.supabase.co${ACCOUNT_COMPLETION_STATUS_PATH}`, {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
  }), f.env, f.factory); assertEquals(options.status, 204); assertEquals(f.calls, []);
});
Deno.test('allowed browser completion reply preserves exact CORS and no-store', async () => {
  const f = await completionFixture(), request = f.request(); request.headers.set('Origin', 'http://localhost:5173');
  const response = await handler(request, f.env, f.factory);
  assertEquals(response.status, 200); assertEquals(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assertEquals(response.headers.get('Cache-Control'), 'no-store');
});
Deno.test('completion dispatch passes the untouched request with one body reader and no clone', async () => {
  const f = await completionFixture(), request = f.request();
  const body = request.body!; const original = body.getReader.bind(body); let readers = 0;
  Object.defineProperty(body, 'getReader', { value: () => { readers++; return original(); } });
  Object.defineProperty(request, 'clone', { value: () => { throw new Error('request must not be cloned'); } });
  const response = await handler(request, f.env, f.factory);
  assertEquals(response.status, 200); assertEquals(readers, 1); assertEquals(request.bodyUsed, true);
  assertEquals(f.calls.some(call => call.name === 'getUser'), false);
});
Deno.test('an invalid or changed completion manifest never constructs an SDK client', async () => {
  const f = await completionFixture(); f.settings.DENO_DEPLOYMENT_ID = 'fixture-project_function_3';
  const response = await handler(f.request(), f.env, f.factory); assertEquals(response.status, 503); assertEquals(f.calls, []);
});
Deno.test('completion context change during RPC discards completed response without retry', async () => {
  const f = await completionFixture(); const create = (url: string, key: string, options: unknown) => {
    const client = f.factory(url, key, options);
    client.rpc = (() => { f.settings.DENO_DEPLOYMENT_ID = 'fixture-project_function_3';
      return Promise.resolve({ data: { outcome: 'completed', requestId: REQUEST, canRetry: false, accountDeleted: true, expiresAt: Date.now() + 60_000 }, error: null }); }) as unknown as typeof client.rpc;
    return client;
  };
  const response = await handler(f.request(), f.env, create);
  assertEquals(await response.json(), { outcome: 'unavailable', canRetry: false });
  assertEquals(f.calls.some(call => call.name === 'getUser'), false);
});

function fixture() {
  const calls: { name: string; args: unknown }[] = [];
  const settings = { deletedCustomer: false, authAbsent: true, customerOwner: 'cus', storageRemains: false,
    deleteThrows: false, readThrows: false, authorityExpired: false, authorityPhase: 'processing',
    journalResponseLost: '' as '' | 'committed' | 'not-committed', journalFailures: 0,
    authUnknownBeforeDelete: false, pendingFailure: '' as '' | 'missing' | 'lost',
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
      if (['issue_account_closure_pending_token','begin_account_closure_pending'].includes(name) && settings.pendingFailure) {
        if (settings.pendingFailure === 'lost') throw new Error('private lost reply');
        return { data: null, error: { code: 'PGRST202', message: 'missing pending function' } };
      }
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
        : name === 'begin_account_closure_pending' ? { requestId: REQUEST, phase: 'pending', destructiveEnabled: false, checkoutPending: 1 }
        : name === 'verify_account_closure_residue_with_drain' ? true : name === 'issue_account_closure_pending_token' ? [{ request_id: REQUEST }] : null;
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
  const auth = { rpc: async (name: string) => {
    calls.push({ name, args: {} });
    if (settings.pendingFailure === 'lost') throw new Error('private lost reply');
    return settings.pendingFailure === 'missing'
      ? { data: null, error: { code: 'PGRST202', message: 'missing pending function' } }
      : { data: { requestId: REQUEST, phase: 'pending', checkoutPending: 1, destructiveEnabled: false }, error: null };
  }, auth: {
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
Deno.test('pre-grant operator config is readable while ordinary closure remains disabled, with no outbound work', async () => {
  const { environment } = fixture();
  delete environment.ACCOUNT_CLOSURE_RUNTIME_BINDING;
  Object.assign(environment, { SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    STRIPE_SECRET_KEY: 'sk_test_synthetic', PAYMENTS_ENABLED: 'false', SB_REGION: 'us-east-1',
    SB_EXECUTION_ID: '44444444-4444-4444-8444-444444444444',
    DENO_DEPLOYMENT_ID: 'fixture-project_33333333-3333-4333-8333-333333333333_2' });
  const original = globalThis.fetch; let outbound = 0;
  globalThis.fetch = () => { outbound++; throw new Error('unexpected outbound'); };
  const env = (key: string) => environment[key];
  try {
    for (const [authorization, status] of [['Bearer synthetic-user', 403], ['Bearer synthetic-service', 200]] as const) {
      const response = await handler(new Request('https://fixture-project.supabase.co/functions/v1/account-closure?__operator_config=1', {
        method: 'POST', headers: { Authorization: authorization },
        body: JSON.stringify({ nonce: 'a'.repeat(64), expectedDeploymentId: environment.DENO_DEPLOYMENT_ID }),
      }), env);
      assertEquals(response.status, status);
    }
    const ordinary = await handler(new Request('https://example.test', { method: 'POST',
      headers: { Authorization: 'Bearer synthetic-user' }, body: JSON.stringify({ action: 'request' }) }), env);
    assertEquals(ordinary.status, 503); assertEquals(outbound, 0);
  } finally { globalThis.fetch = original; }
});
Deno.test('real pre-grant closure handler refuses lossy path and trailing-slash site evidence', async () => {
  const { environment } = fixture(); delete environment.ACCOUNT_CLOSURE_RUNTIME_BINDING;
  Object.assign(environment, { SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', STRIPE_SECRET_KEY: 'sk_test_synthetic',
    SB_REGION: 'us-east-1', SB_EXECUTION_ID: '44444444-4444-4444-8444-444444444444',
    DENO_DEPLOYMENT_ID: 'fixture-project_33333333-3333-4333-8333-333333333333_2' });
  const original = globalThis.fetch; let outbound = 0;
  globalThis.fetch = () => { outbound++; throw new Error('unexpected outbound'); };
  try {
    for (const suffix of ['', '/', '/nested']) {
      environment.SITE_URL = `https://example.test${suffix}`;
      const response = await handler(new Request('https://fixture-project.supabase.co/functions/v1/account-closure?__operator_config=1', {
        method: 'POST', headers: { Authorization: 'Bearer synthetic-service' },
        body: JSON.stringify({ nonce: 'a'.repeat(64), expectedDeploymentId: environment.DENO_DEPLOYMENT_ID }),
      }), (key) => environment[key]);
      assertEquals(response.status, suffix ? 503 : 200);
      if (!suffix) assertEquals((await response.json()).configuration.siteOrigin, environment.SITE_URL);
    }
    assertEquals(outbound, 0);
  } finally { globalThis.fetch = original; }
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
Deno.test('public confirm records pending without entering legacy destructive adapters', async () => {
  const { deps, calls } = fixture();
  const response = await handleClosureRequest(new Request('https://example.test', { method: 'POST',
    body: JSON.stringify({ action: 'confirm', token: 'a'.repeat(64), confirmIrreversible: true }) }), deps);
  assertEquals(response.status, 202);
  assertEquals(await response.json(), { outcome: 'pending', requestId: REQUEST, phase: 'pending', checkoutPending: 1, destructiveEnabled: false });
  assertEquals(calls.map(c => c.name), ['begin_account_closure_pending']);
  assertEquals((calls[0].args as { p_user_id: string }).p_user_id, OWNER);
  assertEquals((calls[0].args as { p_token_hash: string }).p_token_hash === 'a'.repeat(64), false);
});
for (const failure of ['missing','lost'] as const) {
  for (const action of ['request','confirm','status']) {
    Deno.test(`inactive ${action}: ${failure} RPC returns unknown/unavailable with no email or destructive fallback`, async () => {
      const { deps, calls, settings } = fixture(); settings.pendingFailure = failure;
      const response = await handleClosureRequest(new Request('https://example.test', { method: 'POST',
        body: JSON.stringify({ action, token: 'a'.repeat(64), confirmIrreversible: true }) }), deps);
      assertEquals(response.status, 503);
      assertEquals(response.headers.get('cache-control'), 'no-store');
      assertEquals(await response.json(), { error: 'account_closure_unavailable' });
      assertEquals(calls.map(call => call.name), [action === 'request' ? 'issue_account_closure_pending_token'
        : action === 'confirm' ? 'begin_account_closure_pending' : 'account_closure_pending_status']);
    });
  }
}
