import { describe, expect, it, vi } from 'vitest';
import { recoverAccountClosure, type ClosureRecoveryDependencies } from '../../backend/supabase/functions/_shared/accountClosureRecovery';

const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000002';
const otherId = '30000000-0000-4000-8000-000000000003';
const email = 'retained@example.test';

function fixture(initial = 'auth_unknown') {
  let phase = initial;
  let now = 1_000;
  const order: string[] = [];
  const authority = { userId, requestId, generation: '7', bindingDigest: 'a'.repeat(64), validFrom: 500, expiresAt: 2_000 };
  const deps: ClosureRecoveryDependencies = {
    now: () => now,
    readAuthority: vi.fn(async () => { order.push('authority'); return { ...authority }; }),
    inspectAttempt: vi.fn(async () => { order.push('journal'); return { userId, requestId, email, phase }; }),
    readAuthUser: vi.fn(async () => {
      order.push('auth');
      return { data: { user: null }, error: { status: 404, code: 'user_not_found' } };
    }),
    recordAuthState: vi.fn(async (_userId, _requestId, next) => { order.push(next); phase = next; }),
    verifyResidue: vi.fn(async () => { order.push('residue'); return true; }),
  };
  return { deps, authority, order, expire: () => { now = 2_000; }, setPhase: (next: string) => { phase = next; } };
}

describe('account closure recovery after an uncertain Auth deletion', () => {
  it('reconciles authoritative absence and full residue without repeating deletion', async () => {
    const { deps, order, authority } = fixture();
    expect(await recoverAccountClosure({ userId, requestId }, deps)).toEqual({ outcome: 'completed', stage: 'completion', reason: 'verified', accountDeleted: true });
    expect(vi.mocked(deps.recordAuthState).mock.calls).toEqual([
      [userId, requestId, 'auth_deleted', authority], [userId, requestId, 'completed', authority],
    ]);
    expect(deps.verifyResidue).toHaveBeenCalledWith(userId, email);
    expect(order.indexOf('auth')).toBeLessThan(order.indexOf('auth_deleted'));
    expect(order.indexOf('residue')).toBeLessThan(order.indexOf('completed'));
    expect(Object.keys(deps)).not.toContain('deleteAuthUser');
  });

  it.each(['auth_deleted', 'completed'])('resumes %s without replaying an earlier transition', async (phase) => {
    const { deps } = fixture(phase);
    expect((await recoverAccountClosure({ userId, requestId }, deps)).outcome).toBe('completed');
    expect(vi.mocked(deps.recordAuthState).mock.calls.map((args) => args[2])).toEqual(phase === 'completed' ? [] : ['completed']);
    expect(deps.readAuthUser).toHaveBeenCalled();
    expect(deps.verifyResidue).toHaveBeenCalled();
  });

  it.each(['processing', 'failed', 'issued', 'unexpected'])('does not recover or release a %s attempt', async (phase) => {
    const { deps } = fixture(phase);
    expect(await recoverAccountClosure({ userId, requestId }, deps)).toMatchObject({ outcome: 'hold', reason: 'journal_unavailable' });
    expect(deps.readAuthUser).not.toHaveBeenCalled();
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it.each([
    { userId: '', requestId }, { userId, requestId: otherId + ' ' },
    { userId: 'not-a-uuid', requestId }, { userId, requestId, extra: true },
  ])('refuses malformed request identity before port calls', async (request) => {
    const { deps } = fixture();
    expect((await recoverAccountClosure(request, deps)).reason).toBe('request_invalid');
    expect(deps.readAuthority).not.toHaveBeenCalled();
  });

  it.each([
    null, { data: { user: null }, error: null },
    { data: { user: null }, error: { status: 404, code: 'other_error' } },
    { data: { user: null }, error: { status: 403, code: 'user_not_found' } },
    { data: { user: { id: otherId } }, error: null },
    { data: { user: { id: userId } }, error: { status: 404, code: 'user_not_found' } },
  ])('ambiguous or contradictory Auth readback stays unknown', async (readback) => {
    const { deps } = fixture();
    vi.mocked(deps.readAuthUser).mockResolvedValue(readback);
    expect(await recoverAccountClosure({ userId, requestId }, deps)).toMatchObject({ outcome: 'hold', reason: 'auth_unknown', accountDeleted: null });
    expect(deps.recordAuthState).not.toHaveBeenCalled();
    expect(deps.verifyResidue).not.toHaveBeenCalled();
  });

  it('a matching present Auth user stays held and is never deleted', async () => {
    const { deps } = fixture();
    vi.mocked(deps.readAuthUser).mockResolvedValue({ data: { user: { id: userId } }, error: null });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('auth_present');
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it.each([null, {}, { data: null }, { data: { user: null }, error: null }])('clears earlier absence when the next Auth response is unknown: %j', async (response) => {
    const { deps } = fixture('completed');
    vi.mocked(deps.readAuthUser)
      .mockResolvedValueOnce({ data: { user: null }, error: { status: 404, code: 'user_not_found' } })
      .mockResolvedValue(response);
    expect(await recoverAccountClosure({ userId, requestId }, deps)).toMatchObject({
      outcome: 'hold', reason: 'auth_unknown', accountDeleted: null,
    });
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it('clears earlier absence when a subsequent Auth verification rejects', async () => {
    const { deps } = fixture('completed');
    vi.mocked(deps.readAuthUser)
      .mockResolvedValueOnce({ data: { user: null }, error: { status: 404, code: 'user_not_found' } })
      .mockRejectedValueOnce(new Error('read unavailable'));
    expect(await recoverAccountClosure({ userId, requestId }, deps)).toMatchObject({
      outcome: 'hold', reason: 'operation_unknown', accountDeleted: null,
    });
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it.each([
    { userId: otherId }, { requestId: otherId }, { email: 'CHANGED@example.test' },
    { email: '' },
  ])('wrong or malformed stored claim refuses progression', async (change) => {
    const { deps } = fixture();
    vi.mocked(deps.inspectAttempt).mockResolvedValue({ userId, requestId, email, phase: 'auth_unknown', ...change });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('journal_unavailable');
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it.each([
    { userId: otherId }, { requestId: otherId }, { generation: '07' },
    { generation: '9223372036854775808' }, { bindingDigest: '' }, { expiresAt: 1_000 },
    { validFrom: 1_001 }, { expiresAt: NaN }, { validFrom: 0, expiresAt: 900_001 },
  ])('requires fresh exact-request current drain authority', async (change) => {
    const { deps, authority } = fixture();
    vi.mocked(deps.readAuthority).mockResolvedValue({ ...authority, ...change });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('authority_unavailable');
    expect(deps.inspectAttempt).not.toHaveBeenCalled();
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it.each(['generation', 'bindingDigest'] as const)('a changed %s during an Auth read blocks the next write', async (key) => {
    const { deps, authority } = fixture();
    vi.mocked(deps.readAuthUser).mockImplementation(async () => {
      if (key === 'generation') authority.generation = '8'; else authority.bindingDigest = 'b'.repeat(64);
      return { data: { user: null }, error: { status: 404, code: 'user_not_found' } };
    });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('authority_changed');
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it('checks actual time after an asynchronous journal wait', async () => {
    const { deps, expire } = fixture();
    vi.mocked(deps.inspectAttempt).mockImplementation(async () => {
      expire(); return { userId, requestId, email, phase: 'auth_unknown' };
    });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('authority_unavailable');
    expect(deps.readAuthUser).not.toHaveBeenCalled();
  });

  it('a reused request or changed claimed email during recovery cannot authorize completion', async () => {
    const { deps } = fixture();
    vi.mocked(deps.inspectAttempt).mockResolvedValueOnce({ userId, requestId, email, phase: 'auth_unknown' })
      .mockResolvedValue({ userId, requestId, email: 'different@example.test', phase: 'auth_unknown' });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('journal_changed');
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it.each([false, null, 'true'])('residue result %s never authorizes completed', async (value) => {
    const { deps } = fixture('auth_deleted');
    vi.mocked(deps.verifyResidue).mockResolvedValue(value);
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('residue_unverified');
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it('lost transition response is held without automatic replay, and the next invocation reconciles its committed state', async () => {
    const { deps, setPhase } = fixture();
    vi.mocked(deps.recordAuthState).mockImplementationOnce(async () => { setPhase('auth_deleted'); throw new Error('lost secret@example.test response'); });
    const held = await recoverAccountClosure({ userId, requestId }, deps);
    expect(held).toMatchObject({ outcome: 'hold', reason: 'operation_unknown' });
    expect(JSON.stringify(held)).not.toContain('secret');
    expect(deps.recordAuthState).toHaveBeenCalledTimes(1);
    expect((await recoverAccountClosure({ userId, requestId }, deps)).outcome).toBe('completed');
    expect(vi.mocked(deps.recordAuthState).mock.calls.map((args) => args[2])).toEqual(['auth_deleted', 'completed']);
  });

  it('a successful transition acknowledgment without persisted readback cannot report completion', async () => {
    const { deps } = fixture('auth_deleted');
    vi.mocked(deps.recordAuthState).mockResolvedValue(undefined);
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('transition_unverified');
  });

  it('expiry during residue readback blocks the completion transition', async () => {
    const { deps, expire } = fixture('auth_deleted');
    vi.mocked(deps.verifyResidue).mockImplementation(async () => { expire(); return true; });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('authority_unavailable');
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });

  it('a pending recovery does not follow later mutation of the caller request', async () => {
    const { deps } = fixture();
    const request = { userId, requestId };
    vi.mocked(deps.readAuthUser).mockImplementation(async () => {
      request.userId = otherId;
      request.requestId = otherId;
      return { data: { user: null }, error: { status: 404, code: 'user_not_found' } };
    });
    expect((await recoverAccountClosure(request, deps)).outcome).toBe('completed');
    expect(vi.mocked(deps.recordAuthState).mock.calls.every(([user, id]) => user === userId && id === requestId)).toBe(true);
  });

  it('the SQL port receives the frozen exact authority, rather than authority that can be renewed in flight', async () => {
    const { deps, authority } = fixture();
    vi.mocked(deps.recordAuthState).mockImplementation(async (_user, _request, state, grant) => {
      expect(Object.isFrozen(grant)).toBe(true);
      expect(grant).toEqual(authority);
      authority.generation = '8';
      throw new Error('database rejected old generation under its locks');
    });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).reason).toBe('operation_unknown');
    expect(deps.recordAuthState).toHaveBeenCalledTimes(1);
  });

  it.each(['readAuthority', 'inspectAttempt', 'readAuthUser', 'verifyResidue', 'recordAuthState'] as const)('%s failure is sanitized and cannot report success', async (port) => {
    const { deps } = fixture();
    vi.mocked(deps[port]).mockRejectedValue(new Error('provider secret retained@example.test'));
    const result = await recoverAccountClosure({ userId, requestId }, deps);
    expect(result.outcome).toBe('hold');
    expect(JSON.stringify(result)).not.toMatch(/provider|secret|example\.test/);
  });

  it('completed journal alone is insufficient when Auth or residue reappears', async () => {
    const { deps } = fixture('completed');
    vi.mocked(deps.verifyResidue).mockResolvedValue(false);
    expect((await recoverAccountClosure({ userId, requestId }, deps)).outcome).toBe('hold');
    expect(deps.recordAuthState).not.toHaveBeenCalled();
  });
});
