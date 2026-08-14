import { describe, expect, it } from 'vitest';
import { LAUNCH_PRICE, validateLaunchPrice } from '../../scripts/stripe-price-audit.mjs';

const price = (amount) => ({
  id: 'price_launch',
  livemode: true,
  active: true,
  currency: 'usd',
  unit_amount: amount,
  recurring: { interval: 'month', interval_count: 1 },
  product: { active: true, name: 'SpeakSharp' },
});

describe('single-product Stripe launch audit', () => {
  it('accepts exactly $10/month', () => {
    expect(LAUNCH_PRICE).toEqual({ amount: 1000, currency: 'usd', interval: 'month', intervalCount: 1 });
    expect(validateLaunchPrice(price(1000)).failures).toEqual([]);
  });

  it('rejects the retired 999-cent price', () => {
    expect(validateLaunchPrice(price(999)).failures).toContain('SpeakSharp: expected amount 1000, got 999');
  });
});
