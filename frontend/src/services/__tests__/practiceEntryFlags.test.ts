import { describe, it, expect, vi, beforeEach } from 'vitest';
import posthog from 'posthog-js';
import {
  isSafeInternalPath, safeDeepLink, isPracticeEntryEnabled,
  resolveAuthedFlag, resolveAuthedDefaultPath,
} from '@/services/practiceEntryFlags';

vi.mock('posthog-js', () => ({ default: { isFeatureEnabled: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const flag = vi.mocked(posthog.isFeatureEnabled);

/** Minimal fake PostHog client for the authed-flag resolver (identity + onFeatureFlags surface). */
function fakeClient({ distinctId }: { distinctId: () => string | undefined }) {
  let cb: (() => void) | null = null;
  return {
    get_distinct_id: distinctId,
    onFeatureFlags: (fn: () => void) => { cb = fn; return () => { cb = null; }; },
    fire: () => cb?.(),
  };
}

describe('practiceEntryFlags — open-redirect guard', () => {
  it('accepts only in-app absolute paths', () => {
    expect(isSafeInternalPath('/session')).toBe(true);
    expect(isSafeInternalPath('/analytics/abc')).toBe(true);
  });
  it('rejects external / protocol-relative / scheme / empty paths', () => {
    for (const bad of ['//evil.com', 'http://evil.com', 'https://x', 'javascript:alert(1)', '/\\evil.com', 'relative', '', undefined, null]) {
      expect(isSafeInternalPath(bad as string)).toBe(false);
    }
  });
  it('safeDeepLink returns a joined path for safe `from`, null otherwise', () => {
    expect(safeDeepLink({ pathname: '/analytics/xyz', search: '?tab=1' })).toBe('/analytics/xyz?tab=1');
    expect(safeDeepLink({ pathname: 'https://evil.com' })).toBeNull();
    expect(safeDeepLink(null)).toBeNull();
  });
});

describe('practiceEntryFlags — flag reader (fail-OFF)', () => {
  beforeEach(() => flag.mockReset());
  it('is ON only when PostHog returns exactly true; fails OFF otherwise (false / not-loaded undefined)', () => {
    flag.mockReturnValue(true); expect(isPracticeEntryEnabled()).toBe(true);
    flag.mockReturnValue(false); expect(isPracticeEntryEnabled()).toBe(false);
    flag.mockReturnValue(undefined); expect(isPracticeEntryEnabled()).toBe(false); // flags not loaded yet
  });

  // RESTORED failure-path test (one-shot mock — a persistent throwing mockImplementation interferes with
  // Vitest's module/mock lifecycle; mockImplementationOnce throws for exactly this invocation).
  it('fails OFF when the PostHog flag reader throws', () => {
    flag.mockImplementationOnce(() => {
      throw new Error('flag transport unavailable');
    });
    expect(isPracticeEntryEnabled()).toBe(false);
    expect(flag).toHaveBeenCalledTimes(1);
  });
});

describe('practiceEntryFlags — resolveAuthedFlag (identity-correct, bounded)', () => {
  beforeEach(() => flag.mockReset());

  it('resolves the flag once the authed identity is confirmed (targeted → true)', async () => {
    flag.mockReturnValue(true);
    const client = fakeClient({ distinctId: () => 'user-1' });
    await expect(resolveAuthedFlag('user-1', { client, timeoutMs: 200 })).resolves.toBe(true);
  });

  it('resolves false for a non-targeted authed user', async () => {
    flag.mockReturnValue(false);
    const client = fakeClient({ distinctId: () => 'user-1' });
    await expect(resolveAuthedFlag('user-1', { client, timeoutMs: 200 })).resolves.toBe(false);
  });

  it('does NOT trust the flag while PostHog still carries the prior anonymous identity — times out to false', async () => {
    flag.mockReturnValue(true); // would be ON, but identity never matches, so it must not be trusted
    const client = fakeClient({ distinctId: () => 'anon-xyz' });
    await expect(resolveAuthedFlag('user-1', { client, timeoutMs: 30 })).resolves.toBe(false);
    expect(flag).not.toHaveBeenCalled(); // never trusted the anonymous-identity flags
  });

  it('waits for the post-identify onFeatureFlags load, then resolves for the authed identity', async () => {
    flag.mockReturnValue(true);
    let id = 'anon';
    const client = fakeClient({ distinctId: () => id });
    const p = resolveAuthedFlag('user-1', { client, timeoutMs: 500 });
    // Re-identify to the authed user, then fire the flag-load callback.
    id = 'user-1';
    client.fire();
    await expect(p).resolves.toBe(true);
  });

  it('resolves false with no userId (SSR / not yet identified)', async () => {
    const client = fakeClient({ distinctId: () => undefined });
    await expect(resolveAuthedFlag(null, { client, timeoutMs: 30 })).resolves.toBe(false);
  });
});

describe('practiceEntryFlags — resolveAuthedDefaultPath', () => {
  beforeEach(() => flag.mockReset());

  it('honors a valid protected deep-link IMMEDIATELY, regardless of flag/identity', async () => {
    const client = fakeClient({ distinctId: () => 'anon' }); // identity not authed — must not matter
    await expect(resolveAuthedDefaultPath('user-1', { pathname: '/analytics/xyz', search: '?t=1' }, { client, timeoutMs: 30 }))
      .resolves.toBe('/analytics/xyz?t=1');
  });

  it('targeted authed user with no deep-link → /practice', async () => {
    flag.mockReturnValue(true);
    const client = fakeClient({ distinctId: () => 'user-1' });
    await expect(resolveAuthedDefaultPath('user-1', null, { client, timeoutMs: 200 })).resolves.toBe('/practice');
  });

  it('non-targeted authed user → /session (rollback path)', async () => {
    flag.mockReturnValue(false);
    const client = fakeClient({ distinctId: () => 'user-1' });
    await expect(resolveAuthedDefaultPath('user-1', null, { client, timeoutMs: 200 })).resolves.toBe('/session');
  });

  it('timeout / identity-not-confirmed → /session', async () => {
    flag.mockReturnValue(true);
    const client = fakeClient({ distinctId: () => 'anon' });
    await expect(resolveAuthedDefaultPath('user-1', null, { client, timeoutMs: 30 })).resolves.toBe('/session');
  });

  it('rejects an unsafe/external `from` and falls back to the authed default', async () => {
    flag.mockReturnValue(false);
    const client = fakeClient({ distinctId: () => 'user-1' });
    await expect(resolveAuthedDefaultPath('user-1', { pathname: '//evil.com' }, { client, timeoutMs: 200 })).resolves.toBe('/session');
  });
});
