import { describe, expect, it, vi } from 'vitest';
import { completePendingAccount, type CompletionGrant, type CompletionPorts } from '../../backend/supabase/functions/_shared/accountClosureCompletion';
import type { ClosureDependencies } from '../../backend/supabase/functions/_shared/accountClosure';

const request = { userId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222' };
const scope = 'a'.repeat(64);
function fixture(customerId: string | null = null) {
  const grant: CompletionGrant = { ...request, executionId: '33333333-3333-4333-8333-333333333333', scopeDigest: scope,
    expiresAt: 2000, proof: { ...request, email: 'owner@example.test', customerId, expiresAt: 2000 },
    settled: { checkout: true, saves: true, coaching: true, portal: true } };
  const events: string[] = [];
  const journal = new Map<string, string>();
  const row = (key: string, phase: string) => ({ ...request, executionId: grant.executionId, scopeDigest: scope, key, phase });
  let claimed = false;
  const policy: Omit<ClosureDependencies, 'consumeProof' | 'verifyResidue'> = {
    now: () => 1000,
    verifyCheckouts: vi.fn(async () => true),
    listSubscriptions: vi.fn().mockResolvedValueOnce({ complete: true, subscriptions: [{ id: 'sub', status: 'active' }] })
      .mockResolvedValue({ complete: true, subscriptions: [{ id: 'sub', status: 'canceled' }] }),
    cancelSubscription: vi.fn(async () => { events.push('effect:cancel'); }),
    settleBilling: vi.fn(async () => { events.push('effect:billing'); }),
    deleteCustomer: vi.fn(async () => { events.push('effect:customer'); return { deleted: true }; }),
    preserveTrialEmail: vi.fn(async () => { events.push('effect:trial'); }),
    removeOwnedStorage: vi.fn(async () => { events.push('effect:storage'); }),
    deleteAuthUser: vi.fn(async () => { events.push('effect:auth'); return { deleted: true }; }),
  };
  const ports: CompletionPorts = {
    now: () => 1000,
    currentScopeDigest: vi.fn(async () => scope),
    claim: vi.fn(async () => {
      if (claimed) return { outcome: 'busy' };
      claimed = true; return structuredClone(grant);
    }),
    inspect: vi.fn(async () => row('authority', 'processing')),
    beginStage: vi.fn(async (_grant, key) => {
      events.push(`begin:${key}`);
      if (!journal.has(key)) journal.set(key, 'started');
      else return row(key, journal.get(key)!);
      return row(key, 'dispatch');
    }),
    finishStage: vi.fn(async (_grant, key, phase) => {
      events.push(`finish:${key}:${phase}`);
      if (journal.get(key) === 'started') journal.set(key, phase);
      return row(key, journal.get(key)!);
    }),
    complete: vi.fn(async () => { events.push('complete'); return row('completion', 'completed'); }),
    policy: vi.fn(() => policy),
  };
  return { grant, ports, policy, events, journal, row };
}
const effects = (f: ReturnType<typeof fixture>) => f.events.filter(event => event.startsWith('effect:'));

describe('inactive durable pending account completion controller', () => {
  it('uses one existing policy and journals every Free-account effect before dispatch', async () => {
    const f = fixture();
    expect(await completePendingAccount(request, f.ports)).toMatchObject({ outcome: 'completed', result: { outcome: 'deleted' } });
    expect(f.events).toEqual(['begin:retain_trial', 'effect:trial', 'finish:retain_trial:completed',
      'begin:remove_storage', 'effect:storage', 'finish:remove_storage:completed',
      'begin:delete_auth', 'effect:auth', 'finish:delete_auth:completed', 'complete']);
    expect(f.policy.preserveTrialEmail).toHaveBeenCalledWith(request.userId, 'owner@example.test');
    expect(f.policy.listSubscriptions).not.toHaveBeenCalled();
  });

  it('keeps paid cancellation/billing/customer ordering and request-bound idempotency keys', async () => {
    const f = fixture('customer');
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('completed');
    expect(effects(f)).toEqual(['effect:cancel', 'effect:billing', 'effect:customer', 'effect:trial', 'effect:storage', 'effect:auth']);
    expect(f.policy.cancelSubscription).toHaveBeenCalledWith('sub', {
      invoice_now: false, prorate: false, idempotencyKey: `account-closure:${request.requestId}:sub`,
    });
  });

  it.each(['checkout', 'saves', 'coaching', 'portal'] as const)('unsettled %s blocks every irreversible effect', async field => {
    const f = fixture();
    vi.mocked(f.ports.claim).mockResolvedValue({ ...f.grant, settled: { ...f.grant.settled, [field]: false } });
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(f.ports.policy).not.toHaveBeenCalled(); expect(effects(f)).toEqual([]);
  });

  it('pending readiness does not construct a provider policy', async () => {
    const f = fixture(); vi.mocked(f.ports.claim).mockResolvedValue({ outcome: 'pending' });
    expect(await completePendingAccount(request, f.ports)).toEqual({ outcome: 'pending' });
    expect(f.ports.policy).not.toHaveBeenCalled(); expect(effects(f)).toEqual([]);
  });

  it('competing callers dispatch once under a simulated atomic claim (not native SQL proof)', async () => {
    const f = fixture(); const results = await Promise.all([completePendingAccount(request, f.ports), completePendingAccount(request, f.ports)]);
    expect(results.filter(value => value.outcome === 'completed')).toHaveLength(1);
    expect(f.policy.deleteAuthUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...request, userId: 'bad' }, { ...request, requestId: 'bad' }, { ...request, token: 'old-email-token' },
  ])('rejects malformed or caller-added request authority before claim (%j)', async input => {
    const f = fixture();
    expect((await completePendingAccount(input, f.ports)).outcome).toBe('hold');
    expect(f.ports.claim).not.toHaveBeenCalled(); expect(effects(f)).toEqual([]);
  });

  it.each(['owner', 'request', 'execution', 'scope', 'expiry', 'proof', 'extra'])('rejects mismatched %s claim before policy', async mode => {
    const f = fixture(); const value: Record<string, unknown> = structuredClone(f.grant);
    if (mode === 'owner') value.userId = '44444444-4444-4444-8444-444444444444';
    if (mode === 'request') value.requestId = '44444444-4444-4444-8444-444444444444';
    if (mode === 'execution') value.executionId = 'bad';
    if (mode === 'scope') value.scopeDigest = 'b'.repeat(64);
    if (mode === 'expiry') value.expiresAt = 1000;
    if (mode === 'proof') value.proof = { ...f.grant.proof, customerId: undefined };
    if (mode === 'extra') value.destructiveEnabled = true;
    vi.mocked(f.ports.claim).mockResolvedValue(value);
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(f.ports.policy).not.toHaveBeenCalled(); expect(effects(f)).toEqual([]);
  });

  it('claim transport failure with sensitive error material emits only a bounded code', async () => {
    const f = fixture(); vi.mocked(f.ports.claim).mockRejectedValue(new Error('SECRET owner@example.test'));
    const result = await completePendingAccount(request, f.ports);
    expect(result).toEqual({ outcome: 'hold', reason: 'claim_unavailable' });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|example/); expect(effects(f)).toEqual([]);
  });

  it('scope changes before policy selection prevent dispatch', async () => {
    const f = fixture(); vi.mocked(f.ports.currentScopeDigest).mockResolvedValueOnce(scope).mockResolvedValue('b'.repeat(64));
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(f.ports.policy).not.toHaveBeenCalled(); expect(effects(f)).toEqual([]);
  });

  it('expired authority during execution stops later effects and preserves the started intent', async () => {
    const f = fixture(); let now = 1000; f.ports.now = () => now;
    vi.mocked(f.policy.preserveTrialEmail).mockImplementation(async () => { now = 2000; f.events.push('effect:trial'); });
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(effects(f)).toEqual(['effect:trial']); expect(f.journal.get('retain_trial')).toBe('unknown');
    expect(f.policy.removeOwnedStorage).not.toHaveBeenCalled();
  });

  const dispatchStages = [
    ['cancel:sub', 'cancelSubscription'], ['settle_billing', 'settleBilling'],
    ['delete_customer', 'deleteCustomer'], ['retain_trial', 'preserveTrialEmail'],
    ['remove_storage', 'removeOwnedStorage'], ['delete_auth', 'deleteAuthUser'],
  ] as const;
  describe.each(dispatchStages)('deferred authority before %s', (key, method) => {
    it.each([1999, 2000, 2001, Number.NaN])('checks the post-inspection clock %s before dispatch', async resumeAt => {
      const f = fixture('customer'); let now = 1000; f.ports.now = () => now;
      let release!: () => void; let reached!: () => void;
      const paused = new Promise<void>(resolve => { reached = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      let intercepted = false;
      vi.mocked(f.ports.inspect).mockImplementation(async () => {
        if (!intercepted && f.journal.get(key) === 'started') {
          intercepted = true; reached(); await gate;
        }
        return f.row('authority', 'processing');
      });
      const result = completePendingAccount(request, f.ports);
      await paused;
      expect(f.policy[method]).not.toHaveBeenCalled();
      now = resumeAt; release();
      const allowed = resumeAt < f.grant.expiresAt;
      expect((await result).outcome).toBe(allowed ? 'completed' : 'hold');
      expect(f.policy[method]).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(f.journal.get(key)).toBe(allowed ? 'completed' : 'unknown');
      expect(f.ports.complete).toHaveBeenCalledTimes(allowed ? 1 : 0);
    });
  });

  it('rechecks expiry after the post-inspection binding read also waits', async () => {
    const f = fixture(); let now = 1000; let inspected = false;
    f.ports.now = () => now;
    let reached!: () => void; let release!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(f.ports.inspect).mockImplementation(async () => {
      if (f.journal.get('retain_trial') === 'started') inspected = true;
      return f.row('authority', 'processing');
    });
    vi.mocked(f.ports.currentScopeDigest).mockImplementation(async () => {
      if (inspected) { inspected = false; reached(); await gate; }
      return scope;
    });
    const result = completePendingAccount(request, f.ports);
    await paused; now = 2000; release();
    expect((await result).outcome).toBe('hold');
    expect(effects(f)).toEqual([]);
  });

  it('generic ports cannot change scope during inspection and then dispatch', async () => {
    const f = fixture(); let currentScope = scope;
    vi.mocked(f.ports.currentScopeDigest).mockImplementation(async () => currentScope);
    vi.mocked(f.ports.inspect).mockImplementation(async () => {
      if (f.journal.get('retain_trial') === 'started') currentScope = 'b'.repeat(64);
      return f.row('authority', 'processing');
    });
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(effects(f)).toEqual([]);
  });

  it('lost durable-intent acknowledgement does not dispatch the effect', async () => {
    const f = fixture(); vi.mocked(f.ports.beginStage).mockImplementation(async (_grant, key) => {
      f.journal.set(key, 'started'); throw new Error('lost SQL reply');
    });
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(f.journal.get('retain_trial')).toBe('started'); expect(effects(f)).toEqual([]);
  });

  it('wrong stage receipt refuses dispatch', async () => {
    const f = fixture(); vi.mocked(f.ports.beginStage).mockResolvedValue(f.row('wrong_key', 'started'));
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold'); expect(effects(f)).toEqual([]);
  });

  it.each(['started', 'unknown', 'completed'])('does not replay a prior %s stage', async phase => {
    const f = fixture(); f.journal.set('retain_trial', phase);
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold'); expect(effects(f)).toEqual([]);
  });

  it('unknown provider result is journaled once and never retried', async () => {
    const f = fixture('customer'); vi.mocked(f.policy.cancelSubscription).mockRejectedValue(new Error('lost provider reply'));
    expect(await completePendingAccount(request, f.ports)).toEqual({ outcome: 'hold', reason: 'effect_unverified' });
    expect(f.policy.cancelSubscription).toHaveBeenCalledTimes(1); expect(f.journal.get('cancel:sub')).toBe('unknown');
    expect(f.policy.settleBilling).not.toHaveBeenCalled(); expect(f.policy.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('lost completion acknowledgement holds and does not regress a durable completed stage', async () => {
    const f = fixture(); vi.mocked(f.ports.finishStage).mockImplementation(async (_grant, key, phase) => {
      if (f.journal.get(key) === 'started') f.journal.set(key, phase);
      if (phase === 'completed') throw new Error('reply lost after commit');
      return f.row(key, f.journal.get(key)!);
    });
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(f.journal.get('retain_trial')).toBe('completed'); expect(f.policy.preserveTrialEmail).toHaveBeenCalledTimes(1);
    expect(f.policy.removeOwnedStorage).not.toHaveBeenCalled();
  });

  it.each([false, null])('non-affirmative Auth deletion %s is unknown, not completion', async deleted => {
    const f = fixture(); vi.mocked(f.policy.deleteAuthUser).mockResolvedValue({ deleted });
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('hold');
    expect(f.journal.get('delete_auth')).toBe('unknown');
    expect(f.ports.complete).not.toHaveBeenCalled();
  });

  it.each([null, false, {}, 'completed'])('missing canonical SQL residue receipt %j never reports completion', async value => {
    const f = fixture(); vi.mocked(f.ports.complete).mockResolvedValue(value);
    expect(await completePendingAccount(request, f.ports)).toEqual({outcome:'hold',reason:'completion_unverified'});
    expect(f.ports.complete).toHaveBeenCalledTimes(1);
    expect(f.policy.deleteAuthUser).toHaveBeenCalledTimes(1);
  });

  it.each(['userId','requestId','executionId','scopeDigest','key','phase'])('rejects a terminal receipt with the wrong %s', async field => {
    const f=fixture();
    vi.mocked(f.ports.complete).mockResolvedValue({...f.row('completion','completed'),[field]:'wrong'});
    expect(await completePendingAccount(request,f.ports)).toEqual({outcome:'hold',reason:'completion_unverified'});
    expect(f.policy.deleteAuthUser).toHaveBeenCalledTimes(1);
  });

  it('lost final durable receipt never reports completed and does not repeat Auth deletion', async () => {
    const f = fixture(); vi.mocked(f.ports.complete).mockRejectedValue(new Error('terminal reply lost'));
    expect(await completePendingAccount(request, f.ports)).toEqual({ outcome: 'hold', reason: 'completion_unverified' });
    expect(f.policy.deleteAuthUser).toHaveBeenCalledTimes(1); expect(f.ports.complete).toHaveBeenCalledTimes(1);
  });

  it.each(['scope', 'expiry'])('final %s drift after the terminal RPC keeps the response on HOLD', async mode => {
    const f = fixture(); let now = 1000; let currentScope = scope;
    f.ports.now = () => now; f.ports.currentScopeDigest = async () => currentScope;
    vi.mocked(f.ports.complete).mockImplementation(async () => {
      if (mode === 'scope') currentScope = 'b'.repeat(64);
      else now = 2000;
      return f.row('completion', 'completed');
    });
    expect(await completePendingAccount(request, f.ports)).toEqual({ outcome: 'hold', reason: 'completion_unverified' });
    expect(f.policy.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(f.ports.complete).toHaveBeenCalledTimes(1);
  });

  it('a mutated supplier claim cannot retarget the frozen policy proof', async () => {
    const f = fixture(); vi.mocked(f.ports.policy).mockImplementation(() => {
      (f.grant.proof as { email: string }).email = 'different@example.test'; return f.policy;
    });
    expect((await completePendingAccount(request, f.ports)).outcome).toBe('completed');
    expect(f.policy.preserveTrialEmail).toHaveBeenCalledWith(request.userId, 'owner@example.test');
  });
});
