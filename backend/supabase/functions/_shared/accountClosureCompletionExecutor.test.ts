import { strict as a } from 'node:assert';
import { createAccountCompletionExecutor, type CompletionExecutorPorts } from './accountClosureCompletionExecutor.ts';
import type { CompletionGrant } from './accountClosureCompletion.ts';

const USER = '10000000-0000-4000-8000-000000000001', REQUEST = '20000000-0000-4000-8000-000000000002';
const EXECUTION = '30000000-0000-4000-8000-000000000003';
function fixture() {
  const binding = { projectId: 'fixture-project', environment: 'production' as const,
    url: 'https://fixture-project.supabase.co', scopeDigest: 'e'.repeat(64) };
  const state = { now: 1000, claimed: false, ack: true, pending: false, current: binding as unknown,
    user: USER as string | null, lostBegin: false, lostFinish: false, driftAtCheckout: false, terminal: true,
    stages: new Map<string, string>(), effects: [] as string[], calls: [] as { name: string; args: Record<string, unknown> }[], clients: 0 };
  const grant: CompletionGrant = { userId: USER, requestId: REQUEST, executionId: EXECUTION, scopeDigest: binding.scopeDigest,
    expiresAt: 301000, proof: { userId: USER, requestId: REQUEST, email: 'synthetic@example.invalid', customerId: null, expiresAt: 301000 },
    settled: { checkout: true, saves: true, coaching: true, portal: true } };
  const receipt = (key: string, phase: string) => ({ userId: USER, requestId: REQUEST, executionId: EXECUTION,
    scopeDigest: binding.scopeDigest, key, phase });
  const ports: CompletionExecutorPorts = {
    enabled: true, currentBinding: async () => state.current,
    createAdminClient: url => {
      a.equal(url, binding.url); state.clients++;
      return { rpc: async (name, args) => {
        state.calls.push({ name, args: structuredClone(args) });
        a.equal(args.p_scope_digest, binding.scopeDigest);
        if (args.p_user_id !== USER || args.p_request_id !== REQUEST) return { data: null, error: null };
        if (name === 'claim_account_pending_completion_v1') {
          if (!state.ack || state.pending) return { data: { outcome: 'pending' }, error: null };
          if (state.claimed) return { data: null, error: null };
          state.claimed = true; return { data: structuredClone(grant), error: null };
        }
        if (name === 'inspect_account_pending_completion_v1') return { data: receipt('authority', 'processing'), error: null };
        const key = String(args.p_key);
        if (name === 'begin_account_completion_stage_v1') {
          const old = state.stages.get(key); if (!old) state.stages.set(key, 'started');
          return { data: state.lostBegin ? null : receipt(key, old ?? 'dispatch'), error: null };
        }
        if (name === 'finish_account_completion_stage_v1') {
          if (state.stages.get(key) === 'started') state.stages.set(key, String(args.p_outcome));
          return { data: state.lostFinish ? null : receipt(key, state.stages.get(key)!), error: null };
        }
        if (name === 'complete_account_pending_completion_v1') return { data: state.terminal ? receipt('completion', 'completed') : null, error: null };
        throw new Error('unexpected RPC');
      } };
    },
    authenticate: async (_request, url) => {
      a.equal(url, binding.url);
      return { error: null, data: { user: state.user ? { id: state.user, email_confirmed_at: '2026-10-27T00:00:00Z' } : null } };
    },
    policy: {
      now: () => state.now,
      verifyCheckouts: async () => { if (state.driftAtCheckout) state.current = { ...binding, scopeDigest: 'f'.repeat(64) }; return true; },
      customer: async id => ({ id }), subscriptions: async () => ({ data: [], hasMore: false }),
      cancelSubscription: async () => { throw new Error('not a free-account call'); },
      settleBilling: async () => { throw new Error('not a free-account call'); },
      deleteCustomer: async () => { throw new Error('not a free-account call'); },
      preserveTrialEmail: async () => { state.effects.push('retain'); },
      listStorage: async () => [], removeStorageObject: async () => { throw new Error('no fixture objects'); },
      deleteAuthUser: async g => { state.effects.push('auth'); return { userId: g.userId, deleted: true }; },
    },
  };
  const request = (bearer = true) => new Request(binding.url, { headers: bearer ? { Authorization: 'Bearer synthetic-user-jwt' } : {} });
  return { binding, state, grant, ports, request, execute: () => createAccountCompletionExecutor(binding, ports).execute(request(), { requestId: REQUEST }) };
}
Deno.test('completion composition: real controller + RPC adapter + policy require durable terminal receipt', async () => {
  const f = fixture(); a.equal((await f.execute()).outcome, 'completed');
  a.deepEqual(f.state.effects, ['retain', 'auth']);
  a.equal(f.state.calls[0].name, 'claim_account_pending_completion_v1');
  a.equal(f.state.calls.at(-1)?.name, 'complete_account_pending_completion_v1');
  a.deepEqual([...f.state.stages.values()], ['completed', 'completed', 'completed']);
});
Deno.test('completion default is off before clients, authentication or RPC', async () => {
  const f = fixture(); delete f.ports.enabled;
  a.deepEqual(await f.execute(), { outcome: 'unavailable' }); a.equal(f.state.clients, 0); a.equal(f.state.calls.length, 0);
});
for (const kind of ['missing', 'changed', 'wrong-target'] as const) Deno.test(`completion rejects ${kind} binding before effects`, async () => {
  const f = fixture();
  if (kind === 'missing') f.state.current = null;
  if (kind === 'changed') f.state.current = { ...f.binding, scopeDigest: 'f'.repeat(64) };
  if (kind === 'wrong-target') { f.binding.url = 'https://other.supabase.co'; f.state.current = f.binding; }
  a.deepEqual(await f.execute(), { outcome: 'unavailable' }); a.equal(f.state.clients, 0); a.deepEqual(f.state.effects, []);
});
Deno.test('capability or missing JWT cannot claim; authoritative owner lookup is mandatory', async () => {
  const f = fixture(), executor = createAccountCompletionExecutor(f.binding, f.ports);
  a.deepEqual(await executor.execute(f.request(false), { requestId: REQUEST }), { outcome: 'unauthorized' });
  f.state.user = null; a.deepEqual(await f.execute(), { outcome: 'unauthorized' }); a.equal(f.state.calls.length, 0);
});
Deno.test('browser identity/scope extras cannot retarget execution', async () => {
  const f = fixture(); a.deepEqual(await createAccountCompletionExecutor(f.binding, f.ports).execute(f.request(), {
    requestId: REQUEST, userId: USER, scopeDigest: f.binding.scopeDigest,
  }), { outcome: 'unavailable' }); a.equal(f.state.calls.length, 0);
});
for (const kind of ['ack', 'obligation'] as const) Deno.test(`completion does not dispatch when SQL reports missing ${kind}`, async () => {
  const f = fixture(); if (kind === 'ack') f.state.ack = false; else f.state.pending = true;
  a.deepEqual(await f.execute(), { outcome: 'pending' }); a.deepEqual(f.state.effects, []);
});
Deno.test('duplicate request never replays effects through a fresh executor instance', async () => {
  const f = fixture(); a.equal((await f.execute()).outcome, 'completed'); a.equal((await f.execute()).outcome, 'hold');
  a.deepEqual(f.state.effects, ['retain', 'auth']);
});
Deno.test('lost begin acknowledgment retains intent but dispatches nothing', async () => {
  const f = fixture(); f.state.lostBegin = true; a.equal((await f.execute()).outcome, 'hold');
  a.equal(f.state.stages.get('retain_trial'), 'started'); a.deepEqual(f.state.effects, []);
});
Deno.test('lost finish acknowledgment stops later effects and never retries first effect', async () => {
  const f = fixture(); f.state.lostFinish = true; a.equal((await f.execute()).outcome, 'hold');
  a.equal((await f.execute()).outcome, 'hold'); a.deepEqual(f.state.effects, ['retain']);
});
Deno.test('context drift during awaited provider read fences the next effect', async () => {
  const f = fixture(); f.state.driftAtCheckout = true; a.equal((await f.execute()).outcome, 'hold'); a.deepEqual(f.state.effects, []);
});
Deno.test('expired execution and missing terminal receipt do not report completion', async () => {
  const expired = fixture(); expired.state.now = expired.grant.expiresAt;
  a.equal((await expired.execute()).outcome, 'hold'); a.deepEqual(expired.state.effects, []);
  const missing = fixture(); missing.state.terminal = false; a.equal((await missing.execute()).outcome, 'hold');
});
Deno.test('missing paid adapter refuses before claiming any execution', async () => {
  const f = fixture(); delete (f.ports.policy as Partial<typeof f.ports.policy>).settleBilling;
  a.equal((await f.execute()).outcome, 'unavailable'); a.equal(f.state.calls.length, 0);
});
