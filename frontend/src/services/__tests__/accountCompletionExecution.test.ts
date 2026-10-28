import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountCompletionExecution, type CompletionExecutionState } from '../accountCompletionExecution';

let ownerId = '11111111-1111-4111-8111-111111111111';
let requestId = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const unavailable = { outcome: 'unavailable', canRetry: false };
let completed = { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
let sequence = 0;
beforeEach(() => {
  const suffix = String(++sequence).padStart(12, '0');
  ownerId = `11111111-1111-4111-8111-${suffix}`;
  requestId = `22222222-2222-4222-8222-${suffix}`;
  completed = { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
});
function fixture(options: { ready?: boolean; origin?: string } = {}) {
  let state: CompletionExecutionState | null = { ownerId, requestId, bearer: 'synthetic-owner-token',
    statusSecured: true, generation: 1, ...(options.ready ? { backendReady: true } : {}) };
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(completed));
  const execute = createAccountCompletionExecution({ supabaseUrl: options.origin ?? 'https://project.supabase.co',
    current: () => state, fetchImpl });
  return { execute, fetchImpl, set: (next: CompletionExecutionState | null) => { state = next; },
    current: () => state!, action: { ownerId, requestId, confirmIrreversible: true } };
}
afterEach(() => vi.useRealTimers());
describe('explicit account-completion effect transport', () => {
  it('is unavailable by default and never dispatches during construction', async () => {
    const f = fixture();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['http://project.supabase.co', 'https://a:b@project.supabase.co', 'https://project.supabase.co/path',
    'https://project.supabase.co/?x=1', 'https://project.supabase.co/#x', 'invalid'])('refuses unsafe target %s', async origin => {
    const f = fixture({ ready: true, origin });
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['owner', 'request', 'confirmation', 'status', 'bearer', 'signed-out'])('refuses missing or mismatched %s without consuming an effect', async kind => {
    const f = fixture({ ready: true });
    const action = { ...f.action };
    if (kind === 'owner') action.ownerId = other;
    if (kind === 'request') action.requestId = other;
    if (kind === 'confirmation') action.confirmIrreversible = false;
    if (kind === 'status') f.set({ ...f.current(), statusSecured: false });
    if (kind === 'bearer') f.set({ ...f.current(), bearer: 'bad token' });
    if (kind === 'signed-out') f.set(null);
    expect(await f.execute(action)).toEqual(unavailable);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('sends only the exact closed body and live owner bearer to the fixed effect route', async () => {
    const f = fixture({ ready: true });
    expect(await f.execute(f.action)).toEqual(completed);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = f.fetchImpl.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/functions/v1/account-closure/completion-execute');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer synthetic-owner-token', 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(options?.body))).toEqual({ action: 'completion_execute', requestId, confirmIrreversible: true });
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
  it('fences double submissions and stale owner settlements while preserving the consumed request', async () => {
    const f = fixture({ ready: true });
    let resolve!: (response: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const first = f.execute(f.action);
    expect(await f.execute(f.action)).toEqual(unavailable);
    f.set({ ...f.current(), ownerId: other, generation: 2 });
    resolve(Response.json(completed));
    expect(await first).toEqual(unavailable);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
  it('a remounted or second page instance cannot replay an uncertain owner/request effect', async () => {
    const first = fixture({ ready: true });
    first.fetchImpl.mockRejectedValueOnce(new Error('unknown outcome'));
    expect(await first.execute(first.action)).toEqual(unavailable);
    const remount = fixture({ ready: true });
    expect(await remount.execute(remount.action)).toEqual(unavailable);
    expect(remount.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['request', 'generation', 'sign-out'])('drops a completed reply after %s changes', async kind => {
    const f = fixture({ ready: true });
    let resolve!: (response: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const flight = f.execute(f.action);
    f.set(kind === 'sign-out' ? null : { ...f.current(), ...(kind === 'request' ? { requestId: other } : { generation: 2 }) });
    resolve(Response.json(completed));
    expect(await flight).toEqual(unavailable);
  });
  it('accepts only a matching closed pending response without claiming completion', async () => {
    const f = fixture({ ready: true });
    const pending = { outcome: 'pending', requestId, canRetry: false };
    f.fetchImpl.mockResolvedValueOnce(Response.json(pending, { status: 202 }));
    expect(await f.execute(f.action)).toEqual(pending);
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(['foreign', 'extra', 'retry', 'not-deleted', 'wrong-status', 'oversized', 'malformed', 'rejected'])('keeps %s replies unavailable and never automatically retries', async kind => {
    const f = fixture({ ready: true });
    if (kind === 'rejected') f.fetchImpl.mockRejectedValueOnce(new Error('unknown effect outcome'));
    else if (kind === 'malformed') f.fetchImpl.mockResolvedValueOnce(new Response('{'));
    else if (kind === 'oversized') f.fetchImpl.mockResolvedValueOnce(new Response(' '.repeat(8193)));
    else f.fetchImpl.mockResolvedValueOnce(Response.json({ ...completed,
      ...(kind === 'foreign' ? { requestId: other } : {}), ...(kind === 'extra' ? { token: 'not-permitted' } : {}),
      ...(kind === 'retry' ? { canRetry: true } : {}), ...(kind === 'not-deleted' ? { accountDeleted: false } : {}) },
    { status: kind === 'wrong-status' ? 503 : 200 }));
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
  it('bounds a stalled fetch, aborts, and refuses a later effect retry', async () => {
    vi.useFakeTimers();
    const f = fixture({ ready: true });
    let resolve!: (response: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const flight = f.execute(f.action);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await flight).toEqual(unavailable);
    expect((f.fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    resolve(Response.json(completed));
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
  it('bounds a stalled body, cancels its reader, and never converts it to completion', async () => {
    vi.useFakeTimers();
    const f = fixture({ ready: true });
    const cancel = vi.fn();
    f.fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    const flight = f.execute(f.action);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await flight).toEqual(unavailable);
    expect(cancel).toHaveBeenCalledOnce();
    expect((f.fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(await f.execute(f.action)).toEqual(unavailable);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
});
