import { strict as a } from 'node:assert';
import { handler } from './index.ts';
import { handleAccountCompletionExecutionRequest, ACCOUNT_COMPLETION_EXECUTION_PATH as PATH } from '../_shared/accountClosureCompletionExecutionRequest.ts';
import { ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256 } from '../_shared/accountClosureCompletionRuntimeBinding.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CompletionPolicyPorts } from '../_shared/accountClosureCompletionPolicy.ts';

const USER = '10000000-0000-4000-8000-000000000001', REQUEST = '20000000-0000-4000-8000-000000000002';
const body = { action: 'completion_execute', requestId: REQUEST, confirmIrreversible: true };
const request = (value: unknown = body, path = PATH, bearer = true) => new Request(`https://fixture-project.supabase.co${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer synthetic-user-jwt' } : {}) }, body: JSON.stringify(value),
});
async function fixture() {
  const context = { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64), migrationDigest: ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256,
    projectId: 'fixture-project', environment: 'production' };
  const deploymentId = 'fixture-project_function_2', url = 'https://fixture-project.supabase.co';
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(
    [1, deploymentId, context.candidateSha, context.configDigest, context.migrationDigest, context.projectId, context.environment, url]))));
  const scopeDigest = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  const settings: Record<string, string> = { SUPABASE_URL: url, DENO_DEPLOYMENT_ID: deploymentId,
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-unused-key', ACCOUNT_COMPLETION_RUNTIME_BINDING: JSON.stringify({ version: 1, deploymentId, context, scopeDigest }) };
  const state = { clients: 0, auth: 0, calls: [] as string[], complete: false, claimed: false, authenticated: true,
    stages: new Map<string, string>(), effects: [] as string[] };
  const executionId = '30000000-0000-4000-8000-000000000003', expiresAt = Date.now() + 300000;
  const receipt = (key: string, phase: string) => ({ userId: USER, requestId: REQUEST, executionId, scopeDigest, key, phase });
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push(name); a.equal(args.p_user_id, USER); a.equal(args.p_request_id, REQUEST); a.equal(args.p_scope_digest, scopeDigest);
    if (name === 'claim_account_pending_completion_v1') {
      if (!state.complete) return { error: null, data: { outcome: 'pending' } };
      if (state.claimed) return { error: null, data: null };
      state.claimed = true;
      return { error: null, data: { userId: USER, requestId: REQUEST, executionId, scopeDigest, expiresAt,
        proof: { userId: USER, requestId: REQUEST, customerId: null, email: 'synthetic@example.invalid', expiresAt },
        settled: { checkout: true, saves: true, coaching: true, portal: true } } };
    }
    if (name === 'inspect_account_pending_completion_v1') return { error: null, data: receipt('authority', 'processing') };
    const key = String(args.p_key);
    if (name === 'begin_account_completion_stage_v1') {
      const old = state.stages.get(key); if (!old) state.stages.set(key, 'started');
      return { error: null, data: receipt(key, old ?? 'dispatch') };
    }
    if (name === 'finish_account_completion_stage_v1') {
      state.stages.set(key, String(args.p_outcome)); return { error: null, data: receipt(key, String(args.p_outcome)) };
    }
    if (name === 'complete_account_pending_completion_v1') return { error: null, data: receipt('completion', 'completed') };
    throw new Error('no fixture effect RPC');
  }, auth: { getUser: async () => { state.auth++; return { error: null, data: { user: state.authenticated
    ? { id: USER, email_confirmed_at: '2026-10-27T00:00:00Z' } : null } }; } } };
  const policy: CompletionPolicyPorts = { now: () => Date.now(), verifyCheckouts: async () => state.complete,
    customer: async id => ({ id }), subscriptions: async () => ({ data: [], hasMore: false }),
    cancelSubscription: async () => { throw new Error('no dispatch'); }, settleBilling: async () => { state.effects.push('settle'); },
    deleteCustomer: async id => ({ id, deleted: false }), preserveTrialEmail: async () => { state.effects.push('retain'); },
    listStorage: async () => [], removeStorageObject: async () => { state.effects.push('storage'); },
    deleteAuthUser: async g => { state.effects.push('auth'); return { userId: g.userId, deleted: true }; } };
  const factory = () => { state.clients++; return client as unknown as SupabaseClient; };
  return { settings, state, env: (name: string) => settings[name], factory, policy };
}
for (const path of [PATH, `/functions/v1${PATH}`]) Deno.test(`actual handler composes new-grant execution at ${path}`, async () => {
  const f = await fixture(); const response = await handler(request(body, path), f.env, f.factory, () => f.policy);
  a.equal(response.status, 202); a.equal(response.headers.get('Cache-Control'), 'no-store');
  a.deepEqual(await response.json(), { outcome: 'pending', requestId: REQUEST, canRetry: false });
  a.equal(f.state.auth, 1); a.deepEqual(f.state.calls, ['claim_account_pending_completion_v1']); a.deepEqual(f.state.effects, []);
});
Deno.test('actual handler with missing/wrong binding refuses before SDK or request body access', async () => {
  const f = await fixture(); delete f.settings.ACCOUNT_COMPLETION_RUNTIME_BINDING;
  const req = request(); Object.defineProperty(req, 'body', { get: () => { throw new Error('body accessed before binding'); } });
  a.equal((await handler(req, f.env, f.factory, () => f.policy)).status, 503); a.equal(f.state.clients, 0);
  f.settings.ACCOUNT_COMPLETION_RUNTIME_BINDING = '{}';
  a.equal((await handler(request(), f.env, f.factory, () => f.policy)).status, 503); a.equal(f.state.clients, 0);
});
Deno.test('actual handler rejects nonowner and never invokes legacy closure/token RPC', async () => {
  const f = await fixture(); f.state.authenticated = false;
  a.equal((await handler(request(), f.env, f.factory, () => f.policy)).status, 401);
  a.deepEqual(f.state.calls, []); a.deepEqual(f.state.effects, []);
});
Deno.test('actual handler completes through the real controller once; duplicate HTTP request cannot replay', async () => {
  const f = await fixture(); f.state.complete = true;
  const response = await handler(request(), f.env, f.factory, () => f.policy);
  a.equal(response.status, 200); a.deepEqual(await response.json(), { outcome: 'completed', requestId: REQUEST, accountDeleted: true, canRetry: false });
  a.deepEqual(f.state.effects, ['retain', 'auth']); a.equal(f.state.calls.at(-1), 'complete_account_pending_completion_v1');
  a.equal(f.state.calls.includes('claim_account_closure_token_with_drain'), false);
  a.equal((await handler(request(), f.env, f.factory, () => f.policy)).status, 503);
  a.deepEqual(f.state.effects, ['retain', 'auth']); a.deepEqual([...f.state.stages.values()], ['completed', 'completed', 'completed']);
});
Deno.test('request adapter refuses capability-only, missing confirmation, identity extras and status actions', async () => {
  let calls = 0; const executor = { execute: async () => { calls++; return { outcome: 'pending' as const }; } };
  a.equal((await handleAccountCompletionExecutionRequest(request(body, PATH, false), executor)).status, 401);
  for (const value of [{ action: body.action, requestId: REQUEST }, { ...body, userId: USER },
    { ...body, action: 'completion_status_read' }, { ...body, confirmIrreversible: false }]) {
    a.equal((await handleAccountCompletionExecutionRequest(request(value), executor)).status, 400);
  }
  a.equal(calls, 0);
});
Deno.test('request route aliases/query, oversize and malformed body refuse without execution', async () => {
  let calls = 0; const executor = { execute: async () => { calls++; return { outcome: 'pending' as const }; } };
  for (const path of [`${PATH}/`, `${PATH}?token=synthetic`, '/account-closure/completion-status']) {
    a.ok([400, 404].includes((await handleAccountCompletionExecutionRequest(request(body, path), executor)).status));
  }
  a.equal((await handleAccountCompletionExecutionRequest(request({ ...body, padding: 'x'.repeat(4096) }), executor)).status, 413);
  const malformed = new Request(`https://fixture-project.supabase.co${PATH}`, { method: 'POST',
    headers: { Authorization: 'Bearer synthetic-jwt', 'Content-Type': 'application/json' }, body: '{' });
  a.equal((await handleAccountCompletionExecutionRequest(malformed, executor)).status, 400); a.equal(calls, 0);
});
Deno.test('request failure is content-safe and completion reply exposes no provider internals', async () => {
  const failure = await handleAccountCompletionExecutionRequest(request(), { execute: async () => { throw new Error('private-provider-body'); } });
  a.equal(failure.status, 503); a.equal((await failure.text()).includes('private-provider-body'), false);
  const response = await handleAccountCompletionExecutionRequest(request(), { execute: async () => ({ outcome: 'completed',
    result: { outcome: 'deleted', stage: 'residue', billingClosed: true, customerDeleted: true, accountDeleted: true } }) });
  a.deepEqual(await response.json(), { outcome: 'completed', requestId: REQUEST, accountDeleted: true, canRetry: false });
});
