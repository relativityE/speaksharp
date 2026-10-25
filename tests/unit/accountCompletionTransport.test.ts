// @vitest-environment jsdom
/**
 * #1643 — network-boundary controls for the Auth-independent completion transport (Sam 1792549550 / 1792549859): the
 * actual outgoing request, no Supabase session access, and in-flight expiry/clear handled after every await.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPLETION_STATUS_PATH, completionStatusTarget, createCompletionTransport } from '@/services/accountCompletionTransport';
import { readCompletionStatus, secureStatusCapability } from '@/services/accountCompletionClient';
import { completionCapabilities } from '@/services/accountCompletionStatus';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), getUser: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ auth, functions: { invoke: vi.fn() } }) }));

const ORIGIN = 'https://abcdefghijklmnop.supabase.co';
const TARGET = `${ORIGIN}${COMPLETION_STATUS_PATH}`;
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'c'.repeat(64);
const NOW = 1_792_550_000_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve!: (r: Response) => void; const promise = new Promise<Response>((r) => { resolve = r; }); return { promise, resolve }; };

afterEach(() => { completionCapabilities.clear(); vi.clearAllMocks(); });

describe('#1643 completion transport — target', () => {
  it('builds exactly one HTTPS target from the project origin', () => {
    expect(completionStatusTarget(ORIGIN)).toBe(TARGET);
    expect(completionStatusTarget(`${ORIGIN}/`)).toBe(TARGET);
  });

  it.each([['http://abcdefghijklmnop.supabase.co'], [`${ORIGIN}/rest/v1`], [`${ORIGIN}?x=1`], ['https://u:p@x.supabase.co'], [''], [undefined]])(
    'FENCE: %s is not a valid target (no transport)', (url) => {
      expect(completionStatusTarget(url)).toBeNull();
      expect(createCompletionTransport(url, vi.fn())).toBeNull();
    });
});

describe('#1643 completion transport — the outgoing request', () => {
  it('read: POST of the closed body with no Authorization, credentials omitted, redirects refused, no cache', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ outcome: 'processing', requestId, canRetry: false }));
    const transport = createCompletionTransport(ORIGIN, fetchImpl)!;
    await transport({ action: 'completion_status_read', requestId, token }, null);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TARGET);
    expect(String(url)).not.toContain(token);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'completion_status_read', requestId, token });
  });

  it('issue/ACK carry exactly the given owner JWT', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ outcome: 'unavailable', canRetry: false }));
    await createCompletionTransport(ORIGIN, fetchImpl)!({ action: 'completion_status_issue', requestId }, 'owner.jwt.value');
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer owner.jwt.value' });
  });

  it('FENCE: a malformed bearer sends nothing; an oversized or non-JSON reply throws', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const transport = createCompletionTransport(ORIGIN, fetchImpl)!;
    await expect(transport({ action: 'completion_status_issue', requestId }, 'two words')).rejects.toThrow('invalid_bearer');
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockResolvedValueOnce(new Response('x'.repeat(8193)));
    await expect(transport({ action: 'completion_status_read', requestId, token }, null)).rejects.toThrow('reply_too_large');
    fetchImpl.mockResolvedValueOnce(new Response('<html>'));
    await expect(transport({ action: 'completion_status_read', requestId, token }, null)).rejects.toThrow();
  });

  it('a full secure-then-read cycle never touches the Supabase session (also after Auth loss)', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ outcome: 'status_capability', requestId, token, expiresAt: NOW + 900_000 }))
      .mockResolvedValueOnce(json({ outcome: 'status_acknowledged', requestId }))
      .mockResolvedValueOnce(json({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false }));
    const transport = createCompletionTransport(ORIGIN, fetchImpl)!;
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW)).toBe(true);
    expect((await readCompletionStatus(transport, 'owner-a', requestId, () => NOW)).outcome).toBe('completed');
    expect(fetchImpl.mock.calls[2][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(token);
  });
});

describe('#1643 in-flight replies are re-checked after the await (expiry / clear / replacement)', () => {
  const secured = (expiresAt = NOW + 10) => {
    completionCapabilities.hold('owner-a', { requestId, token, expiresAt });
    completionCapabilities.acknowledge('owner-a', requestId, token, NOW);
  };

  it('CASUALTY: a read reply that lands after clear() (owner switch) is dropped', async () => {
    secured();
    const pending = deferred();
    const transport = createCompletionTransport(ORIGIN, vi.fn<typeof fetch>().mockReturnValue(pending.promise))!;
    const read = readCompletionStatus(transport, 'owner-a', requestId, () => NOW);
    completionCapabilities.clear();
    pending.resolve(json({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false }));
    expect(await read).toEqual({ outcome: 'unavailable', canRetry: false });
  });

  it('CASUALTY: a read reply that lands after the capability deadline is dropped', async () => {
    secured(NOW + 10);
    let clock = NOW;
    const pending = deferred();
    const transport = createCompletionTransport(ORIGIN, vi.fn<typeof fetch>().mockReturnValue(pending.promise))!;
    const read = readCompletionStatus(transport, 'owner-a', requestId, () => clock);
    clock = NOW + 10;
    pending.resolve(json({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false }));
    expect((await read).outcome).toBe('unavailable');
  });

  it('CASUALTY: an issue reply that lands after clear() (owner switch) does not re-create a holding', async () => {
    const pending = deferred();
    const transport = createCompletionTransport(ORIGIN, vi.fn<typeof fetch>().mockReturnValue(pending.promise))!;
    const secure = secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW);
    completionCapabilities.clear();
    pending.resolve(json({ outcome: 'status_capability', requestId, token, expiresAt: NOW + 900_000 }));
    expect(await secure).toBe(false);
    expect(completionCapabilities.get('owner-a', requestId, NOW)).toBeNull();
  });

  it('CONTROL: Auth loss alone does not clear the capability — a later read still works without any session', async () => {
    secured();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ outcome: 'processing', requestId, canRetry: false }));
    expect((await readCompletionStatus(createCompletionTransport(ORIGIN, fetchImpl)!, 'owner-a', requestId, () => NOW)).outcome).toBe('processing');
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});

// Sam RETURN 1792550424 — issuance must be single-flight. A fake server that behaves like CLI's SQL: each issue mints a
// new key and replaces the previous one only while it is unacknowledged; an ACK succeeds only for the current key.
function fakeServer() {
  let current: string | null = null;
  let acked = false;
  let n = 0;
  const issues: Array<{ key: string; release: () => void }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { action: string; token?: string };
    if (body.action === 'completion_status_issue') {
      n += 1;
      const key = String(n).repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, 'a');
      if (!acked) current = key;
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      issues.push({ key, release });
      await gate;
      return json({ outcome: 'status_capability', requestId, token: key, expiresAt: NOW + 900_000 });
    }
    if (body.action === 'completion_status_ack') {
      if (body.token === current) { acked = true; return json({ outcome: 'status_acknowledged', requestId }); }
      return json({ outcome: 'unavailable', canRetry: false }, 503);
    }
    return json({ outcome: 'processing', requestId, canRetry: false });
  });
  return { fetchImpl, issues, issueCount: () => fetchImpl.mock.calls.filter(([, i]) => String(i?.body).includes('_issue')).length };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('#1643 single-flight issuance (Sam RETURN 1792550424)', () => {
  it('CASUALTY: two concurrent secure calls dispatch ONE issue and both end acknowledged (C-first/D-late can no longer arise)', async () => {
    const server = fakeServer();
    const transport = createCompletionTransport(ORIGIN, server.fetchImpl)!;
    const a = secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW);
    const b = secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW);
    await flush();
    server.issues.forEach((i) => i.release());
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(server.issueCount()).toBe(1);
    expect(completionCapabilities.get('owner-a', requestId, NOW)?.acknowledged).toBe(true);
  });

  it('CONTROL: a later secure call after the flight settles reuses the acknowledged key (no new issue)', async () => {
    const server = fakeServer();
    const transport = createCompletionTransport(ORIGIN, server.fetchImpl)!;
    const first = secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW);
    await flush();
    server.issues[0].release();
    expect(await first).toBe(true);
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW)).toBe(true);
    expect(server.issueCount()).toBe(1);
  });

  it('FENCE: clear() during a flight invalidates it — the old flight holds nothing; a new call starts its own flight', async () => {
    const server = fakeServer();
    const transport = createCompletionTransport(ORIGIN, server.fetchImpl)!;
    const old = secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW);
    await flush();
    completionCapabilities.clear();
    const fresh = secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW);
    await flush();
    expect(server.issueCount()).toBe(2);
    server.issues[0].release();
    expect(await old).toBe(false);
    server.issues[1].release();
    expect(await fresh).toBe(true);
    expect(completionCapabilities.get('owner-a', requestId, NOW)?.token).toBe(server.issues[1].key);
  });
});

describe('#1643 transport reply bound is in bytes, not UTF-16 characters (Sam RETURN 1792550424)', () => {
  it('CASUALTY: a multi-byte reply over 8192 bytes but under 8192 characters is refused', async () => {
    const big = JSON.stringify({ outcome: 'unavailable', canRetry: false, pad: '€'.repeat(3000) });
    expect(big.length).toBeLessThan(8192);
    expect(new TextEncoder().encode(big).byteLength).toBeGreaterThan(8192);
    const transport = createCompletionTransport(ORIGIN, vi.fn<typeof fetch>().mockResolvedValue(new Response(big)))!;
    await expect(transport({ action: 'completion_status_read', requestId, token }, null)).rejects.toThrow('reply_too_large');
  });

  it('FENCE: invalid UTF-8 is refused, not replaced', async () => {
    const transport = createCompletionTransport(ORIGIN, vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0x7b, 0xff, 0x7d]))))!;
    await expect(transport({ action: 'completion_status_read', requestId, token }, null)).rejects.toThrow();
  });
});

// Sam SOURCE ACCEPT 1792551068 qualification: a stalled reply must not leave a call (or the shared flight) pending.
describe('#1643 transport waits are bounded', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('CASUALTY: a fetch that never settles is aborted at the deadline and the call rejects', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_u, init) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => {}); });
    const call = createCompletionTransport(ORIGIN, fetchImpl)!({ action: 'completion_status_read', requestId, token }, null);
    const outcome = call.then(() => 'resolved', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe('timeout');
    expect(signal?.aborted).toBe(true);
  });

  it('CASUALTY: a body that stalls mid-stream is cancelled at the same deadline', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('{"outcome":')); },
      cancel() { cancelled = true; },
    });
    const call = createCompletionTransport(ORIGIN, vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)))!(
      { action: 'completion_status_read', requestId, token }, null);
    const outcome = call.then(() => 'resolved', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe('timeout');
    expect(cancelled).toBe(true);
  });

  it('CASUALTY: a stalled issue ends its flight (false), and a later secure call starts a fresh one', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValueOnce(new Promise<Response>(() => {}))
      .mockResolvedValueOnce(json({ outcome: 'status_capability', requestId, token, expiresAt: NOW + 900_000 }))
      .mockResolvedValueOnce(json({ outcome: 'status_acknowledged', requestId }));
    const transport = createCompletionTransport(ORIGIN, fetchImpl)!;
    const stalled = secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await stalled).toBe(false);
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'owner.jwt', () => NOW)).toBe(true);
  });

  // Sam RETURN 1792551648: a fetch that ignores abort and resolves after the deadline must not have its body read.
  it('CASUALTY: a response that arrives after the timeout is cancelled (not awaited) and its body is never acquired', async () => {
    vi.useFakeTimers();
    let deliver!: (r: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((r) => { deliver = r; }));
    let cancelCount = 0;
    const late = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { cancelCount += 1; return new Promise<void>(() => {}); } });
    const call = createCompletionTransport(ORIGIN, fetchImpl)!({ action: 'completion_status_read', requestId, token }, null);
    const outcome = call.then(() => 'resolved', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe('timeout');
    const response = new Response(late);
    deliver(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelCount).toBe(1);
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CONTROL: a reply inside the deadline is unaffected and leaves no timer running', async () => {
    vi.useFakeTimers();
    const call = createCompletionTransport(ORIGIN, vi.fn<typeof fetch>().mockResolvedValue(json({ outcome: 'processing', requestId, canRetry: false })))!(
      { action: 'completion_status_read', requestId, token }, null);
    await expect(call).resolves.toEqual({ outcome: 'processing', requestId, canRetry: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
