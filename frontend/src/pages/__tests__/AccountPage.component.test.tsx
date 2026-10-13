import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../tests/support/test-utils';
import AccountPage from '../AccountPage';
import { membershipPresentation } from '../membershipPresentation';
import { useUserProfile } from '@/hooks/useUserProfile';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import type { UserProfile } from '@/types/user';
import { profileService } from '@/services/domainServices';
import { useQueryClient } from '@tanstack/react-query';

vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/config/appRuntimeConfig', () => ({ arePaymentsEnabled: vi.fn() }));
vi.mock('@/services/domainServices', () => ({ profileService: { getById: vi.fn() } }));
vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: vi.fn(),
}));

const paid: UserProfile = {
  id: 'owner', subscription_status: 'pro', stripe_customer_id: 'cus_123',
  stripe_subscription_id: 'sub_123', usage_seconds: 0, usage_reset_date: '', created_at: '',
};

describe('Membership on Account', () => {
  const invoke = vi.fn();
  const setQueryData = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQueryClient).mockReturnValue({ setQueryData } as unknown as ReturnType<typeof useQueryClient>);
    vi.mocked(arePaymentsEnabled).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
    vi.mocked(useUserProfile).mockReturnValue({ data: paid, refetch: vi.fn(), isLoading: false } as unknown as ReturnType<typeof useUserProfile>);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('billing-return failures preserve confirmed membership without refetching the guarded query', async () => {
    vi.useFakeTimers();
    const refetch = vi.fn().mockResolvedValue({ error: new Error('profile unavailable') });
    vi.mocked(useUserProfile).mockReturnValue({ data: paid, refetch, isLoading: false } as unknown as ReturnType<typeof useUserProfile>);
    vi.mocked(profileService.getById).mockRejectedValue(new Error('profile unavailable'));
    render(<AccountPage />, { route: { pathname: '/account', search: '?billing=returned' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(refetch).not.toHaveBeenCalled();
    expect(profileService.getById).toHaveBeenCalledWith('owner');
    expect(setQueryData).not.toHaveBeenCalled();
    expect(screen.getByText('Pro · Active')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel membership' })).toBeEnabled();
    expect(screen.getByText(/latest confirmed membership status/)).toBeVisible();
  });

  it('accepts only an owner-matching authoritative return snapshot', async () => {
    const ending = { ...paid, stripe_cancel_at_period_end: true };
    vi.mocked(profileService.getById).mockResolvedValueOnce(ending);
    render(<AccountPage />, { route: { pathname: '/account', search: '?billing=returned' } });
    await waitFor(() => expect(setQueryData).toHaveBeenCalledWith(['userProfile', 'owner'], ending));
  });

  it('a final in-flight read cannot update the shared cache after the bounded window closes', async () => {
    vi.useFakeTimers();
    let resolve!: (value: UserProfile) => void;
    vi.mocked(profileService.getById).mockReturnValue(new Promise<UserProfile>((done) => { resolve = done; }));
    render(<AccountPage />, { route: { pathname: '/account', search: '?billing=returned' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    await act(async () => { resolve({ ...paid, stripe_cancel_at_period_end: true }); });
    expect(setQueryData).not.toHaveBeenCalled();
    expect(screen.getByText('Pro · Active')).toBeVisible();
  });

  it('rejects a different owner snapshot and ignores an in-flight response after navigation', async () => {
    vi.useFakeTimers();
    vi.mocked(profileService.getById).mockResolvedValueOnce({ ...paid, id: 'another-owner' });
    let resolve!: (value: UserProfile) => void;
    vi.mocked(profileService.getById).mockReturnValueOnce(new Promise<UserProfile>((done) => { resolve = done; }));
    const view = render(<AccountPage />, { route: { pathname: '/account', search: '?billing=returned' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(setQueryData).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => { resolve(paid); await vi.advanceTimersByTimeAsync(12000); });
    expect(setQueryData).not.toHaveBeenCalled();
    expect(profileService.getById).toHaveBeenCalledTimes(2);
  });

  it('uses only a server snapshot for ending state and never fabricates a date', () => {
    expect(membershipPresentation({ ...paid, stripe_cancel_at_period_end: true })).toEqual({
      status: 'Ending', detail: 'Cancellation is scheduled. Pro access remains active for now.',
    });
    expect(membershipPresentation({ ...paid, stripe_cancel_at_period_end: true, stripe_current_period_end: '2026-10-25T00:00:00Z' }).detail).toContain('2026');
    expect(membershipPresentation({ ...paid, stripe_cancel_at_period_end: false }).status).toBe('Active');
    expect(membershipPresentation({ ...paid, subscription_status: 'free' }).status).toBe('Free');
  });

  it('shows a direct cancellation action for a paid member and sends a scoped portal flow', async () => {
    invoke.mockResolvedValue({ data: { portalUrl: 'https://billing.stripe.com/session/test' }, error: null });
    render(<AccountPage />, { route: '/account' });
    expect(screen.getByText('Membership')).toBeVisible();
    expect(screen.getByText('Pro · Active')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel membership' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('stripe-billing-portal', { body: { flow: 'cancel' } }));
  });

  it('does not offer cancellation for Free or already ending accounts', () => {
    vi.mocked(useUserProfile).mockReturnValue({ data: { ...paid, stripe_cancel_at_period_end: true }, refetch: vi.fn() } as unknown as ReturnType<typeof useUserProfile>);
    render(<AccountPage />, { route: '/account' });
    expect(screen.queryByRole('button', { name: 'Cancel membership' })).not.toBeInTheDocument();
  });

  it('a lapsed subscriber can manage their linked billing without gaining Pro access or cancellation eligibility', async () => {
    vi.mocked(useUserProfile).mockReturnValue({ data: { ...paid, subscription_status: 'free' }, isLoading: false } as unknown as ReturnType<typeof useUserProfile>);
    invoke.mockResolvedValue({ data: { portalUrl: 'https://billing.stripe.com/session/test' }, error: null });
    render(<AccountPage />, { route: '/account' });
    expect(screen.getByText('Free · Free')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel membership' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('stripe-billing-portal', { body: { flow: 'manage' } }));
  });

  it.each(['unlinked', 'payments-disabled'] as const)('does not expose billing management when %s', (boundary) => {
    vi.mocked(arePaymentsEnabled).mockReturnValue(boundary !== 'payments-disabled');
    vi.mocked(useUserProfile).mockReturnValue({ data: {
      ...paid, subscription_status: 'free', stripe_customer_id: boundary === 'unlinked' ? null : paid.stripe_customer_id,
    }, isLoading: false } as unknown as ReturnType<typeof useUserProfile>);
    render(<AccountPage />, { route: '/account' });
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel membership' })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
