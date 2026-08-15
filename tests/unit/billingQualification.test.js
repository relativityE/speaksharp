import { describe, expect, it } from 'vitest';
import { assertStripeTestMode, assertAllPhasesProven, REQUIRED_BILLING_PHASES } from '../../scripts/lib/billingQualification.mjs';

const TEST_PRICE = { livemode: false, active: true, recurring: { interval: 'month' }, unit_amount: 1000 };
const OK = { secretKey: 'sk_test_abc', accountLivemode: false, price: TEST_PRICE };

describe('billing qualification — test-mode fail-closed guard (before any Stripe object)', () => {
  it('accepts a proven test-mode config (sk_test_, livemode=false, active monthly Price)', () => {
    expect(assertStripeTestMode(OK)).toEqual({ mode: 'test', livemode: false });
  });

  it.each([
    ['a LIVE secret key', { ...OK, secretKey: 'sk_live_abc' }, 'LIVE Stripe secret key'],
    ['a non-test key', { ...OK, secretKey: 'rk_abc' }, 'TEST secret key'],
    ['a missing key', { ...OK, secretKey: undefined }, 'TEST secret key'],
    ['unproven livemode (undefined)', { ...OK, accountLivemode: undefined }, 'did not prove livemode=false'],
    ['unproven livemode (true)', { ...OK, accountLivemode: true }, 'did not prove livemode=false'],
    ['a LIVE Price object', { ...OK, price: { ...TEST_PRICE, livemode: true } }, 'a LIVE object'],
    ['an inactive Price', { ...OK, price: { ...TEST_PRICE, active: false } }, 'not active'],
    ['a non-monthly Price', { ...OK, price: { ...TEST_PRICE, recurring: { interval: 'year' } } }, 'not a monthly recurring plan'],
    ['a missing Price', { ...OK, price: null }, 'Price could not be read'],
  ])('fails closed on %s', (_label, cfg, expected) => {
    expect(() => assertStripeTestMode(cfg)).toThrow(expected);
  });
});

describe('billing qualification — required lifecycle phase evidence', () => {
  const allProven = Object.fromEntries(REQUIRED_BILLING_PHASES.map((p) => [p, true]));

  it('requires renewal, payment_failure, cancellation, and continuation among the phases', () => {
    for (const phase of ['checkout', 'webhook', 'renewal', 'payment_failure', 'cancellation', 'continuation']) {
      expect(REQUIRED_BILLING_PHASES).toContain(phase);
    }
  });

  it('passes only when EVERY phase is proven', () => {
    expect(assertAllPhasesProven(allProven).proven).toEqual([...REQUIRED_BILLING_PHASES]);
  });

  it.each(REQUIRED_BILLING_PHASES)('fails closed when the "%s" phase is unproven', (phase) => {
    const partial = { ...allProven, [phase]: false };
    expect(() => assertAllPhasesProven(partial)).toThrow(phase);
  });

  it('fails closed on an empty evidence object (never a silent pass)', () => {
    expect(() => assertAllPhasesProven({})).toThrow('unproven lifecycle phase');
  });
});
