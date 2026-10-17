import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountDeletionPage from '../AccountDeletionPage';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), signOut: vi.fn(async () => {}), token: null as string | null,
  user: { id: 'owner' } as { id: string } | null, clear: vi.fn(),
}));
vi.mock('@/contexts/AuthProvider', () => ({
  useAuthProvider: () => ({ user: mocks.user, loading: false, signOut: mocks.signOut }),
}));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ functions: { invoke: mocks.invoke } }) }));
vi.mock('@/services/accountDeletionVerification', () => ({
  accountDeletionToken: () => mocks.token, clearAccountDeletionToken: mocks.clear,
}));
const mount = () => render(<MemoryRouter><AccountDeletionPage /></MemoryRouter>);
const secret = 'a'.repeat(64);
const done = { outcome: 'deleted', accountDeleted: true, billingClosed: true, customerDeleted: true };

beforeEach(() => {
  vi.clearAllMocks(); mocks.token = null; mocks.user = { id: 'owner' };
  mocks.invoke.mockResolvedValue({ data: { outcome: 'email_requested' }, error: null });
});

describe('deletion confirmation UI — real component, mocked provider boundary', () => {
  it.each(['success body', 'SDK error context'])('a request-only result during confirmation stays unverified (%s)', async (transport) => {
    mocks.token = secret;
    const data = { outcome: 'email_requested' };
    mocks.invoke.mockResolvedValue(transport === 'success body'
      ? { data, error: null }
      : { data: null, error: { context: new Response(JSON.stringify(data), { status: 409 }) } });
    mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/could not verify the deletion result/);
    expect(screen.queryByText(/your account has not been deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check your account email/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalled();
  });
  it('unknown auth outcome warns deletion may have happened and offers no blind retry/link', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: { ...done, outcome: 'verification_pending', accountDeleted: null }, error: null });
    mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/It may already have happened/);
    expect(screen.queryByText(/your account has not been deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('states irreversible loss, no refund and retained exceptions before offering verification', () => {
    mount();
    expect(screen.getByText(/forfeits remaining paid time without a refund/)).toBeInTheDocument();
    expect(screen.getByText(/trial email is retained to prevent repeat trials/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelling membership never schedules account deletion/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('requests an email only, never deletion', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    await screen.findByText(/Check your account email/);
    expect(mocks.invoke).toHaveBeenCalledWith('account-closure', { body: { action: 'request' } });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('email failure never claims a link was sent', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('unavailable') });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Email me a verification link' }));
    await screen.findByText(/could not send a verification link/);
    expect(screen.queryByText(/Check your account email/)).not.toBeInTheDocument();
  });
  it('opening the emailed page neither invokes deletion nor bypasses explicit acknowledgement', async () => {
    mocks.token = secret; mount();
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
    mount(); const button = screen.getByRole('button', { name: 'Email me a verification link' });
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
    mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/Billing is closed, but your account has not been deleted/);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('unreadable or inconsistent result is unverified, never completion or automatic retry', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: { ...done, billingClosed: false }, error: null });
    mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/could not verify the deletion result/);
    expect(mocks.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  });
  it('an account already deleted with incomplete residue proof is disclosed and signed out', async () => {
    mocks.token = secret;
    mocks.invoke.mockResolvedValue({ data: { ...done, outcome: 'incomplete' }, error: null });
    mount(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    await screen.findByText(/complete cleanup could not be verified/);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
  it('unsigned users cannot request verification or delete', () => {
    mocks.user = null; mocks.token = secret; mount();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
