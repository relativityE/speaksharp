// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { handleClosureRequest, type ClosureRequestDependencies } from '../../backend/supabase/functions/_shared/accountClosureRequest';
import type { ClosureDependencies } from '../../backend/supabase/functions/_shared/accountClosure';

const secret = 'a'.repeat(64);
const hash = 'b'.repeat(64);
function fixture() {
  const adapters: ClosureDependencies = {
    now: () => 1000,
    consumeProof: vi.fn(async () => ({ userId: 'owner', email: 'verified@example.test', customerId: null, requestId: 'request', expiresAt: 2000 })),
    verifyCheckouts: vi.fn(async () => true),
    listSubscriptions: vi.fn(), cancelSubscription: vi.fn(), settleBilling: vi.fn(), deleteCustomer: vi.fn(),
    preserveTrialEmail: vi.fn(async () => {}), removeOwnedStorage: vi.fn(async () => {}),
    deleteAuthUser: vi.fn(async () => ({ deleted: true })), verifyResidue: vi.fn(async () => ({ clean: true })),
  };
  const deps: ClosureRequestDependencies = {
    authenticate: vi.fn(async () => ({ id: 'owner', email: 'verified@example.test' })),
    siteUrl: 'https://example.test', randomToken: () => secret, hashToken: vi.fn(async () => hash),
    issue: vi.fn(async () => true), revoke: vi.fn(async () => {}), sendLink: vi.fn(async () => {}),
    closure: () => adapters, finish: vi.fn(async () => {}),
  };
  const request = (body: unknown, method = 'POST') => new Request('https://example.test/function', {
    method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
  return { deps, adapters, request };
}

describe('account-closure authenticated request/confirmation contract', () => {
  it('unknown auth deletion never releases the processing hold or implies non-deletion', async () => {
    const { deps, request, adapters } = fixture();
    vi.mocked(adapters.deleteAuthUser).mockRejectedValue(new Error('lost remote response'));
    const response = await handleClosureRequest(request({ action: 'confirm', token: secret, confirmIrreversible: true }), deps);
    expect(await response.json()).toMatchObject({ outcome: 'verification_pending', accountDeleted: null });
    expect(deps.finish).not.toHaveBeenCalled();
  });
  it('issues only a hash, mails only the authenticated email, and never returns the secret', async () => {
    const { deps, request } = fixture();
    const response = await handleClosureRequest(request({ action: 'request', email: 'attacker@example.test', userId: 'other', redirect: 'https://evil.test' }), deps);
    expect(response.status).toBe(200);
    expect(deps.issue).toHaveBeenCalledWith('owner', hash);
    expect(deps.sendLink).toHaveBeenCalledWith('verified@example.test', `https://example.test/account/delete?account_deletion_token=${secret}`);
    expect(await response.text()).not.toContain(secret);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('failed email delivery revokes exactly the issued token and reports no success', async () => {
    const { deps, request } = fixture();
    vi.mocked(deps.sendLink).mockRejectedValue(new Error('provider secret'));
    const response = await handleClosureRequest(request({ action: 'request' }), deps);
    expect(response.status).toBe(503);
    expect(deps.revoke).toHaveBeenCalledWith('owner', hash);
    expect(await response.text()).not.toContain('provider secret');
  });
  it('rate-limit/busy denial never sends another link', async () => {
    const { deps, request } = fixture();
    vi.mocked(deps.issue).mockResolvedValue(false);
    expect((await handleClosureRequest(request({ action: 'request' }), deps)).status).toBe(429);
    expect(deps.sendLink).not.toHaveBeenCalled();
  });
  it.each(['http://example.test', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?next=evil'])('rejects unsafe configured redirect %s', async (siteUrl) => {
    const { deps, request } = fixture();
    deps.siteUrl = siteUrl;
    expect((await handleClosureRequest(request({ action: 'request' }), deps)).status).toBe(503);
    expect(deps.issue).not.toHaveBeenCalled();
    expect(deps.sendLink).not.toHaveBeenCalled();
  });
  it('a loopback http app origin is accepted only when this function runs on a verified local disposable stack', async () => {
    for (const [local, siteUrl, ok] of [[true, 'http://localhost:5173', true], [true, 'http://127.0.0.1:5173', true],
      [undefined, 'http://localhost:5173', false], [false, 'http://localhost:5173', false], [true, 'http://example.test', false],
      [true, 'http://localhost.example.test', false], [true, 'http://localhost:5173/path', false], [true, 'https://example.test', true]] as const) {
      const { deps, request } = fixture();
      deps.siteUrl = siteUrl; deps.localDisposableStack = local;
      const status = (await handleClosureRequest(request({ action: 'request' }), deps)).status;
      const redirect = vi.mocked(deps.sendLink).mock.calls[0]?.[1] ?? null;
      expect({ local, siteUrl, refused: status === 503, redirectedToSite: typeof redirect === 'string' && redirect.startsWith(`${siteUrl}/account/delete?account_deletion_token=`) })
        .toEqual({ local, siteUrl, refused: !ok, redirectedToSite: ok });
    }
  });
  it('anonymous requests have no mail or deletion side effects', async () => {
    const { deps, request, adapters } = fixture();
    vi.mocked(deps.authenticate).mockResolvedValue(null);
    expect((await handleClosureRequest(request({ action: 'request' }), deps)).status).toBe(401);
    expect(deps.issue).not.toHaveBeenCalled();
    expect(adapters.consumeProof).not.toHaveBeenCalled();
  });
  it('opening a GET link never consumes a proof or deletes anything', async () => {
    const { deps, request, adapters } = fixture();
    expect((await handleClosureRequest(request(null, 'GET'), deps)).status).toBe(405);
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(adapters.consumeProof).not.toHaveBeenCalled();
  });
  it('an oversized undeclared body is refused before issuing tokens or deleting', async () => {
    const { deps, request, adapters } = fixture();
    expect((await handleClosureRequest(request({ action: 'request', padding: 'x'.repeat(5000) }), deps)).status).toBe(413);
    expect(deps.issue).not.toHaveBeenCalled();
    expect(adapters.consumeProof).not.toHaveBeenCalled();
  });
  it('malformed JSON is a bounded validation error', async () => {
    const { deps } = fixture();
    expect((await handleClosureRequest(new Request('https://example.test', { method: 'POST', body: '{' }), deps)).status).toBe(400);
    expect(deps.issue).not.toHaveBeenCalled();
  });
  // One distinct name per case: execution evidence refuses a collection with duplicate test names.
  it.each([['no action', {}], ['no irreversible confirmation', { action: 'confirm', token: secret }],
    ['a malformed token', { action: 'confirm', token: 'bad', confirmIrreversible: true }]] as const)('requires explicit confirmation and a valid token (%s)', async (_case, body) => {
    const { deps, request, adapters } = fixture();
    expect((await handleClosureRequest(request(body), deps)).status).toBe(400);
    expect(adapters.consumeProof).not.toHaveBeenCalled();
  });
  it('confirmation binds to authenticated identity, never caller-supplied user ID', async () => {
    const { deps, request, adapters } = fixture();
    const response = await handleClosureRequest(request({ action: 'confirm', token: secret, confirmIrreversible: true, userId: 'other' }), deps);
    expect(response.status).toBe(200);
    expect(adapters.consumeProof).toHaveBeenCalledWith('owner', secret);
    expect(adapters.deleteAuthUser).toHaveBeenCalledWith('owner');
  });
  it('an incomplete attempt preserves truthful flags and releases only its own processing hold', async () => {
    const { deps, request, adapters } = fixture();
    vi.mocked(adapters.deleteAuthUser).mockResolvedValue({ deleted: false });
    const response = await handleClosureRequest(request({ action: 'confirm', token: secret, confirmIrreversible: true }), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ outcome: 'incomplete', accountDeleted: false });
    expect(deps.finish).toHaveBeenCalledWith('owner', 'request');
  });
  it.each([undefined, {}, { requestId: 'bad', phase: 'pending', destructiveEnabled: false, checkoutPending: 1 },
    { requestId: '20000000-0000-4000-8000-000000000002', phase: 'pending', destructiveEnabled: true, checkoutPending: 0 },
    { requestId: '20000000-0000-4000-8000-000000000002', phase: 'pending', destructiveEnabled: false, checkoutPending: -1 },
    { requestId: '20000000-0000-4000-8000-000000000002', phase: 'pending', destructiveEnabled: false, checkoutPending: 0, token: 'private' },
  ])('unverified pending readback %j cannot imply deletion or fall through to destructive execution', async status => {
    const { deps, request, adapters } = fixture();
    deps.pending = { confirm: async () => status, status: async () => status };
    const response = await handleClosureRequest(request({ action: 'confirm', token: secret, confirmIrreversible: true }), deps);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private');
    expect(adapters.consumeProof).not.toHaveBeenCalled(); expect(deps.finish).not.toHaveBeenCalled();
  });
  it('status is authenticated and never dispatches confirmation or accepts caller identity', async () => {
    const { deps, request, adapters } = fixture();
    deps.pending = { confirm: vi.fn(), status: vi.fn(async () => null) };
    const response = await handleClosureRequest(request({ action: 'status', userId: 'other' }), deps);
    expect(await response.json()).toEqual({ outcome: 'not_pending', destructiveEnabled: false });
    expect(deps.pending.status).toHaveBeenCalledWith(); expect(deps.pending.confirm).not.toHaveBeenCalled();
    expect(adapters.consumeProof).not.toHaveBeenCalled();
    vi.mocked(deps.authenticate).mockResolvedValue(null);
    expect((await handleClosureRequest(request({ action: 'status' }), deps)).status).toBe(401);
    expect(deps.pending.status).toHaveBeenCalledTimes(1);
  });
});
