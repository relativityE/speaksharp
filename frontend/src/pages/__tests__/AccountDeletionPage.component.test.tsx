import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountDeletionPage from '../AccountDeletionPage';
import { completionCapabilities } from '@/services/accountCompletionStatus';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), signOut: vi.fn(async () => {}), token: null as string | null,
  user: { id: 'owner' } as { id: string } | null, clear: vi.fn(), session: vi.fn(), status: null as unknown,
}));
vi.mock('@/contexts/AuthProvider', () => ({
  useAuthProvider: () => ({ user: mocks.user, loading: false, signOut: mocks.signOut }),
}));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({
  auth: { getSession: mocks.session },
  functions: { invoke: (name: string, options: { body: { action: string } }) => options.body.action === 'status'
    ? Promise.resolve({ data: mocks.status ?? { outcome: 'not_pending', destructiveEnabled: false }, error: null })
    : mocks.invoke(name, options) },
}) }));
vi.mock('@/services/accountDeletionVerification', () => ({
  accountDeletionToken: () => mocks.token, clearAccountDeletionToken: mocks.clear,
  consumeAccountDeletionToken: (expected: string) => {
    if (mocks.token !== expected) return false;
    mocks.clear();
    return true;
  },
}));
const mount = async () => {
  const view = render(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
  await waitFor(() => expect(within(view.container).queryByText('Checking your account deletion status…')).not.toBeInTheDocument());
  return view;
};
const secret = 'a'.repeat(64);
const done = { outcome: 'deleted', accountDeleted: true, billingClosed: true, customerDeleted: true };
let ownerSequence = 0;

beforeEach(() => {
  vi.clearAllMocks(); mocks.token = null; mocks.user = { id: `owner-${++ownerSequence}` };
  mocks.status = null;
  mocks.session.mockImplementation(async () => ({ data: { session: { user: mocks.user, access_token: 'test-only' } }, error: null }));
  mocks.clear.mockImplementation(() => { mocks.token = null; });
  mocks.invoke.mockResolvedValue({ data: { outcome: 'email_requested' }, error: null });
});

describe('explicit pending completion — real page and effect/status transports', () => {
  const requestId = '44444444-4444-4444-8444-444444444444';
  const key = 'b'.repeat(64);
  const pending = { outcome: 'pending', requestId, phase: 'pending', destructiveEnabled: false, checkoutPending: 0 };
  const completed = { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
  const effects = () => transport.mock.calls.filter(([, options]) => JSON.parse(String(options?.body)).action === 'completion_execute');
  const transport = vi.fn<typeof fetch>();
  let readReply: unknown;
  beforeEach(() => {
    mocks.user = { id: `11111111-1111-4111-8111-${String(ownerSequence).padStart(12, '0')}` };
    mocks.status = pending;
    completionCapabilities.clear();
    readReply = { outcome: 'pending', requestId, reason: 'ready', canRetry: false };
    transport.mockReset();
    transport.mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      if (body.action === 'completion_status_issue') return Response.json({ outcome: 'status_capability', requestId, token: key, expiresAt: Date.now() + 60_000 });
      if (body.action === 'completion_status_ack') return Response.json({ outcome: 'status_acknowledged', requestId });
      if (body.action === 'completion_status_read') return Response.json(readReply);
      if (body.action === 'completion_execute') return Response.json(completed);
      throw new Error('unexpected synthetic transport call');
    });
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubGlobal('fetch', transport);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); completionCapabilities.clear(); });
  const renderPage = (ready?: () => boolean) => render(<MemoryRouter><AccountDeletionPage completionReadiness={ready} /></MemoryRouter>);
  const confirmCompletion = async () => {
    const button = await screen.findByRole('button', { name: 'Complete permanent account deletion' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm permanent account deletion now, with no refund.' }));
    fireEvent.click(button);
  };
  it('default unavailable cannot become ready from a status reason, legacy flag or secured capability', async () => {
    renderPage();
    await screen.findByText(/Earlier work is settled/);
    expect(completionCapabilities.get(mocks.user!.id, requestId, Date.now())?.acknowledged).toBe(true);
    expect(screen.queryByRole('button', { name: 'Complete permanent account deletion' })).not.toBeInTheDocument();
    expect(effects()).toHaveLength(0);
  });
  it('secures status first, then sends one explicitly confirmed owner effect and shows verified completion', async () => {
    renderPage(() => true);
    await confirmCompletion();
    await screen.findByText('Your account has been deleted.');
    expect(effects()).toHaveLength(1);
    expect(transport.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).action)).toEqual([
      'completion_status_issue', 'completion_status_ack', 'completion_status_read', 'completion_execute',
    ]);
    const [url, options] = effects()[0];
    expect(url).toBe('https://test.supabase.co/functions/v1/account-closure/completion-execute');
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer test-only' } });
    expect(JSON.parse(String(options?.body))).toEqual({ action: 'completion_execute', requestId, confirmIrreversible: true });
    expect(String(options?.body)).not.toContain(key);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it('refuses readiness withdrawn during the owner-Auth await, without an effect call', async () => {
    let ready = true;
    renderPage(() => ready);
    await screen.findByRole('button', { name: 'Complete permanent account deletion' });
    let finish!: (value: unknown) => void;
    mocks.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await confirmCompletion();
    ready = false;
    await act(async () => { finish({ data: { session: { user: mocks.user, access_token: 'test-only' } }, error: null }); });
    await screen.findByText(/We could not verify the deletion result/);
    expect(effects()).toHaveLength(0);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('a failed status acknowledgment never enables an effect even if the independent port is ready', async () => {
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (url, options) => JSON.parse(String(options?.body)).action === 'completion_status_ack'
      ? Response.json({ outcome: 'unavailable', canRetry: false }, { status: 503 }) : original(url, options));
    renderPage(() => true);
    await screen.findByText(/Outstanding checkout operations: 0/);
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Complete permanent account deletion' })).not.toBeInTheDocument();
    expect(effects()).toHaveLength(0);
  });
  it('a stalled owner-Auth check has a bounded uncertain result and cannot dispatch later', async () => {
    renderPage(() => true);
    const button = await screen.findByRole('button', { name: 'Complete permanent account deletion' });
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    mocks.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm permanent account deletion now, with no refund.' }));
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText(/We could not verify the deletion result/)).toBeInTheDocument();
    await act(async () => { finish({ data: { session: { user: mocks.user, access_token: 'test-only' } }, error: null }); });
    expect(effects()).toHaveLength(0);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('an uncertain effect cannot be replayed by remounting the page', async () => {
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (url, options) => {
      if (JSON.parse(String(options?.body)).action === 'completion_execute') throw new Error('unknown outcome');
      return original(url, options);
    });
    const first = renderPage(() => true);
    await confirmCompletion();
    await screen.findByText(/We could not verify the deletion result/);
    first.unmount();
    renderPage(() => true);
    await screen.findByText(/We could not verify the deletion result/);
    expect(screen.queryByRole('button', { name: 'Complete permanent account deletion' })).not.toBeInTheDocument();
    expect(effects()).toHaveLength(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('late owner-A completion cannot display for B or sign B out', async () => {
    const original = transport.getMockImplementation()!;
    let finish!: (value: Response) => void;
    transport.mockImplementation(async (url, options) => JSON.parse(String(options?.body)).action === 'completion_execute'
      ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    const view = renderPage(() => true);
    await confirmCompletion();
    await waitFor(() => expect(effects()).toHaveLength(1));
    mocks.user = { id: '99999999-9999-4999-8999-999999999999' };
    mocks.status = { outcome: 'not_pending', destructiveEnabled: false };
    view.rerender(<MemoryRouter><AccountDeletionPage completionReadiness={() => true} /></MemoryRouter>);
    await act(async () => { finish(Response.json(completed)); });
    expect(screen.queryByText('Your account has been deleted.')).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(effects()).toHaveLength(1);
  });
  it('after sign-out an uncertain effect recovers by capability-only status, with no second effect or Auth lookup', async () => {
    const original = transport.getMockImplementation()!;
    let finish!: (value: Response) => void;
    transport.mockImplementation(async (url, options) => JSON.parse(String(options?.body)).action === 'completion_execute'
      ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    const view = renderPage(() => true);
    await confirmCompletion();
    await waitFor(() => expect(effects()).toHaveLength(1));
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage completionReadiness={() => true} /></MemoryRouter>);
    await act(async () => { finish(Response.json(completed)); });
    await screen.findByText(/We could not verify the deletion result/);
    readReply = completed;
    const authCalls = mocks.session.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Check deletion status' }));
    await screen.findByText('Your account has been deleted.');
    expect(mocks.session).toHaveBeenCalledTimes(authCalls);
    expect(effects()).toHaveLength(1);
    const options = transport.mock.calls[transport.mock.calls.length - 1][1];
    expect(options?.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(options?.body))).toEqual({ action: 'completion_status_read', requestId, token: key });
  });
});

describe('deletion confirmation UI — real component, mocked provider boundary', () => {
  it('remounting during confirmation blocks a second confirmation and a new email request', async () => {
    mocks.token = secret;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    first.unmount();
    await mount();
    try {
      expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
      expect(screen.getByText(/confirmation is pending/i)).toBeInTheDocument();
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => { finish({ data: null, error: new Error('connection lost') }); });
    }
    expect(screen.getByText(/could not verify the deletion result/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('an uncertain confirmation remains blocked after leaving and returning to the page', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('connection lost') });
    const first = await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/could not verify the deletion result/);
    first.unmount();
    await mount();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(screen.getByText(/could not verify the deletion result/)).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('a second mounted deletion form cannot replay a token consumed by the first form', async () => {
    mocks.token = secret;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount();
    await mount();
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
    const buttons = screen.getAllByRole('button', { name: 'Permanently delete my account' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.token).toBeNull();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    await act(async () => { finish({ data: null, error: new Error('connection lost') }); });
    expect(screen.getAllByText(/could not verify the deletion result/)).toHaveLength(2);
  });
  it('verified non-deletion permits a fresh explicit email request after remount, never token replay', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValueOnce({ data: {
      outcome: 'refused', accountDeleted: false, billingClosed: false, customerDeleted: false,
    }, error: null }).mockResolvedValueOnce({ data: { outcome: 'email_requested' }, error: null });
    const first = await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/Verification was refused or expired/);
    first.unmount();
    await mount();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Permanently delete my account' })).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    await screen.findByText(/Check your account email/);
    expect(screen.queryByText(/Verification was refused or expired/)).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith('account-closure', { body: { action: 'request' } });
  });
  it('a completed confirmation remains completed after remount without a second sign-out or request', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: done, error: null });
    const first = await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/Your account has been deleted/);
    first.unmount();
    await mount();
    expect(screen.getByText(/Your account has been deleted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['refused with deletion', { ...done, outcome: 'refused' }],
    ['deleted without closed billing', { ...done, outcome: 'incomplete', billingClosed: false }],
    ['customer deleted before billing closed', { ...done, outcome: 'incomplete', accountDeleted: false, billingClosed: false }],
  ])('contradictory %s stays unverified for both successful and SDK error responses', async (_label, data) => {
    for (const transport of ['success', 'SDK error']) {
      mocks.user = { id: `owner-${++ownerSequence}` };
      mocks.token = secret;
      mocks.invoke.mockResolvedValue(transport === 'success'
        ? { data, error: null }
        : { data: null, error: { context: new Response(JSON.stringify(data), { status: 409 }) } });
      const view = await mount();
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
      await screen.findByText(/could not verify the deletion result/);
      expect(screen.queryByText(/Your account has been deleted/)).not.toBeInTheDocument();
      expect(screen.queryByText(/your account has not been deleted/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
      expect(mocks.signOut).not.toHaveBeenCalled();
      view.unmount();
    }
  });
  it('a pending confirmation cannot be submitted twice and an uncertain result offers no replay', async () => {
    mocks.token = secret;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    expect(screen.getByText(/confirmation is pending/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.token).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Your account has been deleted/)).not.toBeInTheDocument();
    await act(async () => { finish({ data: { ...done, outcome: 'verification_pending', accountDeleted: null }, error: null }); });
    expect(screen.getByText(/It may already have happened/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('email-request failure retries only on an explicit click and clears the old error after success', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('request lost'))
      .mockResolvedValueOnce({ data: { outcome: 'email_requested' }, error: null });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    await screen.findByText(/could not send a verification link/);
    const retry = screen.getByRole('button', { name: 'Email me a verification link' });
    expect(retry).toBeEnabled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Check your account email/)).not.toBeInTheDocument();
    fireEvent.click(retry);
    await screen.findByText(/Check your account email/);
    expect(screen.queryByText(/could not send a verification link/)).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith('account-closure', { body: { action: 'request' } });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('verified token refusal consumes confirmation and requires a new explicit email request', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({
      outcome: 'refused', accountDeleted: false, billingClosed: false, customerDeleted: false,
    }), { status: 403 }) } });
    await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/Verification was refused or expired/);
    expect(screen.getByRole('button', { name: 'Email me a verification link' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Permanently delete my account' })).not.toBeInTheDocument();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('an expired auth response without a verified deletion result never claims success or offers blind retry', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(
      JSON.stringify({ error: 'JWT expired' }), { status: 401 },
    ) } });
    await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/could not verify the deletion result/);
    expect(screen.queryByText(/Your account has been deleted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/your account has not been deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('auth expiry while an email request is pending retires its late result and shows sign-in', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    mocks.user = null;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    await act(async () => { finish({ data: { outcome: 'email_requested' }, error: null }); });
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Check your account email/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('returning to the same account cannot revive a retired confirmation', async () => {
    const owner = mocks.user;
    mocks.token = secret;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    mocks.user = { id: 'different-account' };
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    mocks.user = owner;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    await act(async () => { finish({ data: done, error: null }); });
    expect(screen.getByText(/could not verify the deletion result/)).toBeInTheDocument();
    expect(screen.queryByText(/Your account has been deleted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['success', 'error'])('a retired email-request %s cannot publish a result after an account round trip', async (outcome) => {
    const owner = mocks.user;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    mocks.user = { id: 'different-account' };
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    mocks.user = owner;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    await act(async () => { finish(outcome === 'success'
      ? { data: { outcome: 'email_requested' }, error: null }
      : { data: null, error: new Error('request result unavailable') }); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a verification link' })).toBeEnabled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('an old-account confirmation cannot report completion or sign out a newly signed-in account', async () => {
    const owner = mocks.user;
    mocks.token = secret;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    mocks.user = { id: 'different-account' };
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    await act(async () => { finish({ data: done, error: null }); });
    expect(screen.queryByText(/could not verify the deletion result/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your account has been deleted/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a verification link' })).toBeEnabled();
    mocks.user = owner;
    view.rerender(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
    expect(screen.getByText(/could not verify the deletion result/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('a late confirmation after leaving the page cannot sign out a later session', async () => {
    mocks.token = secret;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    view.unmount();
    await act(async () => { finish({ data: done, error: null }); });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['success body', 'SDK error context'])('a request-only result during confirmation stays unverified (%s)', async (transport) => {
    mocks.token = secret;
    const data = { outcome: 'email_requested' };
    mocks.invoke.mockResolvedValue(transport === 'success body'
      ? { data, error: null }
      : { data: null, error: { context: new Response(JSON.stringify(data), { status: 409 }) } });
    await mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/could not verify the deletion result/);
    expect(screen.queryByText(/your account has not been deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check your account email/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalled();
  });
  it('unknown auth outcome warns deletion may have happened and offers no blind retry/link', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: { ...done, outcome: 'verification_pending', accountDeleted: null }, error: null });
    await mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/It may already have happened/);
    expect(screen.queryByText(/your account has not been deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('states irreversible loss, no refund and retained exceptions before offering verification', async () => {
    await mount();
    expect(screen.getByText(/forfeits remaining paid time without a refund/)).toBeInTheDocument();
    expect(screen.getByText(/trial email is retained to prevent repeat trials/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelling membership never schedules account deletion/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('requests an email only, never deletion', async () => {
    await mount(); fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    await screen.findByText(/Check your account email/);
    expect(mocks.invoke).toHaveBeenCalledWith('account-closure', { body: { action: 'request' } });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('email failure never claims a link was sent', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('unavailable') });
    await mount(); fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    await screen.findByText(/could not send a verification link/);
    expect(screen.queryByText(/Check your account email/)).not.toBeInTheDocument();
  });
  it('opening the emailed page neither invokes deletion nor bypasses explicit acknowledgement', async () => {
    mocks.token = secret; await mount();
    const button = screen.getByRole('button', { name: 'Permanently delete my account' });
    expect(button).toBeDisabled(); fireEvent.click(button);
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    mocks.invoke.mockResolvedValue({ data: done, error: null });
    fireEvent.click(button);
    await screen.findByText(/Your account has been deleted/);
    expect(mocks.invoke).toHaveBeenCalledWith('account-closure', { body: { action: 'confirm', token: secret, confirmIrreversible: true } });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });
  it('suppresses duplicate clicks while an action is pending', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValue(new Promise((r) => { resolve = r; }));
    await mount(); const button = screen.getByRole('button', { name: 'Email me a verification link' });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    resolve({ data: { outcome: 'email_requested' }, error: null });
    await screen.findByText(/Check your account email/);
  });
  it('partial billing closure remains distinct from account deletion, including non-2xx SDK responses', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({
      outcome: 'incomplete', accountDeleted: false, billingClosed: true, customerDeleted: true,
    }), { status: 409 }) } });
    await mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/Billing is closed, but your account has not been deleted/);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('unreadable or inconsistent result is unverified, never completion or automatic retry', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: { ...done, billingClosed: false }, error: null });
    await mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/could not verify the deletion result/);
    expect(mocks.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  });
  it('an account already deleted with incomplete residue proof is disclosed and signed out', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: { ...done, outcome: 'incomplete' }, error: null });
    await mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/complete cleanup could not be verified/);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
  it('verified deletion without a prior Stripe customer remains a valid completed outcome', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: { ...done, customerDeleted: false }, error: null });
    await mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/Your account has been deleted/);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/could not verify the deletion result/)).not.toBeInTheDocument();
  });
  it('unsigned users cannot request verification or delete', async () => {
    mocks.user = null; mocks.token = secret; await mount();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permanently delete|Email me/ })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
