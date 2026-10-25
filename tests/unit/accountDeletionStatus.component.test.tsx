import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AccountDeletionPage from '@/pages/AccountDeletionPage';
import { handleClosureRequest, type ClosureRequestDependencies } from '../../backend/supabase/functions/_shared/accountClosureRequest';
import { completionCapabilities } from '@/services/accountCompletionStatus';

const mocks = vi.hoisted(() => ({
  user: { id: 'owner' } as { id: string } | null,
  session: vi.fn(), invoke: vi.fn(), signOut: vi.fn(), token: null as string | null,
}));
vi.mock('@/contexts/AuthProvider', () => ({
  useAuthProvider: () => ({ user: mocks.user, loading: false, signOut: mocks.signOut }),
}));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({
  auth: { getSession: mocks.session }, functions: { invoke: mocks.invoke },
}) }));
vi.mock('@/services/accountDeletionVerification', () => ({
  accountDeletionToken: () => mocks.token,
  consumeAccountDeletionToken: (expected: string) => {
    if (mocks.token !== expected) return false;
    mocks.token = null;
    return true;
  },
}));

const completionFetch = vi.fn<typeof fetch>();
const notPending = { outcome: 'not_pending', destructiveEnabled: false };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pending = { outcome: 'pending', requestId, phase: 'pending', destructiveEnabled: false, checkoutPending: 1 };
const mount = () => render(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
const response = (data: unknown) => ({ data, error: null });
const confirm = async () => {
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
};
let sequence = 0;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = { id: `status-owner-${++sequence}` };
  mocks.token = 'a'.repeat(64);
  mocks.session.mockImplementation(async () => ({ data: {
    session: { user: mocks.user, access_token: `test-bearer-${mocks.user?.id}` },
  }, error: null }));
  mocks.invoke.mockResolvedValue(response(notPending));
  completionCapabilities.clear();
  // #1643 completion route default-off: the server's unbound reply. Existing cases therefore see no completion state.
  completionFetch.mockImplementation(async () => new Response(JSON.stringify({ outcome: 'unavailable', canRetry: false }), { status: 503 }));
  vi.stubGlobal('fetch', completionFetch);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('#1643 owner-status recovery — real page, transport seams', () => {
  it('hydrates durable pending on reload without requesting email or confirming again', async () => {
    mocks.invoke.mockResolvedValue(response(pending));
    const first = mount();
    await screen.findByText(/Outstanding checkout operations: 1/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    first.unmount();
    mount();
    await screen.findByText(/Outstanding checkout operations: 1/);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls.every(([, options]) => options.body.action === 'status')).toBe(true);
    expect(mocks.token).toHaveLength(64);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('accepts the actual request handler 202 pending reply without claiming deletion', async () => {
    let durable: Omit<typeof pending, 'outcome'> | null = null;
    const deps: ClosureRequestDependencies = {
      authenticate: async () => ({ id: mocks.user!.id, email: 'fixture@example.invalid' }),
      siteUrl: 'https://example.invalid', randomToken: () => 'a'.repeat(64), hashToken: async () => 'hash',
      issue: vi.fn(async () => true), revoke: vi.fn(async () => {}), sendLink: vi.fn(async () => {}),
      closure: () => { throw new Error('destructive adapter must never run'); }, finish: vi.fn(async () => {}),
      pending: {
        confirm: vi.fn(async () => {
          durable = { requestId, phase: 'pending', destructiveEnabled: false, checkoutPending: 1 };
          return durable;
        }),
        status: vi.fn(async () => durable),
      },
    };
    mocks.invoke.mockImplementation(async (_name, options) => {
      const result = await handleClosureRequest(new Request('https://example.invalid/account-closure', {
        method: 'POST', body: JSON.stringify(options.body),
      }), deps);
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      return response(await result.json());
    });
    mount();
    await confirm();
    await screen.findByText(/Outstanding checkout operations: 1/);
    expect(deps.pending!.confirm).toHaveBeenCalledTimes(1);
    expect(deps.issue).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(screen.queryByText(/Your account has been deleted/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await screen.findByText(/Outstanding checkout operations: 1/);
    expect(deps.pending!.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.token).toBeNull();
  });

  it('recovers pending after a lost confirmation reply using status only', async () => {
    mocks.invoke.mockImplementation(async (_name, options) => options.body.action === 'confirm'
      ? { data: null, error: new Error('response lost after commit') }
      : response(mocks.token ? notPending : pending));
    mount();
    await confirm();
    await screen.findByText(/could not verify the deletion result/);
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await screen.findByText(/Outstanding checkout operations: 1/);
    expect(mocks.invoke.mock.calls.map(([, options]) => options.body.action)).toEqual(['status', 'confirm', 'status']);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('not_pending cannot reopen an uncertain local confirmation or restore its consumed token', async () => {
    mocks.invoke.mockImplementation(async (_name, options) => options.body.action === 'confirm'
      ? { data: null, error: new Error('unknown commit') } : response(notPending));
    mount();
    await confirm();
    await screen.findByText(/could not verify the deletion result/);
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await waitFor(() => expect(screen.queryByText('Checking your account deletion status…')).not.toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a verification link' })).not.toBeInTheDocument();
    expect(mocks.token).toBeNull();
    expect(mocks.invoke.mock.calls.filter(([, options]) => options.body.action === 'confirm')).toHaveLength(1);
  });

  it('retains request identity observed on remount while the original confirmation reply is still pending', async () => {
    let finish: (value: unknown) => void = () => {};
    let statusReads = 0;
    mocks.invoke.mockImplementation((_name, options) => {
      if (options.body.action === 'confirm') return new Promise((resolve) => { finish = resolve; });
      statusReads += 1;
      return Promise.resolve(response(statusReads === 1 ? notPending : statusReads === 2 ? pending
        : { ...pending, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
    });
    const first = mount();
    await confirm();
    first.unmount();
    mount();
    await screen.findByText(/Outstanding checkout operations: 1/);
    await act(async () => { finish({ data: null, error: new Error('late lost confirmation reply') }); });
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await screen.findByText(/could not verify your account deletion status/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.invoke.mock.calls.filter(([, options]) => options.body.action === 'confirm')).toHaveLength(1);
  });

  it('another mounted page observing pending dominates a late refusal and cannot reopen the email action', async () => {
    let finish: (value: unknown) => void = () => {};
    let statusReads = 0;
    mocks.invoke.mockImplementation((_name, options) => options.body.action === 'confirm'
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve(response(++statusReads === 1 ? notPending : pending)));
    mount();
    await confirm();
    mount();
    await screen.findByText(/Outstanding checkout operations: 1/);
    await act(async () => { finish(response({ outcome: 'refused', accountDeleted: false,
      billingClosed: false, customerDeleted: false })); });
    expect(screen.queryByRole('button', { name: 'Email me a verification link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.invoke.mock.calls.filter(([, options]) => options.body.action === 'confirm')).toHaveLength(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable', null, new Error('503')],
    ['legacy destructive reply', { outcome: 'deleted', accountDeleted: true }, null],
    ['enabled deletion', { ...pending, destructiveEnabled: true }, null],
    ['negative checkout count', { ...pending, checkoutPending: -1 }, null],
    ['contradictory not-pending', { ...notPending, accountDeleted: true }, null],
  ])('blocks confirmation for %s status', async (_label, data, error) => {
    mocks.invoke.mockResolvedValue({ data, error });
    mount();
    await screen.findByText(/could not verify your account deletion status/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.token).toHaveLength(64);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('fences late owner-A pending after switching to B and pins each status bearer', async () => {
    const ownerA = mocks.user!.id;
    let finishA: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }))
      .mockResolvedValue(response(notPending));
    const view = mount();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    mocks.user = { id: 'owner-B' };
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    await screen.findByRole('checkbox');
    await act(async () => { finishA(response(pending)); });
    expect(screen.queryByText(/Outstanding checkout operations/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(mocks.invoke.mock.calls[0][1].headers.Authorization).toBe(`Bearer test-bearer-${ownerA}`);
    expect(mocks.invoke.mock.calls[1][1].headers.Authorization).toBe('Bearer test-bearer-owner-B');
  });

  it('does not invoke status with a session belonging to another owner', async () => {
    mocks.session.mockResolvedValue({ data: { session: { user: { id: 'foreign' }, access_token: 'foreign' } }, error: null });
    mount();
    await screen.findByText(/could not verify your account deletion status/);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it.each([
    ['not_pending', notPending],
    ['a different request', { ...pending, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
  ])('known pending cannot reopen or be replaced by %s on a subsequent status read', async (_label, next) => {
    mocks.invoke.mockResolvedValueOnce(response(pending)).mockResolvedValue(response(next));
    mount();
    await screen.findByText(/Outstanding checkout operations: 1/);
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await waitFor(() => expect(screen.queryByText('Checking your account deletion status…')).not.toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a verification link' })).not.toBeInTheDocument();
    expect(mocks.token).toHaveLength(64);
  });

  it('a timed-out read stays blocked when it later resolves; only a new explicit status read may recover', async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(response(notPending));
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText(/could not verify your account deletion status/)).toBeInTheDocument();
    await act(async () => { finish(response(notPending)); });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' })); });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});

// #1643 page receiving of the accepted completion status client (PO page clearance via Sam 1792557084; design 1792552705
// with receiving controls 1792552663). The completion route is stubbed at fetch; the legacy status route stays at invoke.
describe('#1643 completion status on the deletion page — fetch-boundary controls', () => {
  const ROUTE = 'https://test.supabase.co/functions/v1/account-closure/completion-status';
  const key = 'c'.repeat(64);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  type Call = { action: string; requestId: string; token?: string; authorization: string | null };
  const calls: Call[] = [];
  const reads: Array<(r: Response) => void> = [];
  /** A server for the three actions; reads either answer `readReply` or are held for manual delivery. */
  const serve = (readReply: unknown | 'hold', issueKey = key, ttlMs = 900_000) => completionFetch.mockImplementation(async (url, init) => {
    expect(String(url)).toBe(ROUTE);
    const body = JSON.parse(String(init?.body)) as { action: string; requestId: string; token?: string };
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ ...body, authorization: headers.Authorization ?? null });
    if (body.action === 'completion_status_issue') return json({ outcome: 'status_capability', requestId: body.requestId, token: issueKey, expiresAt: Date.now() + ttlMs });
    if (body.action === 'completion_status_ack') return json({ outcome: 'status_acknowledged', requestId: body.requestId });
    if (readReply === 'hold') return new Promise<Response>((r) => { reads.push(r); });
    return json(readReply);
  });
  const processing = { outcome: 'processing', requestId, canRetry: false };
  const completedState = { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
  const notice = () => screen.queryByTestId('account-completion-status');
  beforeEach(() => { calls.length = 0; reads.length = 0; mocks.invoke.mockResolvedValue(response(pending)); });

  it('pending → issue/ACK with the owner Bearer, read with the capability only → the closed state is shown', async () => {
    serve(processing);
    mount();
    await waitFor(() => expect(notice()).toHaveTextContent('Your account is being deleted.'));
    expect(calls.map((c) => [c.action, c.authorization])).toEqual([
      ['completion_status_issue', `Bearer test-bearer-${mocks.user!.id}`],
      ['completion_status_ack', `Bearer test-bearer-${mocks.user!.id}`],
      ['completion_status_read', null],
    ]);
    expect(calls[2].token).toBe(key);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a verification link' })).not.toBeInTheDocument();
  });

  it('CONTROL: default-off (503 unavailable) leaves the legacy pending text unchanged and shows no completion state', async () => {
    mount();
    await screen.findByText(/Outstanding checkout operations: 1/);
    await waitFor(() => expect(completionFetch).toHaveBeenCalled());
    expect(notice()).toBeNull();
    expect(screen.queryByText(/has been deleted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('CASUALTY: owner A → signed out keeps A\'s capability; "Check deletion status" reads without Auth and can show completed', async () => {
    serve(processing);
    const view = mount();
    await waitFor(() => expect(notice()).toHaveTextContent('being deleted'));
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    serve(completedState);
    fireEvent.click(await screen.findByRole('button', { name: 'Check deletion status' }));
    await waitFor(() => expect(notice()).toHaveTextContent(/^Your account has been deleted\.$/));
    expect(calls.at(-1)).toMatchObject({ action: 'completion_status_read', authorization: null });
    expect(mocks.session).toHaveBeenCalledTimes(1);
  });

  it('CASUALTY: A → signed out → B clears A\'s capability and A\'s state is never shown to B', async () => {
    serve(processing);
    const view = mount();
    await waitFor(() => expect(notice()).toHaveTextContent('being deleted'));
    const ownerA = mocks.user!.id;
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    mocks.user = { id: 'owner-B' };
    mocks.invoke.mockResolvedValue(response(notPending));
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    // B is not pending: B's own (token-bearing) confirmation form renders, with nothing of A's.
    await screen.findByRole('checkbox');
    expect(notice()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check deletion status' })).not.toBeInTheDocument();
    expect(completionCapabilities.get(ownerA, requestId, Date.now())).toBeNull();
  });

  it('CASUALTY: a late read for owner A that lands after the switch to B is dropped', async () => {
    serve('hold');
    const view = mount();
    await waitFor(() => expect(reads).toHaveLength(1));
    mocks.user = { id: 'owner-B' };
    mocks.invoke.mockResolvedValue(response(notPending));
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    await act(async () => { reads[0](json(completedState)); });
    expect(notice()).toBeNull();
    expect(screen.queryByText(/has been deleted/)).not.toBeInTheDocument();
  });

  it('CASUALTY: an older completed read that lands after a newer unavailable read never becomes visible', async () => {
    serve('hold');
    mount();
    await waitFor(() => expect(reads).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => { reads[1](json({ outcome: 'unavailable', canRetry: false }, 503)); });
    await act(async () => { reads[0](json(completedState)); });
    expect(notice()).toBeNull();
    expect(screen.queryByText(/has been deleted/)).not.toBeInTheDocument();
  });

  it('CASUALTY: a newer unavailable result replaces a visible completed state (no stale completion)', async () => {
    serve(completedState);
    mount();
    await waitFor(() => expect(notice()).toHaveTextContent('has been deleted'));
    serve({ outcome: 'unavailable', canRetry: false });
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await waitFor(() => expect(notice()).toBeNull());
  });

  it('CASUALTY: a request replacement (legacy status now names R2) drops R1\'s completion state', async () => {
    serve(processing);
    mount();
    await waitFor(() => expect(notice()).toHaveTextContent('being deleted'));
    mocks.invoke.mockResolvedValue(response({ ...pending, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await waitFor(() => expect(notice()).toBeNull());
  });

  it('the raw key never reaches the URL or web storage', async () => {
    serve(processing);
    mount();
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(completionFetch.mock.calls.every(([url]) => !String(url).includes(key))).toBe(true);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(key);
    expect(window.location.href).not.toContain(key);
  });

  // Sam RETURN 1792558323 (1): an unverifiable legacy read — thrown or timed out — must invalidate completion work too.
  it('CASUALTY: completed → legacy status throws → sign-out never resurfaces the old completed state', async () => {
    serve(completedState);
    const view = mount();
    await waitFor(() => expect(notice()).toHaveTextContent('has been deleted'));
    mocks.invoke.mockRejectedValue(new Error('legacy status failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await screen.findByText(/could not verify your account deletion status/);
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    expect(notice()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check deletion status' })).not.toBeInTheDocument();
  });

  it('CASUALTY: completed → legacy status deadline → sign-out never resurfaces the old completed state', async () => {
    serve(completedState);
    const view = mount();
    await waitFor(() => expect(notice()).toHaveTextContent('has been deleted'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText(/could not verify your account deletion status/)).toBeInTheDocument();
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    expect(notice()).toBeNull();
  });

  it('CASUALTY: an older completion reply that lands after the legacy read failed never renders, then or after sign-out', async () => {
    serve('hold');
    const view = mount();
    await waitFor(() => expect(reads).toHaveLength(1));
    mocks.invoke.mockRejectedValue(new Error('legacy status failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await screen.findByText(/could not verify your account deletion status/);
    await act(async () => { reads[0](json(completedState)); });
    expect(notice()).toBeNull();
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    expect(notice()).toBeNull();
  });

  // Sam RETURN 1792558323 (2): the signed-out recovery display must disappear at the capability deadline by itself.
  it('CASUALTY: signed-out recovery disappears at the capability deadline with no other render, and its timer is cleaned up', async () => {
    serve(processing, key, 60_000);
    const view = mount();
    await waitFor(() => expect(notice()).toHaveTextContent('being deleted'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.now() });
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Check deletion status' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.queryByRole('button', { name: 'Check deletion status' })).not.toBeInTheDocument();
    expect(notice()).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
