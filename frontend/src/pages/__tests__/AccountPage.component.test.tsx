import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../tests/support/test-utils';
import AccountPage from '../AccountPage';
import { membershipPresentation } from '../membershipPresentation';
import { useUserProfile } from '@/hooks/useUserProfile';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import type { UserProfile } from '@/types/user';

vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/config/appRuntimeConfig', () => ({ arePaymentsEnabled: vi.fn() }));

const paid: UserProfile = {
  id: 'owner', subscription_status: 'pro', stripe_customer_id: 'cus_123',
  stripe_subscription_id: 'sub_123', usage_seconds: 0, usage_reset_date: '', created_at: '',
};

describe('Membership on Account', () => {
  const invoke = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(arePaymentsEnabled).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
    vi.mocked(useUserProfile).mockReturnValue({ data: paid, refetch: vi.fn(), isLoading: false } as unknown as ReturnType<typeof useUserProfile>);
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
});
