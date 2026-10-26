import { describe, expect, it, vi } from 'vitest';
import { recoverAccountClosure } from '../../backend/supabase/functions/_shared/accountClosureRecovery';
import { createAccountClosureRecoveryAdapter, type ClosureRecoveryClient, type ClosureRecoveryTarget } from '../../backend/supabase/functions/_shared/accountClosureRecoveryAdapter';

const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000002';
const other = '30000000-0000-4000-8000-000000000003';
const target: ClosureRecoveryTarget = { projectId: 'fixture-project', environment: 'production', url: 'https://fixture-project.supabase.co' };
function fixture() {
  const scope = { attestationId: other, generation: '0', bindingDigest: 'a'.repeat(64),
    context: { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64), migrationDigest: 'd'.repeat(64),
      projectId: target.projectId, environment: target.environment } };
  const proof = { authority: { userId, requestId, generation: '0', bindingDigest: scope.bindingDigest, validFrom: 500, expiresAt: 2_000 },
    attempt: { userId, requestId, email: 'user@example.test', phase: 'auth_unknown' } };
  const deleteUser = vi.fn();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
    if (name === 'inspect_account_closure_authority') return { data: structuredClone(proof), error: null };
    if (name === 'verify_account_closure_residue_with_drain') return { data: true, error: null };
    if (name === 'record_account_closure_auth_state_with_drain') {
      proof.attempt.phase = String(args.p_state); return { data: null, error: null };
    }
    throw new Error('unexpected RPC');
  });
  const getUserById = vi.fn(async (): Promise<unknown> => ({ data: { user: null }, error: { status: 404, code: 'user_not_found' } }));
  const client = { rpc, auth: { admin: { getUserById, deleteUser } } };
  const ports = { createAdminClient: vi.fn((): ClosureRecoveryClient => client),
    getCurrentScope: vi.fn(async (): Promise<unknown> => structuredClone(scope)), now: () => 1_000 };
  const adapter = createAccountClosureRecoveryAdapter(target, ports);
  const deps = adapter.forRequest({ userId, requestId });
  return { scope, proof, rpc, getUserById, deleteUser, ports, adapter, deps };
}

describe('trusted recovery adapter → current-drain SQL RPCs', () => {
  it('uses one exact-target client, guarded RPCs, server-stored email and no destructive call', async () => {
    const { deps, ports, rpc, deleteUser } = fixture();
    expect((await recoverAccountClosure({ userId, requestId }, deps)).outcome).toBe('completed');
    expect(ports.createAdminClient).toHaveBeenCalledExactlyOnceWith('https://fixture-project.supabase.co');
    const writes = rpc.mock.calls.filter(([name]) => name === 'record_account_closure_auth_state_with_drain');
    expect(writes.map(([, args]) => args.p_state)).toEqual(['auth_deleted', 'completed']);
    for (const [, args] of rpc.mock.calls) expect(args).toMatchObject({
      p_user_id: userId, p_request_id: requestId, p_attestation_id: other, p_generation: '0', p_binding_digest: 'a'.repeat(64),
      p_context: { projectId: target.projectId, environment: 'production' },
    });
    expect(rpc.mock.calls.every(([name]) => !['claim_account_closure_token', 'record_account_closure_auth_state',
      'settle_account_closure_billing', 'bind_account_closure_recovery_authority'].includes(name))).toBe(true);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it.each([
    'https://other.supabase.co', 'http://fixture-project.supabase.co', 'https://fixture-project.supabase.co/other',
    'https://fixture-project.supabase.co?token=secret', 'https://user:secret@fixture-project.supabase.co',
    'http://127.0.0.1:54321', 'https://untrusted.example.test',
  ])('rejects a mismatched or unsafe production target before client construction: %s', (url) => {
    const ports = fixture().ports; ports.createAdminClient.mockClear();
    expect(() => createAccountClosureRecoveryAdapter({ ...target, url }, ports)).toThrow('closure_recovery_unavailable');
    expect(ports.createAdminClient).not.toHaveBeenCalled();
  });

  it('permits explicit disposable loopback, never as a production-target shortcut', () => {
    const { ports } = fixture(); ports.createAdminClient.mockClear();
    createAccountClosureRecoveryAdapter({ ...target, environment: 'disposable', url: 'http://127.0.0.1:54321' }, ports);
    expect(ports.createAdminClient).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:54321');
  });

  it('cannot change recipient or share an adapter between requests', async () => {
    const { adapter, deps, getUserById, rpc } = fixture();
    expect(() => adapter.forRequest({ userId: other, requestId })).toThrow();
    await expect(deps.readAuthority(other, requestId)).rejects.toThrow();
    await expect(deps.inspectAttempt(userId, other)).rejects.toThrow();
    await expect(deps.readAuthUser(other)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it.each(['candidateSha', 'configDigest', 'migrationDigest', 'projectId', 'environment'] as const)('a changed %s during the RPC invalidates its response', async (field) => {
    const { deps, rpc, proof, scope } = fixture();
    rpc.mockImplementationOnce(async () => {
      scope.context[field] = field === 'environment' ? 'disposable' : 'changed';
      return { data: structuredClone(proof), error: null };
    });
    expect((await recoverAccountClosure({ userId, requestId }, deps)).outcome).toBe('hold');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not silently renew the selected attestation between separate port operations', async () => {
    const { deps, scope, rpc } = fixture();
    await deps.readAuthority(userId, requestId);
    scope.attestationId = userId;
    await expect(deps.inspectAttempt(userId, requestId)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('preserves canonical bigint generation beyond JavaScript integer precision', async () => {
    const { deps, scope, proof, rpc } = fixture();
    scope.generation = proof.authority.generation = '9007199254740993';
    expect(await deps.readAuthority(userId, requestId)).toMatchObject({ generation: '9007199254740993' });
    expect(rpc.mock.calls[0][1].p_generation).toBe('9007199254740993');
  });

  it.each([
    { data: null, error: null }, { data: true, error: null },
    { data: null, error: { message: 'private provider secret' } },
  ])('unreadable or rejected storage response remains a sanitized hold', async (response) => {
    const { deps, rpc } = fixture(); rpc.mockResolvedValue(response);
    const result = await recoverAccountClosure({ userId, requestId }, deps);
    expect(result.outcome).toBe('hold');
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['userId', 'requestId'] as const)('wrong %s in authoritative SQL response is refused', async (field) => {
    const { deps, proof } = fixture(); proof.attempt[field] = other;
    expect((await recoverAccountClosure({ userId, requestId }, deps)).outcome).toBe('hold');
  });

  it('forged transition authority cannot reach a mutation RPC', async () => {
    const { deps, proof, rpc } = fixture();
    await expect(deps.recordAuthState(userId, requestId, 'auth_deleted', { ...proof.authority, expiresAt: 99_999 })).rejects.toThrow();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['inspect_account_closure_authority']);
  });

  it('wrong private email cannot authorize residue for another binding', async () => {
    const { deps, rpc } = fixture();
    await expect(deps.verifyResidue(userId, 'other@example.test')).rejects.toThrow();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['inspect_account_closure_authority']);
  });

  it('lost committed transition response stays held; a later invocation reads its actual state without replay', async () => {
    const { deps, rpc, proof } = fixture();
    const original = rpc.getMockImplementation()!;
    let lost = false;
    rpc.mockImplementation(async (name, args) => {
      const response = await original(name, args);
      if (!lost && name === 'record_account_closure_auth_state_with_drain') { lost = true; throw new Error('lost response'); }
      return response;
    });
    expect(await recoverAccountClosure({ userId, requestId }, deps)).toMatchObject({ outcome: 'hold', reason: 'operation_unknown' });
    expect(proof.attempt.phase).toBe('auth_deleted');
    expect((await recoverAccountClosure({ userId, requestId }, deps)).outcome).toBe('completed');
    expect(rpc.mock.calls.filter(([name]) => name === 'record_account_closure_auth_state_with_drain')
      .map(([, args]) => args.p_state)).toEqual(['auth_deleted', 'completed']);
  });

  it('a fresh unknown Auth response clears earlier confirmed deletion through the real adapter', async () => {
    const { deps, proof, getUserById } = fixture(); proof.attempt.phase = 'completed';
    getUserById.mockResolvedValueOnce({ data: { user: null }, error: { status: 404, code: 'user_not_found' } })
      .mockResolvedValueOnce({ data: null });
    expect(await recoverAccountClosure({ userId, requestId }, deps)).toMatchObject({ outcome: 'hold', accountDeleted: null });
  });
});
