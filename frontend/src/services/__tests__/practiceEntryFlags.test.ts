import { describe, it, expect, vi, beforeEach } from 'vitest';
import posthog from 'posthog-js';
import { isSafeInternalPath, resolvePostAuthPath, isPracticeEntryEnabled } from '@/services/practiceEntryFlags';

vi.mock('posthog-js', () => ({ default: { isFeatureEnabled: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const flag = vi.mocked(posthog.isFeatureEnabled);

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
});

describe('practiceEntryFlags — flag reader (fail-OFF)', () => {
  beforeEach(() => flag.mockReset());
  it('is ON only when PostHog returns exactly true; fails OFF otherwise (false / not-loaded undefined)', () => {
    flag.mockReturnValue(true); expect(isPracticeEntryEnabled()).toBe(true);
    flag.mockReturnValue(false); expect(isPracticeEntryEnabled()).toBe(false);
    flag.mockReturnValue(undefined); expect(isPracticeEntryEnabled()).toBe(false); // flags not loaded yet
  });
});

describe('practiceEntryFlags — resolvePostAuthPath', () => {
  beforeEach(() => flag.mockReset());
  it('honors a valid protected deep-link (incl. search), regardless of flag', () => {
    flag.mockReturnValue(true);
    expect(resolvePostAuthPath({ pathname: '/analytics/xyz', search: '?tab=1' })).toBe('/analytics/xyz?tab=1');
    flag.mockReturnValue(false);
    expect(resolvePostAuthPath({ pathname: '/session' })).toBe('/session');
  });
  it('defaults to /practice when the rollout flag is ON and there is no deep-link', () => {
    flag.mockReturnValue(true);
    expect(resolvePostAuthPath(null)).toBe('/practice');
    expect(resolvePostAuthPath(undefined)).toBe('/practice');
  });
  it('defaults to /session when the flag is OFF (rollback path)', () => {
    flag.mockReturnValue(false);
    expect(resolvePostAuthPath(null)).toBe('/session');
  });
  it('rejects an unsafe/external `from` and uses the default instead', () => {
    flag.mockReturnValue(true);
    expect(resolvePostAuthPath({ pathname: 'https://evil.com' })).toBe('/practice');
    flag.mockReturnValue(false);
    expect(resolvePostAuthPath({ pathname: '//evil.com' })).toBe('/session');
  });
});
