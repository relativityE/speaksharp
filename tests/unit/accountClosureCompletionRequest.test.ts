// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { handleAccountCompletionRequest } from '../../backend/supabase/functions/_shared/accountClosureCompletionRequest';
import { createAccountCompletionStatus } from '../../backend/supabase/functions/_shared/accountClosureCompletionStatus';

const requestId = '22222222-2222-4222-8222-222222222222', token = 'f'.repeat(64);
const held = { outcome: 'unavailable' as const, canRetry: false as const };
type Status = ReturnType<typeof createAccountCompletionStatus>;
function fixture() {
  return {
    issue: vi.fn<Status['issue']>(async () => ({ outcome: 'status_capability', requestId, token, expiresAt: 2000 })),
    acknowledge: vi.fn<Status['acknowledge']>(async () => ({ outcome: 'status_acknowledged', requestId })),
    read: vi.fn<Status['read']>(async () => ({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false })),
  };
}
function req(body: unknown, authorization: string | null = 'Bearer synthetic') {
  return new Request('https://app.example.test/unselected', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) });
}
const allUnused = (f: ReturnType<typeof fixture>) => { expect(f.issue).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled(); };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('inactive completion status HTTP contract', () => {
  it('issues through the accepted wrapper with the original live request and closed input', async () => {
    const f = fixture(), request = req({ action: 'completion_status_issue', requestId });
    const response = await handleAccountCompletionRequest(request, f);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ outcome: 'status_capability', requestId, token, expiresAt: 2000 });
    expect(f.issue).toHaveBeenCalledExactlyOnceWith(request, { requestId });
    expect(f.acknowledge).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });
  it('ACK is a distinct owner-authenticated action, never a completion dispatch', async () => {
    const f = fixture(), request = req({ action: 'completion_status_ack', requestId, token });
    const response = await handleAccountCompletionRequest(request, f);
    expect(await response.json()).toEqual({ outcome: 'status_acknowledged', requestId });
    expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith(request, { requestId, token });
    expect(f.issue).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });
  it.each([null, 'Bearer stale-deleted-owner'])('capability read works without live owner credentials: %s', async authorization => {
    const f = fixture(); const response = await handleAccountCompletionRequest(req({ action: 'completion_status_read', requestId, token }, authorization), f);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false });
    expect(f.read).toHaveBeenCalledExactlyOnceWith({ requestId, token });
    expect(f.issue).not.toHaveBeenCalled(); expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it.each(['completion_status_issue', 'completion_status_ack'])('live action %s refuses missing/invalid Bearer before the wrapper', async action => {
    for (const authorization of [null, 'Basic synthetic', 'Bearer ', 'Bearer first second']) {
      const f = fixture(), body = action.endsWith('issue') ? { action, requestId } : { action, requestId, token };
      const response = await handleAccountCompletionRequest(req(body, authorization), f);
      expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'sign_in_required' }); allUnused(f);
    }
  });
  it.each([null, [], 1, {}, { action: 'complete', requestId, token }, { action: 'confirm', requestId, token },
    { action: 'completion_status_read', requestId }, { action: 'completion_status_read', requestId, token: 'bad' },
    { action: 'completion_status_issue', requestId, token }, { action: 'completion_status_issue', requestId, userId: requestId },
    { action: 'completion_status_ack', requestId, token, scopeDigest: 'a'.repeat(64) },
    { action: 'completion_status_read', requestId: 'wrong', token }])('rejects malformed/additional/destructive authority %j', async body => {
    const f = fixture(), response = await handleAccountCompletionRequest(req(body), f);
    expect(response.status).toBe(400); expect(response.headers.get('cache-control')).toBe('no-store'); allUnused(f);
  });
  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])('requires POST, including method %s', async method => {
    const f = fixture(), response = await handleAccountCompletionRequest(new Request('https://app.example.test/unselected', { method }), f);
    expect(response.status).toBe(405); expect(response.headers.get('cache-control')).toBe('no-store'); allUnused(f);
  });
  it('refuses capability material in the URL without reflecting it', async () => {
    const f = fixture(), response = await handleAccountCompletionRequest(new Request(`https://app.example.test/unselected?token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'completion_status_read', requestId, token }),
    }), f);
    expect(response.status).toBe(400); expect(await response.text()).not.toContain(token); allUnused(f);
  });
  it.each(['4097', '999999999999999999999', '-1', 'NaN'])('refuses invalid/oversize declared length %s before RPC', async length => {
    const f = fixture(), request = req({ action: 'completion_status_read', requestId, token }); request.headers.set('content-length', length);
    const response = await handleAccountCompletionRequest(request, f); expect([400, 413]).toContain(response.status); allUnused(f);
  });
  it('measures actual streaming bytes even when the declared length lies', async () => {
    const f = fixture(), request = req('x'.repeat(4100)); request.headers.set('content-length', '1');
    const response = await handleAccountCompletionRequest(request, f); expect(response.status).toBe(413); allUnused(f);
  });
  it('bounds a stalled request and does not wait on a hung cancel callback', async () => {
    vi.useFakeTimers(); const f = fixture(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const request = new Request('https://app.example.test/unselected', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: stream, duplex: 'half' } as RequestInit);
    const pending = handleAccountCompletionRequest(request, f); await vi.advanceTimersByTimeAsync(10_001);
    const response = await pending; expect(response.status).toBe(408); expect(cancel).toHaveBeenCalledTimes(1); allUnused(f);
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded'])('requires JSON content type %s', async type => {
    const f = fixture(), request = req({ action: 'completion_status_read', requestId, token }); request.headers.set('content-type', type);
    const response = await handleAccountCompletionRequest(request, f); expect(response.status).toBe(415); allUnused(f);
  });
  it('malformed UTF8 never reaches the wrapper', async () => {
    const f = fixture(), response = await handleAccountCompletionRequest(new Request('https://app.example.test/unselected', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xff]) }), f);
    expect(response.status).toBe(400); allUnused(f);
  });
  it('sanitizes thrown failures without retry or capability reflection', async () => {
    const f = fixture(); f.read.mockRejectedValue(new Error(`private ${token}`));
    const response = await handleAccountCompletionRequest(req({ action: 'completion_status_read', requestId, token }, null), f);
    expect(response.status).toBe(503); expect(await response.json()).toEqual(held); expect(f.read).toHaveBeenCalledTimes(1);
  });
  it('a valid unavailable response stays unavailable, never deleted or retryable', async () => {
    const f = fixture(); f.read.mockResolvedValue(held);
    const response = await handleAccountCompletionRequest(req({ action: 'completion_status_read', requestId, token }, null), f);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(held);
  });
  it('composes cap-only HTTP with the real accepted wrapper without any Auth or effect call', async () => {
    const authenticate = vi.fn(), rpc = vi.fn(async () => ({ data: { outcome: 'completed', requestId, accountDeleted: true, canRetry: false, expiresAt: 2000 }, error: null }));
    const binding = { projectId: 'http-fixture', environment: 'disposable' as const, url: 'http://127.0.0.1:54321', scopeDigest: 'a'.repeat(64) };
    const status = createAccountCompletionStatus(binding, { createAdminClient: () => ({ rpc }), currentBinding: async () => binding, authenticate, now: () => 1000 });
    const response = await handleAccountCompletionRequest(req({ action: 'completion_status_read', requestId, token }, null), status);
    expect(await response.json()).toEqual({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false });
    expect(authenticate).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toHaveLength(2);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
  });
});
