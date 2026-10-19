import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AccountDeletionPage from '@/pages/AccountDeletionPage';
import { handleClosureRequest, type ClosureRequestDependencies } from '../../backend/supabase/functions/_shared/accountClosureRequest';

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
});
afterEach(() => { vi.useRealTimers(); });

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
