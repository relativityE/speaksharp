import { renderHook, waitFor } from '../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCheckoutNotifications } from '../useCheckoutNotifications';
import { toast } from '@/lib/toast';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/AnalyticsBuffer', () => ({
  analyticsBuffer: {
    push: vi.fn(),
  },
}));

describe('useCheckoutNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not claim Pro entitlement from the Stripe success redirect alone', async () => {
    renderHook(() => useCheckoutNotifications(), {
      route: {
        pathname: '/session',
        search: '?checkout=success&conversion_source=pricing_pro_card&utm_source=app_cta&utm_medium=pricing&utm_campaign=upgrade',
        hash: '',
        state: null,
        key: 'success-route',
      },
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Payment received',
        expect.objectContaining({
          description: 'We are confirming your plan with Stripe. Pro unlocks after your account updates.',
        })
      );
    });
    expect(toast.success).not.toHaveBeenCalledWith(
      'Welcome to Pro!',
      expect.anything()
    );
    expect(analyticsBuffer.push).toHaveBeenCalledWith(
      'checkout_returned_success',
      expect.objectContaining({ conversion_source: 'pricing_pro_card' }),
      'HIGH'
    );
  });

  it('shows customer-safe copy for a cancelled checkout redirect', async () => {
    renderHook(() => useCheckoutNotifications(), {
      route: {
        pathname: '/pricing',
        search: '?checkout=cancelled&conversion_source=pricing_pro_card',
        hash: '',
        state: null,
        key: 'cancel-route',
      },
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Checkout cancelled',
        expect.objectContaining({
          description: 'No payment was made. You can try again anytime.',
        })
      );
    });
    expect(toast.error).not.toHaveBeenCalledWith(
      "Payment couldn't be processed",
      expect.anything()
    );
  });
});
