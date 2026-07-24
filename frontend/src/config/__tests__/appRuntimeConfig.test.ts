import { describe, it, expect } from 'vitest';
import { arePaymentsEnabledFor, paymentsEnabled, classifyStripeKey, computeAppRuntimeConfig, pickPersistedRuntimeConfig, type AppModeMeta, type AppRuntimeConfig } from '../appRuntimeConfig';

const MANUAL: AppModeMeta = { viteMode: 'development', port: 5174, authMode: 'real', releaseProofEligible: true };
const TEST_MODE: AppModeMeta = { viteMode: 'test', port: 5173, authMode: 'mock', releaseProofEligible: false };

// A correct manual release environment.
const okManual = {
  supabaseUrl: 'https://abcd.supabase.co',
  envAuthMode: 'real',
  useMockAuthEnv: false,
  actualPort: 5174,
  url: 'http://localhost:5174/session',
};

describe('computeAppRuntimeConfig — STT release-proof eligibility (config discipline)', () => {
  it('manual mode on 5174 with real auth + real Supabase → ELIGIBLE', () => {
    const cfg = computeAppRuntimeConfig({ meta: MANUAL, ...okManual });
    expect(cfg.releaseProofEligible).toBe(true);
    expect(cfg.mockAuth).toBe(false);
    expect(cfg.port).toBe(5174);
    expect(cfg.authMode).toBe('real');
  });

  it('test mode (5173 / mock) → NOT eligible', () => {
    const cfg = computeAppRuntimeConfig({
      meta: TEST_MODE, supabaseUrl: 'http://localhost', envAuthMode: 'mock',
      useMockAuthEnv: true, actualPort: 5173, url: 'http://localhost:5173/session',
    });
    expect(cfg.releaseProofEligible).toBe(false);
    expect(cfg.mockAuth).toBe(true);
  });

  it('manual mode but MOCK auth → NOT eligible', () => {
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual, envAuthMode: 'mock' }).releaseProofEligible).toBe(false);
  });

  it('manual mode but wrong port (5173) → NOT eligible', () => {
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual, actualPort: 5173 }).releaseProofEligible).toBe(false);
  });

  it('manual mode but mock Supabase host → mockAuth inferred, NOT eligible', () => {
    const cfg = computeAppRuntimeConfig({ meta: MANUAL, ...okManual, supabaseUrl: 'https://mock.supabase.co' });
    expect(cfg.mockAuth).toBe(true);
    expect(cfg.releaseProofEligible).toBe(false);
  });

  it('manual mode but non-Supabase URL → NOT eligible', () => {
    const cfg = computeAppRuntimeConfig({ meta: MANUAL, ...okManual, supabaseUrl: 'http://localhost:54321' });
    expect(cfg.mockAuth).toBe(true);
    expect(cfg.releaseProofEligible).toBe(false);
  });

  it('manual mode but VITE_USE_MOCK_AUTH=true → NOT eligible', () => {
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual, useMockAuthEnv: true }).releaseProofEligible).toBe(false);
  });

  it('surfaces stripeKeyClass for production runtime proof', () => {
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual, stripeKey: 'pk_live_abc' }).stripeKeyClass).toBe('live');
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual, stripeKey: 'pk_test_abc' }).stripeKeyClass).toBe('test');
    // No stripeKey provided → fail-closed "missing" (the neutralized .env.production case).
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual }).stripeKeyClass).toBe('missing');
  });

  it('surfaces the release id (commit SHA) for production proof, defaulting to "unknown"', () => {
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual, release: 'abc1234' }).release).toBe('abc1234');
    // Unset/blank → "unknown" so the field is always present and never empty.
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual }).release).toBe('unknown');
    expect(computeAppRuntimeConfig({ meta: MANUAL, ...okManual, release: '   ' }).release).toBe('unknown');
  });
});

describe('classifyStripeKey', () => {
  it('classifies live, test, missing, and unknown key shapes', () => {
    expect(classifyStripeKey('pk_live_51Abc')).toBe('live');
    expect(classifyStripeKey('pk_test_51Abc')).toBe('test');
    expect(classifyStripeKey('')).toBe('missing');
    expect(classifyStripeKey('   ')).toBe('missing');
    expect(classifyStripeKey(undefined)).toBe('missing');
    expect(classifyStripeKey(null)).toBe('missing');
    expect(classifyStripeKey('sk_live_should_never_be_here')).toBe('unknown');
    expect(classifyStripeKey('garbage')).toBe('unknown');
  });
});

describe('arePaymentsEnabledFor (fail-closed to LIVE)', () => {
  it('enables public payment surfaces ONLY for a live key', () => {
    expect(arePaymentsEnabledFor('pk_live_51Abc')).toBe(true);
  });
  it('hides payment surfaces for test/unknown/missing key classes', () => {
    expect(arePaymentsEnabledFor('pk_test_51Abc')).toBe(false); // test-mode checkout must not show publicly
    expect(arePaymentsEnabledFor('garbage')).toBe(false);       // unknown
    expect(arePaymentsEnabledFor('')).toBe(false);
    expect(arePaymentsEnabledFor('   ')).toBe(false);
    expect(arePaymentsEnabledFor(undefined)).toBe(false);
    expect(arePaymentsEnabledFor(null)).toBe(false);
  });
});

describe('paymentsEnabled (fail-closed beta: explicit flag AND live key)', () => {
  it('is enabled ONLY when explicitly enabled AND the key is live', () => {
    expect(paymentsEnabled(true, 'pk_live_51Abc')).toBe(true);
  });
  it('a live key alone does NOT enable payments without the explicit flag', () => {
    // This is the core P0.1 guarantee: a stray live publishable key in prod must fail closed.
    expect(paymentsEnabled(false, 'pk_live_51Abc')).toBe(false);
  });
  it('the explicit flag alone does NOT enable payments without a live key', () => {
    expect(paymentsEnabled(true, 'pk_test_51Abc')).toBe(false);
    expect(paymentsEnabled(true, 'garbage')).toBe(false);
    expect(paymentsEnabled(true, '')).toBe(false);
    expect(paymentsEnabled(true, undefined)).toBe(false);
    expect(paymentsEnabled(true, null)).toBe(false);
  });
  it('both off is disabled', () => {
    expect(paymentsEnabled(false, undefined)).toBe(false);
    expect(paymentsEnabled(false, 'pk_test_51Abc')).toBe(false);
  });
});

describe('pickPersistedRuntimeConfig — persistence allowlist (no URL-bearing fields)', () => {
  // A full runtime config whose `url` carries a session UUID, an email, a token, a query and a fragment.
  const leaky: AppRuntimeConfig = {
    url: 'https://app.example.com/analytics/7e7aca2c-c192-4a80-8976-df5637859164?email=user@example.com&token=tok_live_ABC#frag-secret',
    port: 5174,
    viteMode: 'production',
    authMode: 'real',
    mockAuth: false,
    supabaseUrl: 'https://yxlapjuovrsvjswkwnrk.supabase.co',
    releaseProofEligible: true,
    stripeKeyClass: 'live',
    release: 'c99208b917f5bb4223e8c40109ec4887e08abaef',
  };

  it('keeps ONLY the allowlisted non-URL runtime facts', () => {
    expect(pickPersistedRuntimeConfig(leaky)).toEqual({
      viteMode: 'production',
      authMode: 'real',
      mockAuth: false,
      stripeKeyClass: 'live',
      releaseProofEligible: true,
      release: 'c99208b917f5bb4223e8c40109ec4887e08abaef',
    });
  });

  it('drops every URL-bearing / environment-locating field', () => {
    const picked = pickPersistedRuntimeConfig(leaky)!;
    expect(picked).not.toHaveProperty('url');
    expect(picked).not.toHaveProperty('port');
    expect(picked).not.toHaveProperty('supabaseUrl');
  });

  it('the serialized result contains no id / email / token / query / fragment from the raw url', () => {
    const json = JSON.stringify(pickPersistedRuntimeConfig(leaky));
    for (const secret of ['7e7aca2c-c192-4a80-8976-df5637859164', 'user@example.com', 'tok_live_ABC', 'frag-secret', 'supabase.co']) {
      expect(json).not.toContain(secret);
    }
  });

  it('returns undefined when no runtime config is present (SSR / pre-publish)', () => {
    expect(pickPersistedRuntimeConfig(undefined)).toBeUndefined();
    expect(pickPersistedRuntimeConfig(null)).toBeUndefined();
  });
});
