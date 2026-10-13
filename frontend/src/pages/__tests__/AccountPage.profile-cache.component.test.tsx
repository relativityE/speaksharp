import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProfileGuard } from '@/components/ProfileGuard';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { profileService } from '@/services/domainServices';
import type { UserProfile } from '@/types/user';
import AccountPage from '../AccountPage';

vi.unmock('@/hooks/useUserProfile');
vi.unmock('@tanstack/react-query');
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: vi.fn() }));
vi.mock('@/services/domainServices', () => ({ profileService: { getById: vi.fn() } }));
vi.mock('@/config/appRuntimeConfig', () => ({ arePaymentsEnabled: () => true }));

const profile: UserProfile = {
  id: 'billing-owner', subscription_status: 'pro', stripe_customer_id: 'cus_owner',
  stripe_subscription_id: 'sub_owner', usage_seconds: 0, usage_reset_date: '', created_at: '',
};
const key = ['userProfile', profile.id];

describe('Account billing return with the real ProfileGuard and shared profile cache', () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(profileService.getById).mockReset();
    vi.mocked(useAuthProvider).mockReturnValue({
      session: { user: { id: profile.id } }, loading: false, signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuthProvider>);
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.useRealTimers();
  });

  const mount = (returned = true, seed = true) => {
    if (seed) client.setQueryData(key, profile);
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: '/account', search: returned ? '?billing=returned' : '' }]}>
          <ProfileGuard><AccountPage /></ProfileGuard>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('failed return polls retain a successful cache, confirmed membership and usable billing controls', async () => {
    vi.mocked(profileService.getById).mockRejectedValue(new Error('temporary profile outage'));
    mount();
    // Include the last shared refetch's retry tail after the 12-second UI window;
    // that is when the old implementation can finally replace the whole app.
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(profileService.getById).toHaveBeenCalledWith(profile.id);
    expect(client.getQueryState(key)?.status).toBe('success');
    expect(client.getQueryState(key)?.error).toBeNull();
    expect(client.getQueryData(key)).toEqual(profile);
    expect(screen.queryByText('Profile Sync Failed')).not.toBeInTheDocument();
    expect(screen.getByText('Pro · Active')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel membership' })).toBeEnabled();
    expect(screen.getByText(/latest confirmed membership status/)).toBeVisible();
  });

  it('a successful authoritative snapshot updates the real cache and rendered membership', async () => {
    const ending = { ...profile, stripe_cancel_at_period_end: true };
    vi.mocked(profileService.getById).mockResolvedValue(ending);
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(client.getQueryData(key)).toEqual(ending);
    expect(screen.getByText('Pro · Ending')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel membership' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeEnabled();
  });

  it.each(['timeout', 'unmount'] as const)('a final rejection after %s cannot poison the shared cache', async (boundary) => {
    let reject!: (reason: Error) => void;
    vi.mocked(profileService.getById).mockReturnValue(new Promise<UserProfile>((_resolve, fail) => { reject = fail; }));
    const view = mount();
    expect(profileService.getById).toHaveBeenCalledTimes(1);
    if (boundary === 'timeout') {
      await act(async () => { await vi.advanceTimersByTimeAsync(12001); });
    } else {
      view.unmount();
    }
    await act(async () => { reject(new Error('late profile rejection')); await vi.advanceTimersByTimeAsync(20000); });
    expect(client.getQueryState(key)?.status).toBe('success');
    expect(client.getQueryState(key)?.error).toBeNull();
    expect(client.getQueryData(key)).toEqual(profile);
    expect(profileService.getById).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Pro · Active') !== null).toBe(boundary === 'timeout');
    expect(screen.queryByText('Profile Sync Failed')).not.toBeInTheDocument();
  });

  it('ordinary Account visits do not issue billing-return polls', async () => {
    mount(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(profileService.getById).not.toHaveBeenCalled();
    expect(screen.getByText('Pro · Active')).toBeVisible();
  });

  it('normal initial-profile failure still exhausts retries and shows the real guard failure screen', async () => {
    vi.mocked(profileService.getById).mockRejectedValue(new Error('initial profile unavailable'));
    mount(false, false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(client.getQueryState(key)?.status).toBe('error');
    expect(screen.getByText('Profile Sync Failed')).toBeVisible();
    expect(screen.queryByTestId('account-page')).not.toBeInTheDocument();
    expect(profileService.getById).toHaveBeenCalledTimes(4);
  });
});
