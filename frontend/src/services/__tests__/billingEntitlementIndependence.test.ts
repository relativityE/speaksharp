import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasPaidProEntitlement } from '@/constants/subscriptionTiers';
import * as runtimeConfig from '@/config/appRuntimeConfig';

const paidProfile = { subscription_status: 'pro', stripe_subscription_id: 'sub_live_123' };
const uncertainProfile = { subscription_status: 'pro', stripe_subscription_id: null };

afterEach(() => vi.restoreAllMocks());

describe('paid continuity is independent of new-enrollment availability', () => {
  it('retains verified paid identity while new checkout is disabled', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false);
    expect(hasPaidProEntitlement(paidProfile)).toBe(true);
  });

  it('does not trust a bare paid label without Stripe identity', () => {
    expect(hasPaidProEntitlement(uncertainProfile)).toBe(false);
  });

  it('produces the same paid-identity result on both sides of the enrollment switch', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false);
    const disabled = hasPaidProEntitlement(paidProfile);
    vi.restoreAllMocks();
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(true);
    expect(hasPaidProEntitlement(paidProfile)).toBe(disabled);
  });
});
