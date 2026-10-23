import { describe, expect, it, vi } from 'vitest';
import { createAccountCompletionPorts, createAccountCompletionRpc, type CompletionBinding } from '../../backend/supabase/functions/_shared/accountClosureCompletionAdapter';
import { completePendingAccount, type CompletionGrant } from '../../backend/supabase/functions/_shared/accountClosureCompletion';

const binding: CompletionBinding = { projectId: 'project-test', environment: 'production',
  url: 'https://project-test.supabase.co', scopeDigest: 'a'.repeat(64) };
const request = { userId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222' };
const grant: CompletionGrant = { ...request, executionId: '33333333-3333-4333-8333-333333333333',
  scopeDigest: binding.scopeDigest, expiresAt: 2000,
  proof: { ...request, email: 'owner@example.test', customerId: null, expiresAt: 2000 },
  settled: { checkout: true, saves: true, coaching: true, portal: true } };
function fixture() {
  const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(
    async () => ({ data: { outcome: 'pending' }, error: null }));
  const ports = { createAdminClient: vi.fn(() => ({ rpc })), currentBinding: vi.fn(async (): Promise<unknown> => structuredClone(binding)),
    policy: vi.fn(() => { throw new Error('not used'); }), now: () => 1000 };
  const adapter = createAccountCompletionPorts(binding, ports);
  return { rpc, ports, adapter };
}

describe('inactive exact-target pending completion adapter', () => {
  it('shares the pinned target transport with status RPCs without constructing effect ports', async () => {
    const f=fixture();
    const shared=createAccountCompletionRpc(binding,f.ports);
    const args={p_request_id:request.requestId,p_token_hash:'c'.repeat(64),p_scope_digest:binding.scopeDigest};
    await shared.rpc('read_account_completion_status_v1',args);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('read_account_completion_status_v1',args);
    expect(f.ports.policy).not.toHaveBeenCalled();
    expect(await shared.currentScopeDigest()).toBe(binding.scopeDigest);
  });
  it.each(['name','scope'])('shared transport rejects an unreviewed %s before any SDK call', async wrong => {
    const f=fixture(),shared=createAccountCompletionRpc(binding,f.ports);
    await expect(shared.rpc(wrong==='name'?'arbitrary_rpc':'read_account_completion_status_v1',{
      p_scope_digest:wrong==='scope'?'d'.repeat(64):binding.scopeDigest,
    })).rejects.toThrow('account_completion_unavailable');
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.ports.currentBinding).not.toHaveBeenCalled();
  });
  it('pins status arguments before an asynchronous binding check can let the caller mutate them', async () => {
    const f=fixture();let release!:(value:unknown)=>void;
    const gate=new Promise<unknown>(resolve=>{release=resolve;});
    f.ports.currentBinding.mockImplementationOnce(()=>gate);
    const shared=createAccountCompletionRpc(binding,f.ports);
    const args={p_request_id:request.requestId,p_token_hash:'c'.repeat(64),p_scope_digest:binding.scopeDigest};
    const pending=shared.rpc('read_account_completion_status_v1',args);
    args.p_token_hash='d'.repeat(64);args.p_scope_digest='d'.repeat(64);
    release(binding);await pending;
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('read_account_completion_status_v1',{
      p_request_id:request.requestId,p_token_hash:'c'.repeat(64),p_scope_digest:binding.scopeDigest,
    });
  });
  it('checks the exact scope snapshot dispatched to SQL even when a caller uses an accessor', async () => {
    const f=fixture(),shared=createAccountCompletionRpc(binding,f.ports);let reads=0;
    const args={p_request_id:request.requestId,get p_scope_digest(){return ++reads===1?binding.scopeDigest:'d'.repeat(64);}};
    await shared.rpc('read_account_completion_status_v1',args);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('read_account_completion_status_v1',{
      p_request_id:request.requestId,p_scope_digest:binding.scopeDigest,
    });
  });
  it.each([1999, 2000])('controller checks expiry after a deferred pinned-adapter inspection at %s', async resumeAt => {
    let now = 1000; let started = false; let inspected = false;
    let release!: () => void; let reached!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const row = (key: string, phase: string) => ({ ...request, executionId: grant.executionId,
      scopeDigest: binding.scopeDigest, key, phase });
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_account_pending_completion_v1') return { data: grant, error: null };
      if (name === 'inspect_account_pending_completion_v1') {
        if (started && !inspected) { inspected = true; reached(); await gate; }
        return { data: row('authority', 'processing'), error: null };
      }
      if (name === 'begin_account_completion_stage_v1') {
        started = true; return { data: row(String(args.p_key), 'dispatch'), error: null };
      }
      if (name === 'finish_account_completion_stage_v1') return { data: row(String(args.p_key), String(args.p_outcome)), error: null };
      return { data: row('completion', 'completed'), error: null };
    });
    const preserveTrialEmail = vi.fn(async () => {});
    const adapter = createAccountCompletionPorts(binding, {
      createAdminClient: () => ({ rpc }), currentBinding: async () => structuredClone(binding), now: () => now,
      policy: () => ({ now: () => now, verifyCheckouts: async () => true,
        listSubscriptions: async () => ({ complete: true, subscriptions: [] }),
        cancelSubscription: async () => {}, settleBilling: async () => {}, deleteCustomer: async () => ({ deleted: true }),
        preserveTrialEmail, removeOwnedStorage: async () => {}, deleteAuthUser: async () => ({ deleted: true }),
        verifyResidue: async () => ({ clean: true }) }),
    });
    const result = completePendingAccount(request, adapter);
    await paused; expect(preserveTrialEmail).not.toHaveBeenCalled(); now = resumeAt; release();
    expect((await result).outcome).toBe(resumeAt < grant.expiresAt ? 'completed' : 'hold');
    expect(preserveTrialEmail).toHaveBeenCalledTimes(resumeAt < grant.expiresAt ? 1 : 0);
  });
  it('uses one fixed backend client and an account/request claim without token fields', async () => {
    const f = fixture(); expect(await f.adapter.claim(request, binding.scopeDigest)).toEqual({ outcome: 'pending' });
    expect(f.ports.createAdminClient).toHaveBeenCalledExactlyOnceWith(binding.url);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('claim_account_pending_completion_v1', {
      p_user_id: request.userId, p_request_id: request.requestId, p_scope_digest: binding.scopeDigest,
    });
    expect(f.ports.currentBinding).toHaveBeenCalledTimes(2);
  });
  it('maps each stage operation to its reviewed RPC with bound executor identity', async () => {
    const f = fixture(); await f.adapter.inspect(grant); await f.adapter.beginStage(grant, 'delete_auth');
    await f.adapter.finishStage(grant, 'delete_auth', 'unknown'); await f.adapter.complete(grant);
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(['inspect_account_pending_completion_v1',
      'begin_account_completion_stage_v1', 'finish_account_completion_stage_v1', 'complete_account_pending_completion_v1']);
    for (const [, args] of f.rpc.mock.calls) expect(args).toMatchObject({ p_user_id: request.userId,
      p_request_id: request.requestId, p_execution_id: grant.executionId, p_scope_digest: binding.scopeDigest });
  });
  it.each([
    { ...binding, url: 'http://project-test.supabase.co' },
    { ...binding, url: 'https://different.supabase.co' },
    { ...binding, url: 'https://user:pass@project-test.supabase.co' },
    { ...binding, url: 'https://project-test.supabase.co/?retarget=1' },
    { ...binding, url: 'http://127.0.0.1:54321' },
    { ...binding, scopeDigest: 'bad' }, { ...binding, extra: 'not closed' },
  ])('rejects invalid target before constructing a client (%j)', value => {
    const factory = vi.fn();
    expect(() => createAccountCompletionPorts(value, { createAdminClient: factory, currentBinding: async () => binding,
      policy: () => { throw new Error('not used'); } })).toThrow('account_completion_unavailable');
    expect(factory).not.toHaveBeenCalled();
  });
  it('permits explicit disposable loopback only', () => {
    const factory = vi.fn(() => ({ rpc: vi.fn() }));
    createAccountCompletionPorts({ ...binding, environment: 'disposable', url: 'http://127.0.0.1:54321' }, {
      createAdminClient: factory, currentBinding: async () => binding, policy: () => { throw new Error('not used'); },
    });
    expect(factory).toHaveBeenCalledWith('http://127.0.0.1:54321');
  });
  it('a disposable label never permits a production target or constructs its client',()=>{
    const factory=vi.fn();
    expect(()=>createAccountCompletionRpc({...binding,environment:'disposable'},{createAdminClient:factory,currentBinding:async()=>binding}))
      .toThrow('account_completion_unavailable');
    expect(factory).not.toHaveBeenCalled();
  });
  it.each(['url', 'scopeDigest', 'environment'])('context drift in %s before SQL prevents the call', async field => {
    const f = fixture(); vi.mocked(f.ports.currentBinding).mockResolvedValue({ ...binding, [field]: 'changed' });
    await expect(f.adapter.claim(request, binding.scopeDigest)).rejects.toThrow('account_completion_unavailable');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('context drift after a SQL mutation discards the receipt without replay', async () => {
    const f = fixture(); vi.mocked(f.ports.currentBinding).mockResolvedValueOnce(binding).mockResolvedValue({ ...binding, scopeDigest: 'b'.repeat(64) });
    await expect(f.adapter.beginStage(grant, 'delete_auth')).rejects.toThrow('account_completion_unavailable');
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{ data: null, error: { message: 'private details' } }, { data: null }, null])('ambiguous/failed SDK response does not become success (%j)', async value => {
    const f = fixture(); f.rpc.mockResolvedValue(value as never);
    await expect(f.adapter.claim(request, binding.scopeDigest)).rejects.toThrow('account_completion_unavailable');
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('a thrown transport error is sanitized and never retried', async () => {
    const f = fixture(); f.rpc.mockRejectedValue(new Error('TOKEN owner@example.test'));
    await expect(f.adapter.claim(request, binding.scopeDigest)).rejects.toThrow(/^account_completion_unavailable$/);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('wrong claim scope never calls SQL', async () => {
    const f = fixture(); await expect(f.adapter.claim(request, 'b'.repeat(64))).rejects.toThrow('account_completion_unavailable');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('unknown stage identifiers cannot dispatch SQL', () => {
    const f = fixture(); expect(() => f.adapter.beginStage(grant, 'caller:arbitrary')).toThrow('account_completion_unavailable');
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
