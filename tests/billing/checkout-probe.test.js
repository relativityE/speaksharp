import { describe, it, expect, vi } from 'vitest';
import {
  classifyCheckoutProbe,
  probeCheckoutClosed,
  redactSnippet,
  CHECKOUT_PROBE,
} from '../../scripts/lib/checkout-probe.mjs';

const ANON = 'anon_key_SECRET_value_should_never_appear';
const res = (status, body = '') => ({ status, text: async () => body });
const PAYMENTS_DISABLED_BODY = '{"error":{"code":"payments_disabled","message":"Pro enrollment is not open during this beta."}}';
const CHECKOUT_URL_BODY = '{"checkoutUrl":"https://checkout.stripe.com/c/pay/cs_test_123"}';

describe('classifyCheckoutProbe — FAIL CLOSED (only confirmed 403 payments_disabled passes)', () => {
  it('403 + payments_disabled → CLOSED', () => {
    expect(classifyCheckoutProbe({ status: 403, bodySnippet: PAYMENTS_DISABLED_BODY })).toBe(CHECKOUT_PROBE.CLOSED);
  });
  it('200 + checkoutUrl → OPEN', () => {
    expect(classifyCheckoutProbe({ status: 200, bodySnippet: CHECKOUT_URL_BODY })).toBe(CHECKOUT_PROBE.OPEN);
  });
  it('401 → UNCONFIRMED (fail closed)', () => {
    expect(classifyCheckoutProbe({ status: 401, bodySnippet: 'Missing authorization header' })).toBe(CHECKOUT_PROBE.UNCONFIRMED);
  });
  it('404 → UNCONFIRMED (fail closed)', () => {
    expect(classifyCheckoutProbe({ status: 404, bodySnippet: 'not found' })).toBe(CHECKOUT_PROBE.UNCONFIRMED);
  });
  it('429 → UNCONFIRMED (fail closed)', () => {
    expect(classifyCheckoutProbe({ status: 429, bodySnippet: 'rate limited' })).toBe(CHECKOUT_PROBE.UNCONFIRMED);
  });
  it('500 → UNCONFIRMED (fail closed)', () => {
    expect(classifyCheckoutProbe({ status: 500, bodySnippet: 'internal error' })).toBe(CHECKOUT_PROBE.UNCONFIRMED);
  });
  it('403 WITHOUT payments_disabled (a real permission failure) → UNCONFIRMED, not CLOSED', () => {
    expect(classifyCheckoutProbe({ status: 403, bodySnippet: 'Forbidden' })).toBe(CHECKOUT_PROBE.UNCONFIRMED);
  });
  it('2xx WITHOUT a checkout URL → UNCONFIRMED (not silently OK)', () => {
    expect(classifyCheckoutProbe({ status: 204, bodySnippet: '' })).toBe(CHECKOUT_PROBE.UNCONFIRMED);
  });
  it('network error → ERROR (fail closed)', () => {
    expect(classifyCheckoutProbe({ networkError: new Error('ECONNRESET') })).toBe(CHECKOUT_PROBE.ERROR);
  });
  it('non-numeric status (no response) → ERROR', () => {
    expect(classifyCheckoutProbe({ status: null, bodySnippet: '' })).toBe(CHECKOUT_PROBE.ERROR);
  });
});

describe('probeCheckoutClosed', () => {
  it('missing config → NOT_RUNNABLE (the script exits 2, never passes)', async () => {
    expect((await probeCheckoutClosed({})).classification).toBe(CHECKOUT_PROBE.NOT_RUNNABLE);
    expect((await probeCheckoutClosed({ baseUrl: 'https://x.supabase.co' })).classification).toBe(CHECKOUT_PROBE.NOT_RUNNABLE);
    expect((await probeCheckoutClosed({ anonKey: ANON })).classification).toBe(CHECKOUT_PROBE.NOT_RUNNABLE);
  });

  it('sends BOTH apikey and Authorization: Bearer <anon> (no user token); returns CLOSED without leaking the token', async () => {
    let captured;
    const fetchImpl = vi.fn(async (_url, init) => {
      captured = init;
      return res(403, PAYMENTS_DISABLED_BODY);
    });
    const r = await probeCheckoutClosed({ baseUrl: 'https://x.supabase.co', anonKey: ANON, fetchImpl });
    expect(r.classification).toBe(CHECKOUT_PROBE.CLOSED);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(captured.method).toBe('POST');
    expect(captured.headers.apikey).toBe(ANON);
    expect(captured.headers.Authorization).toBe(`Bearer ${ANON}`);
    // The returned/report object must NOT contain the anon key or the Authorization header.
    expect(JSON.stringify(r)).not.toContain(ANON);
    expect(JSON.stringify(r).toLowerCase()).not.toContain('authorization');
  });

  it('200 checkoutUrl → OPEN', async () => {
    const fetchImpl = async () => res(200, CHECKOUT_URL_BODY);
    expect((await probeCheckoutClosed({ baseUrl: 'https://x.supabase.co', anonKey: ANON, fetchImpl })).classification).toBe(CHECKOUT_PROBE.OPEN);
  });

  it('fetch throws → ERROR', async () => {
    const fetchImpl = async () => { throw new Error('boom'); };
    expect((await probeCheckoutClosed({ baseUrl: 'https://x.supabase.co', anonKey: ANON, fetchImpl })).classification).toBe(CHECKOUT_PROBE.ERROR);
  });

  it('redacts secrets/JWTs from the recorded body snippet — no secret leakage', async () => {
    const leaky = 'sk_live_ABCDEF123 and pk_live_ZZZ and token eyJhbGciOi.payload.sig';
    const fetchImpl = async () => res(500, leaky);
    const r = await probeCheckoutClosed({ baseUrl: 'https://x.supabase.co', anonKey: ANON, fetchImpl });
    expect(r.bodySnippet).not.toContain('sk_live_ABCDEF123');
    expect(r.bodySnippet).not.toContain('pk_live_ZZZ');
    expect(r.bodySnippet).not.toContain('eyJhbGciOi');
    expect(r.bodySnippet).toContain('[redacted]');
  });
});

describe('redactSnippet', () => {
  it('strips sk_/pk_ secrets and JWTs and caps length', () => {
    const out = redactSnippet('sk_live_XXX pk_live_YYY eyJZZZ.a.b ' + 'x'.repeat(500));
    expect(out).not.toMatch(/sk_live_XXX|pk_live_YYY|eyJZZZ/);
    expect(out.length).toBeLessThanOrEqual(201);
  });
});
