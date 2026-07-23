import { describe, it, expect } from 'vitest';
import { isSafeInternalPath, safeDeepLink, resolvePostAuthPath } from '@/services/postAuthRouting';

describe('postAuthRouting — open-redirect guard', () => {
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

describe('postAuthRouting — resolvePostAuthPath (flag-free; /practice is the default)', () => {
  it('defaults to /practice with no deep-link (no flag / no PostHog consulted)', () => {
    expect(resolvePostAuthPath(null)).toBe('/practice');
    expect(resolvePostAuthPath(undefined)).toBe('/practice');
    expect(resolvePostAuthPath({})).toBe('/practice');
  });
  it('honors a valid protected deep-link (incl. /session bookmarks and search)', () => {
    expect(resolvePostAuthPath({ pathname: '/session' })).toBe('/session');
    expect(resolvePostAuthPath({ pathname: '/analytics/xyz', search: '?t=1' })).toBe('/analytics/xyz?t=1');
  });
  it('rejects an unsafe/external `from` and falls back to /practice', () => {
    expect(resolvePostAuthPath({ pathname: '//evil.com' })).toBe('/practice');
    expect(resolvePostAuthPath({ pathname: 'javascript:alert(1)' })).toBe('/practice');
  });
});
