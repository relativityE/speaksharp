import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock PostHog's runtime feature-flag surface so the runtime path is deterministic (mirrors
// privateV4Flags test convention). `isFeatureEnabled` is what the flag module reads.
const isFeatureEnabled = vi.fn<(key: string) => boolean | undefined>(() => undefined);
vi.mock('posthog-js', () => ({
  default: { isFeatureEnabled: (key: string) => isFeatureEnabled(key) },
}));
vi.mock('@/lib/logger', () => ({ default: { debug: vi.fn() } }));

import {
  isFillerRecountSsotEnabled,
  isFillerRecountSsotInternalOnly,
  getFillerRecountSsotSource,
  __setFillerRecountSsotForTests,
  FILLER_SSOT_FLAG_KEYS,
} from '../fillerSsotFlag';

// NOTE: VITE_FILLER_RECOUNT_SSOT / *_DISABLED are unset in the test env (import.meta.env), so the
// build-env branch is false here and the runtime (PostHog) path is what these cases exercise.
describe('fillerSsotFlag — runtime PostHog flag, DEFAULT OFF, byte-identical when unconfigured', () => {
  beforeEach(() => {
    __setFillerRecountSsotForTests(null);
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(undefined); // PostHog default before flags load / flag absent
  });
  afterEach(() => { __setFillerRecountSsotForTests(null); });

  it('DEFAULT OFF: no override, no env, PostHog flag absent (undefined) → false', () => {
    expect(isFillerRecountSsotEnabled()).toBe(false);
    expect(getFillerRecountSsotSource()).toBe('off');
  });

  it('PostHog flag explicitly false → OFF (byte-identical to legacy)', () => {
    isFeatureEnabled.mockImplementation((k) => (k === FILLER_SSOT_FLAG_KEYS.ENABLED ? false : undefined));
    expect(isFillerRecountSsotEnabled()).toBe(false);
    expect(getFillerRecountSsotSource()).toBe('off');
  });

  it('PostHog runtime flag ON → ON, source=posthog (canary/rollout path)', () => {
    isFeatureEnabled.mockImplementation((k) => k === FILLER_SSOT_FLAG_KEYS.ENABLED);
    expect(isFillerRecountSsotEnabled()).toBe(true);
    expect(getFillerRecountSsotSource()).toBe('posthog');
  });

  it('only reads the ENABLED key for the master decision', () => {
    isFeatureEnabled.mockImplementation((k) => k === FILLER_SSOT_FLAG_KEYS.ENABLED);
    isFillerRecountSsotEnabled();
    expect(isFeatureEnabled).toHaveBeenCalledWith(FILLER_SSOT_FLAG_KEYS.ENABLED);
  });

  it('internalOnly is an independent informational flag', () => {
    isFeatureEnabled.mockImplementation((k) => k === FILLER_SSOT_FLAG_KEYS.INTERNAL_ONLY);
    expect(isFillerRecountSsotInternalOnly()).toBe(true);
    // internal-only does not by itself turn the master switch on
    expect(isFillerRecountSsotEnabled()).toBe(false);
  });

  it('test override wins over the runtime flag (both directions)', () => {
    isFeatureEnabled.mockImplementation((k) => k === FILLER_SSOT_FLAG_KEYS.ENABLED); // runtime ON
    __setFillerRecountSsotForTests(false);
    expect(isFillerRecountSsotEnabled()).toBe(false);
    expect(getFillerRecountSsotSource()).toBe('off');

    isFeatureEnabled.mockReturnValue(undefined); // runtime OFF
    __setFillerRecountSsotForTests(true);
    expect(isFillerRecountSsotEnabled()).toBe(true);
    expect(getFillerRecountSsotSource()).toBe('test');
  });

  it('never throws: a PostHog read error resolves to OFF (safe default)', () => {
    isFeatureEnabled.mockImplementation(() => { throw new Error('posthog not ready'); });
    expect(() => isFillerRecountSsotEnabled()).not.toThrow();
    expect(isFillerRecountSsotEnabled()).toBe(false);
  });
});

// The build-env enable and the build-time HARD-KILL are read from import.meta.env. Exercise both
// branches explicitly — the kill switch in particular must be proven to actually force OFF, and to
// win over an ON runtime flag + an ON build-env enable.
describe('fillerSsotFlag — build-env enable + hard-kill switch (import.meta.env branches)', () => {
  beforeEach(() => {
    __setFillerRecountSsotForTests(null);
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(undefined);
  });
  afterEach(() => {
    __setFillerRecountSsotForTests(null);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('DEV/TEST build: build-env enable → ON (source build-env), even with the PostHog flag OFF', () => {
    // In the unit env ENV.isTest is true (setupStrictZero sets __TEST__), so this is a dev/test build.
    vi.stubEnv('VITE_FILLER_RECOUNT_SSOT', 'true');
    isFeatureEnabled.mockReturnValue(undefined); // runtime flag absent
    expect(isFillerRecountSsotEnabled()).toBe(true);
    expect(getFillerRecountSsotSource()).toBe('build-env');
  });

  it('PRODUCTION build: build-env enable is INERT — PostHog is the sole authority (rollback preserved)', () => {
    // Simulate a normal production build: NOT a dev/test build. The gate is `DEV || ENV.isTest`;
    // in vitest DEV is true AND ENV.isTest is true, so force both to production values.
    const env = import.meta.env as unknown as Record<string, unknown>;
    const g = globalThis as unknown as { __TEST__?: boolean };
    const prevDev = env.DEV;
    const prevTest = g.__TEST__;
    try {
      env.DEV = false;   // production build
      g.__TEST__ = false; // ENV.isUnit → false (and __SS_E2E__.isActive is false → isE2E false)
      vi.stubEnv('VITE_FILLER_RECOUNT_SSOT', 'true'); // would enable in dev/test — must NOT in prod

      // PostHog OFF → OFF, despite the build-env flag being 'true'. Build-env cannot bypass PostHog.
      isFeatureEnabled.mockReturnValue(undefined);
      expect(isFillerRecountSsotEnabled()).toBe(false);
      expect(getFillerRecountSsotSource()).toBe('off');

      // PostHog ON → ON, attributed to posthog. PostHog is the enablement authority in production.
      isFeatureEnabled.mockImplementation((k) => k === FILLER_SSOT_FLAG_KEYS.ENABLED);
      expect(isFillerRecountSsotEnabled()).toBe(true);
      expect(getFillerRecountSsotSource()).toBe('posthog');
    } finally {
      env.DEV = prevDev;
      g.__TEST__ = prevTest;
    }
  });

  it('HARD-KILL forces OFF and wins over BOTH an ON PostHog flag and an ON build-env enable', async () => {
    // The hard-kill is a module-level const evaluated at import, so re-import under the stubbed env.
    vi.resetModules();
    vi.stubEnv('VITE_FILLER_RECOUNT_SSOT_DISABLED', 'true'); // kill switch ON
    vi.stubEnv('VITE_FILLER_RECOUNT_SSOT', 'true');          // build-env would otherwise say ON
    isFeatureEnabled.mockReturnValue(true);                   // runtime flag would otherwise say ON
    const mod = await import('../fillerSsotFlag');
    expect(mod.isFillerRecountSsotEnabled()).toBe(false);
    expect(mod.getFillerRecountSsotSource()).toBe('hard-disabled');
  });

  it('test override still wins even over the HARD-KILL (deterministic test control)', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_FILLER_RECOUNT_SSOT_DISABLED', 'true');
    const mod = await import('../fillerSsotFlag');
    mod.__setFillerRecountSsotForTests(true);
    expect(mod.isFillerRecountSsotEnabled()).toBe(true);
    expect(mod.getFillerRecountSsotSource()).toBe('test');
    mod.__setFillerRecountSsotForTests(null);
  });
});
