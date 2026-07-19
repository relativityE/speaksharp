import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasPaidProEntitlement, hasCloudSttEntitlement, hasActivePrivateSample } from '@/constants/subscriptionTiers';
import * as runtimeConfig from '@/config/appRuntimeConfig';

// P0.1 regression — PROVING (not inferring) that fail-closed beta billing does NOT touch entitlement.
// The billing kill-switch (arePaymentsEnabled) gates only the checkout UI/endpoint. Cloud/Pro
// entitlement is derived purely from the user's profile (Stripe subscription evidence) and must remain
// correct whether payments are enabled or disabled. These functions do not import arePaymentsEnabled;
// the tests below assert the behavior explicitly so a future change cannot silently couple them.

const proProfile = { subscription_status: 'pro', stripe_subscription_id: 'sub_live_123' };
const proWithoutStripe = { subscription_status: 'pro', stripe_subscription_id: null };
const freeProfile = { subscription_status: 'free', stripe_subscription_id: null };

afterEach(() => vi.restoreAllMocks());

describe('P0.1 — entitlement is independent of the billing kill-switch', () => {
  it('existing paid Pro retains Cloud entitlement even when payments are DISABLED', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false); // no-billing beta
    expect(hasPaidProEntitlement(proProfile)).toBe(true);
    expect(hasCloudSttEntitlement(proProfile)).toBe(true); // Cloud still works for existing Pro
  });

  it('a free beta user has NO Cloud entitlement, payments disabled or enabled', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false);
    expect(hasCloudSttEntitlement(freeProfile)).toBe(false);
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(true);
    expect(hasCloudSttEntitlement(freeProfile)).toBe(false); // enabling payments does NOT grant Cloud
  });

  it('a stale "pro" status without Stripe evidence is NOT Cloud-entitled (no bare-status trust)', () => {
    expect(hasPaidProEntitlement(proWithoutStripe)).toBe(false);
    expect(hasCloudSttEntitlement(proWithoutStripe)).toBe(false);
  });

  it('entitlement result is identical across payments-disabled and payments-enabled (pure w.r.t. billing)', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false);
    const disabled = [hasCloudSttEntitlement(proProfile), hasCloudSttEntitlement(freeProfile)];
    vi.restoreAllMocks();
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(true);
    const enabled = [hasCloudSttEntitlement(proProfile), hasCloudSttEntitlement(freeProfile)];
    expect(disabled).toEqual(enabled);
    expect(disabled).toEqual([true, false]);
  });
});

describe('P0.1 — Private sample availability is independent of the billing kill-switch', () => {
  const availableSample = { private_sample_available: true, private_sample_seconds_remaining: 120 };
  const exhaustedBySeconds = { private_sample_available: true, private_sample_seconds_remaining: 0 };
  const exhaustedByFlag = { private_sample_available: false, private_sample_seconds_remaining: 120 };

  it('an available sample remains available with payments DISABLED', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false);
    expect(hasActivePrivateSample(availableSample)).toBe(true);
  });

  it('an exhausted sample remains denied (no seconds, or server marks unavailable)', () => {
    expect(hasActivePrivateSample(exhaustedBySeconds)).toBe(false);
    expect(hasActivePrivateSample(exhaustedByFlag)).toBe(false);
    expect(hasActivePrivateSample(null)).toBe(false);
    expect(hasActivePrivateSample(undefined)).toBe(false);
  });

  it('enabling payments does not change sample availability/consumption state', () => {
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(false);
    const whenDisabled = [hasActivePrivateSample(availableSample), hasActivePrivateSample(exhaustedBySeconds)];
    vi.restoreAllMocks();
    vi.spyOn(runtimeConfig, 'arePaymentsEnabled').mockReturnValue(true);
    const whenEnabled = [hasActivePrivateSample(availableSample), hasActivePrivateSample(exhaustedBySeconds)];
    expect(whenDisabled).toEqual(whenEnabled);
    expect(whenDisabled).toEqual([true, false]);
  });
});
