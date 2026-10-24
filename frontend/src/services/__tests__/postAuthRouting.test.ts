import { describe, it, expect } from 'vitest';
import { isSafeInternalPath, safeDeepLink, resolvePostAuthPath, resolveInAppPostAuthTarget } from '@/services/postAuthRouting';

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

describe('postAuthRouting — resolveInAppPostAuthTarget (#1548 in-app return: hash + original state)', () => {
  const ID = '7e7aca2c-c192-4a80-8976-df5637859164';

  it('keeps the destination hash and its ORIGINAL router state, for canonical and legacy Progress paths', () => {
    for (const pathname of [`/progress/${ID}`, `/analytics/${ID}`]) {
      expect(resolveInAppPostAuthTarget({ pathname, search: '?q=1', hash: '#trend', state: { tab: 'filler' } }))
        .toEqual({ to: `${pathname}?q=1#trend`, state: { tab: 'filler' } });
    }
  });

  it('omits state when the destination had none', () => {
    expect(resolveInAppPostAuthTarget({ pathname: '/session' })).toEqual({ to: '/session' });
    expect(resolveInAppPostAuthTarget({ pathname: '/session', search: '', hash: '' })).toEqual({ to: '/session' });
  });

  it('refuses MALFORMED parts to /practice without state (each part validated before joining)', () => {
    const state = { kept: 'never' };
    const malformed = [
      { pathname: '/', search: '/evil.example' },          // would join into protocol-relative //evil.example
      { pathname: '/', search: '\\evil.example' },        // backslash in search
      { pathname: '/session', search: 'q=1' },              // search without '?'
      { pathname: '/session', search: '?q=1#frag' },        // search carrying a fragment
      { pathname: '/session', hash: 'no-hash-mark' },       // hash without '#'
      { pathname: '/session?q=1' },                         // pathname carrying a query
      { pathname: '/session#top' },                         // pathname carrying a fragment
      { pathname: '/auth?x=1' },                            // auth route hidden behind a query in pathname
      { pathname: '/auth#x' },
      { pathname: '/auth/', search: '?' },
    ];
    for (const from of malformed) {
      expect(resolveInAppPostAuthTarget({ ...from, state })).toEqual({ to: '/practice' });
    }
  });

  it('never follows a nested state.from — the outer validated pathname is the destination', () => {
    const nested = { from: { pathname: '//evil.com' } };
    expect(resolveInAppPostAuthTarget({ pathname: '/session', state: nested })).toEqual({ to: '/session', state: nested });
  });

  it('defaults to /practice WITHOUT state for absent, unsafe or sign-in destinations', () => {
    const state = { secret: 'wrapper' };
    for (const pathname of [undefined, '', 'relative', '//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com',
      '/auth', '/auth/signin', '/AUTH/signin', '/auth/continue', '/signup']) {
      expect(resolveInAppPostAuthTarget({ pathname, search: '?x=1', hash: '#h', state })).toEqual({ to: '/practice' });
    }
    expect(resolveInAppPostAuthTarget(null)).toEqual({ to: '/practice' });
    expect(resolveInAppPostAuthTarget(undefined)).toEqual({ to: '/practice' });
  });

  it('does not treat a route that merely starts with "auth"/"signup" text as a sign-in surface', () => {
    expect(resolveInAppPostAuthTarget({ pathname: '/authors' })).toEqual({ to: '/authors' });
  });

  it('leaves the magic-link email URL path unchanged: safeDeepLink still drops hash and state', () => {
    expect(safeDeepLink({ pathname: `/progress/${ID}`, search: '?q=1', hash: '#trend', state: { a: 1 } } as never)).toBe(`/progress/${ID}?q=1`);
  });
});
