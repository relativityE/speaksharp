import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  assertStripeTestMode, assertAllPhasesProven, REQUIRED_BILLING_PHASES,
  encodeStripeForm, signStripeWebhook, runBillingLifecycle, pollUntil,
} from '../../scripts/lib/billingQualification.mjs';

const TEST_PRICE = { livemode: false, active: true, recurring: { interval: 'month' }, unit_amount: 1000 };
const OK = { secretKey: 'sk_test_abc', accountLivemode: false, price: TEST_PRICE };

describe('billing qualification — test-mode fail-closed guard (before any Stripe object)', () => {
  it('accepts a proven test-mode config', () => {
    expect(assertStripeTestMode(OK)).toEqual({ mode: 'test', livemode: false });
  });
  it.each([
    ['a LIVE secret key', { ...OK, secretKey: 'sk_live_abc' }, 'LIVE Stripe secret key'],
    ['a non-test key', { ...OK, secretKey: 'rk_abc' }, 'TEST secret key'],
    ['unproven livemode', { ...OK, accountLivemode: undefined }, 'did not prove livemode=false'],
    ['a LIVE Price', { ...OK, price: { ...TEST_PRICE, livemode: true } }, 'a LIVE object'],
    ['a non-monthly Price', { ...OK, price: { ...TEST_PRICE, recurring: { interval: 'year' } } }, 'not a monthly recurring plan'],
  ])('fails closed on %s', (_l, cfg, expected) => { expect(() => assertStripeTestMode(cfg)).toThrow(expected); });
});

describe('billing qualification — Stripe form encoding (the fixed nested-array defect)', () => {
  it('encodes an array of objects as items[0][price] (NOT [object Object])', () => {
    const encoded = encodeStripeForm({ customer: 'cus_1', items: [{ price: 'price_1' }], expand: ['latest_invoice'] });
    expect(encoded).toContain('items%5B0%5D%5Bprice%5D=price_1'); // items[0][price]=price_1
    expect(encoded).toContain('expand%5B0%5D=latest_invoice');    // expand[0]=latest_invoice
    expect(encoded).toContain('customer=cus_1');
    expect(encoded).not.toContain('object%20Object');
  });
  it('encodes nested objects as invoice_settings[default_payment_method]', () => {
    expect(encodeStripeForm({ invoice_settings: { default_payment_method: 'pm_x' } }))
      .toBe('invoice_settings%5Bdefault_payment_method%5D=pm_x');
  });
  it('drops null/undefined and encodes scalars', () => {
    expect(encodeStripeForm({ a: 1, b: null, c: undefined, d: 'z' })).toBe('a=1&d=z');
  });
});

describe('billing qualification — webhook signature', () => {
  it('produces the Stripe t=…,v1=hmac header', () => {
    const sig = signStripeWebhook('whsec_test', '{"x":1}', createHmac, 1700);
    expect(sig).toMatch(/^t=1700,v1=[0-9a-f]{64}$/);
    const expected = createHmac('sha256', 'whsec_test').update('1700.{"x":1}', 'utf8').digest('hex');
    expect(sig).toBe(`t=1700,v1=${expected}`);
  });
});

describe('billing qualification — pollUntil fails closed on timeout', () => {
  it('throws with the onTimeout message when the predicate never holds', async () => {
    await expect(pollUntil(async () => ({ status: 'advancing' }), (c) => c.status === 'ready', { attempts: 3, sleep: async () => {}, onTimeout: () => 'never ready' }))
      .rejects.toThrow('never ready');
  });
});

// ── Mock-driven integration: assert exact Stripe request shapes + ORDERING against the injectable core. ──
function makeIo({ subGets = ['active', 'past_due'], clockReadyAfter = 0, failAt = null } = {}) {
  const calls = [];
  let subGetIdx = 0, clockGetIdx = 0, cancelWebhookPosted = false;
  const webhooks = [];
  const stripe = async (method, path, body) => {
    calls.push({ method, path, body });
    if (failAt && `${method} ${path}` === failAt) throw new Error('injected stripe failure');
    if (method === 'POST' && path === 'test_helpers/test_clocks') return { id: 'clock1', status: 'advancing' };
    if (method === 'POST' && path === 'customers') return { id: 'cus1' };
    if (method === 'POST' && path === 'subscriptions') return { id: 'sub1', status: 'active', latest_invoice: { status: 'paid' } };
    if (method === 'GET' && path === 'test_helpers/test_clocks/clock1') { clockGetIdx += 1; return { id: 'clock1', status: clockGetIdx > clockReadyAfter ? 'ready' : 'advancing' }; }
    if (method === 'GET' && path === 'subscriptions/sub1') { const s = subGets[Math.min(subGetIdx, subGets.length - 1)]; subGetIdx += 1; return { id: 'sub1', status: s }; }
    if (method === 'DELETE' && path === 'subscriptions/sub1') return { id: 'sub1', status: 'canceled' };
    return {}; // attaches, customer updates, advances, clock delete
  };
  const postWebhook = async (type) => { webhooks.push(type); if (type === 'customer.subscription.deleted') cancelWebhookPosted = true; return { ok: true }; };
  const readProfile = async () => (cancelWebhookPosted ? { subscription_status: 'free' } : { subscription_status: 'pro', stripe_subscription_id: 'sub1' });
  const io = { stripe, postWebhook, readProfile, sleep: async () => {}, nowSec: () => 1000 };
  const cfg = { priceId: 'price_test', testPmOk: 'pm_card_visa', testPmFail: 'pm_card_chargeCustomerFail' };
  return { io, cfg, calls, webhooks };
}
const idx = (calls, method, path) => calls.findIndex((c) => c.method === method && c.path === path);

describe('billing qualification — full lifecycle (mock-driven)', () => {
  it('proves every phase and returns PASSED', async () => {
    const { io, cfg } = makeIo();
    const res = await runBillingLifecycle(io, cfg);
    expect(res.result).toBe('PASSED');
    expect(res.phases).toEqual([...REQUIRED_BILLING_PHASES]);
  });

  it('creates the subscription with items as an array of {price} objects (encodable to items[0][price])', async () => {
    const { io, cfg, calls } = makeIo();
    await runBillingLifecycle(io, cfg);
    const sub = calls.find((c) => c.method === 'POST' && c.path === 'subscriptions');
    expect(sub.body.items).toEqual([{ price: 'price_test' }]);
    expect(encodeStripeForm(sub.body)).toContain('items%5B0%5D%5Bprice%5D=price_test');
  });

  it('polls the test clock to READY before reading renewal state, in the correct order', async () => {
    const { io, cfg, calls } = makeIo();
    await runBillingLifecycle(io, cfg);
    // clock created → customer → subscription, in order
    expect(idx(calls, 'POST', 'test_helpers/test_clocks')).toBeLessThan(idx(calls, 'POST', 'customers'));
    expect(idx(calls, 'POST', 'customers')).toBeLessThan(idx(calls, 'POST', 'subscriptions'));
    // advance happens, THEN the clock is polled (GET), THEN the renewal subscription read
    const advance = idx(calls, 'POST', 'test_helpers/test_clocks/clock1/advance');
    const clockGet = idx(calls, 'GET', 'test_helpers/test_clocks/clock1');
    const subGet = idx(calls, 'GET', 'subscriptions/sub1');
    expect(advance).toBeLessThan(clockGet);
    expect(clockGet).toBeLessThan(subGet);
  });

  it('proves entitlement via a signed webhook + profile poll (webhook & continuation phases)', async () => {
    const { io, cfg, webhooks } = makeIo();
    await runBillingLifecycle(io, cfg);
    expect(webhooks).toContain('customer.subscription.updated'); // grants paid → polled to pro
    expect(webhooks).toContain('customer.subscription.deleted'); // cancellation → polled away from pro
  });

  it('runs test-clock cleanup in finally EVEN when a mid-lifecycle phase throws', async () => {
    const { io, cfg, calls } = makeIo({ failAt: 'POST subscriptions' }); // fail at checkout, after the clock exists
    await expect(runBillingLifecycle(io, cfg)).rejects.toThrow();
    expect(idx(calls, 'DELETE', 'test_helpers/test_clocks/clock1')).toBeGreaterThanOrEqual(0); // cleanup still ran
  });

  it('fails closed if the test clock never reaches ready', async () => {
    const { io, cfg } = makeIo({ clockReadyAfter: 999 });
    await expect(runBillingLifecycle(io, cfg)).rejects.toThrow('did not reach ready');
  });
});

describe('billing qualification — phase completeness', () => {
  const all = Object.fromEntries(REQUIRED_BILLING_PHASES.map((p) => [p, true]));
  it('requires renewal, payment_failure, cancellation, continuation', () => {
    for (const p of ['renewal', 'payment_failure', 'cancellation', 'continuation']) expect(REQUIRED_BILLING_PHASES).toContain(p);
  });
  it.each(REQUIRED_BILLING_PHASES)('fails closed when "%s" is unproven', (phase) => {
    expect(() => assertAllPhasesProven({ ...all, [phase]: false })).toThrow(phase);
  });
});
