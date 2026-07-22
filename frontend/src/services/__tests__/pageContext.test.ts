import { describe, it, expect } from 'vitest';
import { resolvePageContext, toCanonicalRoute, issueAreasFor, ALL_ISSUE_AREAS } from '@/services/pageContext';

const UUID = '130bbc6c-5d89-465d-91e6-51f5a5951e34';

describe('pageContext — canonical route sanitization', () => {
  it('collapses UUID and opaque-id segments to a template token (no id leaks)', () => {
    expect(toCanonicalRoute(`/analytics/${UUID}`)).toBe('/analytics/:id');
    expect(toCanonicalRoute('/analytics/0123456789abcdef0123')).toBe('/analytics/:id');
  });

  it('strips any query string and hash defensively', () => {
    expect(toCanonicalRoute('/session?token=secret&email=a@b.com')).toBe('/session');
    expect(toCanonicalRoute('/analytics#frag')).toBe('/analytics');
  });

  it('normalizes root and trailing slashes', () => {
    expect(toCanonicalRoute('')).toBe('/');
    expect(toCanonicalRoute('/')).toBe('/');
    expect(toCanonicalRoute('/analytics/')).toBe('/analytics');
  });

  it('keeps known static segments verbatim', () => {
    expect(toCanonicalRoute('/auth/signin')).toBe('/auth/signin');
  });
});

describe('pageContext — resolvePageContext', () => {
  it('resolves the /practice entry route with its own page identity + issue areas', () => {
    expect(resolvePageContext('/practice')).toMatchObject({ pageKey: 'practice', pageLabel: 'SpeakSharp Practice', productMode: 'practice', canonicalRoute: '/practice' });
    const areas = issueAreasFor('practice').map((a) => a.value);
    expect(areas).toEqual(expect.arrayContaining(['quick_practice', 'guided_rehearsal', 'understanding_choices', 'other']));
  });

  it('resolves current production routes to allowlisted page identities', () => {
    expect(resolvePageContext('/')).toMatchObject({ pageKey: 'home', productMode: 'marketing', canonicalRoute: '/' });
    expect(resolvePageContext('/session')).toMatchObject({ pageKey: 'session', productMode: 'session', canonicalRoute: '/session' });
    expect(resolvePageContext('/analytics')).toMatchObject({ pageKey: 'analytics', productMode: 'progress', canonicalRoute: '/analytics' });
    expect(resolvePageContext('/auth/signin')).toMatchObject({ pageKey: 'auth', productMode: 'account' });
  });

  it('resolves a session-detail route to the :sessionId template (never the concrete id)', () => {
    const ctx = resolvePageContext(`/analytics/${UUID}`);
    expect(ctx).toMatchObject({ pageKey: 'analytics_session', canonicalRoute: '/analytics/:sessionId' });
    expect(ctx.canonicalRoute).not.toContain(UUID);
    expect(JSON.stringify(ctx)).not.toContain(UUID);
  });

  it('FAILS CLOSED on any unknown route — constant /other, never arbitrary path content', () => {
    // Sensitive path content (email, token, name, encoded data) must NEVER survive into context.
    const fixtures: Array<[string, string]> = [
      ['/invite/user@example.com', 'user@example.com'],
      ['/reset/nonhex-secret-token', 'nonhex-secret-token'],
      ['/mystery/customer-name/document', 'customer-name'],
      ['/team/Jane%20Doe/settings', 'Jane'],
      [`/mystery/${UUID}/thing?q=secret`, UUID],
    ];
    for (const [path, secret] of fixtures) {
      const ctx = resolvePageContext(path);
      expect(ctx).toMatchObject({ pageKey: 'other', pageLabel: 'Other page', productMode: 'other', journeyStep: 'unknown', canonicalRoute: '/other' });
      expect(JSON.stringify(ctx)).not.toContain(secret);
    }
  });

  it('only exactly-registered routes get a template (a foreign /auth path fails closed)', () => {
    expect(resolvePageContext('/auth/signin').canonicalRoute).toBe('/auth/signin');
    // A non-registered /auth/* path must NOT preserve its segment.
    const ctx = resolvePageContext('/auth/user@example.com');
    expect(ctx.canonicalRoute).toBe('/other');
    expect(JSON.stringify(ctx)).not.toContain('user@example.com');
  });
});

describe('pageContext — issue areas', () => {
  it('returns page-specific options ending in "other"', () => {
    const session = issueAreasFor('session').map((o) => o.value);
    expect(session).toContain('transcription');
    expect(session[session.length - 1]).toBe('other');
    const home = issueAreasFor('home').map((o) => o.value);
    expect(home).toContain('understanding_choices');
  });

  it('exposes a stable flattened allowlist of every area slug', () => {
    expect(ALL_ISSUE_AREAS).toContain('transcription');
    expect(ALL_ISSUE_AREAS).toContain('understanding_choices');
    // slugs only — no free text / labels
    ALL_ISSUE_AREAS.forEach((slug) => expect(slug).toMatch(/^[a-z_]+$/));
  });
});
