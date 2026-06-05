import { describe, it, expect } from 'vitest';
import { classifyStripeKey, computeAppRuntimeConfig, type AppModeMeta } from '../appRuntimeConfig';

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
