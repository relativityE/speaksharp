import { describe, expect, it, vi } from 'vitest';
import { recoverAccountClosureAsOperator } from '../../backend/supabase/functions/_shared/accountClosureOperatorRecovery';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 } from '../../backend/supabase/functions/_shared/accountClosureRuntimeBinding';

const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000002';
const functionId = '30000000-0000-4000-8000-000000000003';
function fixture() {
  const scope = { attestationId: functionId, generation: '0', bindingDigest: 'a'.repeat(64),
    context: { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64), migrationDigest: ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256,
      projectId: 'fixture-project', environment: 'production' } };
  const env: Record<string, string> = { SUPABASE_URL: 'https://fixture-project.supabase.co', SUPABASE_ACCESS_TOKEN: 'synthetic-private-token',
    ACCOUNT_CLOSURE_RUNTIME_BINDING: JSON.stringify({ version: 1, deploymentId: `fixture-project_${functionId}_1`, scope }) };
  const state = { phase: 'auth_unknown' };
  const validFrom = Date.now() - 1000; const expiresAt = validFrom + 600_000;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'record_account_closure_auth_state_with_drain') state.phase = String(args.p_state);
    return { data: name === 'inspect_account_closure_authority' ? {
      attempt: { userId, requestId, email: 'user@example.test', phase: state.phase },
      authority: { userId, requestId, generation: scope.generation, bindingDigest: scope.bindingDigest, validFrom, expiresAt },
    } : name === 'verify_account_closure_residue_with_drain' ? true : null, error: null };
  });
  const metadata = { id: functionId, slug: 'account-closure', status: 'ACTIVE', version: 1 };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(metadata)));
  const deleteUser = vi.fn();
  const factory = vi.fn(() => ({ rpc, auth: { admin: {
    getUserById: async () => ({ data: { user: null }, error: { status: 404, code: 'user_not_found' } }), deleteUser,
  } } }));
  const ports = { env: (key: string) => env[key], fetch: fetcher, createAdminClient: factory };
  return { ports, env, state, rpc, metadata, fetcher, factory, deleteUser };
}
describe('private operator invocation — verified platform metadata, never fake worker identity', () => {
  it('reconciles one exact request with one client and two fixed read-only platform checks', async () => {
    const { ports, rpc, fetcher, factory, deleteUser } = fixture();
    expect((await recoverAccountClosureAsOperator({ userId, requestId }, ports)).outcome).toBe('completed');
    expect(factory).toHaveBeenCalledExactlyOnceWith('https://fixture-project.supabase.co');
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://api.supabase.com/v1/projects/fixture-project/functions/account-closure');
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
      expect(init?.signal).toBeDefined();
    }
    expect(rpc.mock.calls.filter(([name]) => name === 'record_account_closure_auth_state_with_drain')
      .map(([, args]) => args.p_state)).toEqual(['auth_deleted', 'completed']);
    expect(rpc.mock.calls.every(([name]) => !/claim|bind_account|invalidate|finish/.test(name))).toBe(true);
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it.each(['id', 'slug', 'status', 'version'] as const)('wrong platform %s prevents client construction and every SQL operation', async (field) => {
    const { ports, metadata, factory } = fixture();
    Object.assign(metadata, { [field]: field === 'version' ? 2 : 'incorrect' });
    expect((await recoverAccountClosureAsOperator({ userId, requestId }, ports)).outcome).toBe('hold');
    expect(factory).not.toHaveBeenCalled();
  });
  it.each([403, 429, 500])('platform HTTP %s refuses without leaking its response or token', async (status) => {
    const { ports, fetcher, factory } = fixture();
    fetcher.mockResolvedValue(new Response('private-error@example.test synthetic-private-token', { status }));
    const result = await recoverAccountClosureAsOperator({ userId, requestId }, ports);
    expect(result.outcome).toBe('hold');
    expect(JSON.stringify(result)).not.toMatch(/private|token|example/);
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects oversized unannounced bodies before constructing a database client', async () => {
    const { ports, fetcher, factory } = fixture();
    fetcher.mockResolvedValue(new Response('x'.repeat(32_769)));
    expect((await recoverAccountClosureAsOperator({ userId, requestId }, ports)).outcome).toBe('hold');
    expect(factory).not.toHaveBeenCalled();
  });
  it('post-operation deployment drift holds a committed result without replaying writes', async () => {
    const { ports, fetcher, metadata, state, rpc } = fixture();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(metadata)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...metadata, version: 2 })));
    expect((await recoverAccountClosureAsOperator({ userId, requestId }, ports)).outcome).toBe('hold');
    expect(state.phase).toBe('completed');
    expect(rpc.mock.calls.filter(([name]) => name === 'record_account_closure_auth_state_with_drain')).toHaveLength(2);
  });
  it('invalid identity consumes no API request and no database client', async () => {
    const { ports, fetcher, factory } = fixture();
    expect((await recoverAccountClosureAsOperator({ userId: 'invalid', requestId }, ports)).outcome).toBe('hold');
    expect(fetcher).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled();
  });
});
