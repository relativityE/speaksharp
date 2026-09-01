/**
 * #1390 — attaching to the WRONG browser target is the quiet failure.
 *
 * Every identity reading, egress audit and verdict is taken from whichever page the observer attached
 * to. If that is the wrong tab, all of it looks valid and describes a session nobody recorded in.
 */
import { describe, it, expect } from 'vitest';
import {
  assertLoopbackOrigin, selectAppTarget, safeTargetForEvidence, DEFAULT_CDP_ORIGIN,
} from '../../scripts/human-test/cdpTarget.mjs';

const APP = 'https://speaksharp-public.vercel.app';
const page = (url, id = 't1') => ({ id, type: 'page', url });

describe('the CDP endpoint is loopback only', () => {
  it('POSITIVE CONTROL: the default endpoint is accepted', () => {
    expect(assertLoopbackOrigin(DEFAULT_CDP_ORIGIN)).toBe('http://127.0.0.1:9222');
  });

  it('CASUALTY: a remote host is refused', () => {
    // A CDP endpoint is full control of a browser holding a live authenticated session.
    expect(() => assertLoopbackOrigin('http://10.0.0.5:9222')).toThrow(/must be 127\.0\.0\.1/);
  });

  it('CASUALTY: even "localhost" is refused — it can resolve elsewhere', () => {
    expect(() => assertLoopbackOrigin('http://localhost:9222')).toThrow(/must be 127\.0\.0\.1/);
  });

  it('CASUALTY: https and non-URLs are refused rather than coerced', () => {
    expect(() => assertLoopbackOrigin('https://127.0.0.1:9222')).toThrow(/must be http/);
    expect(() => assertLoopbackOrigin('9222')).toThrow(/not a URL/);
  });
});

describe('exactly one app page, or it is an error', () => {
  it('POSITIVE CONTROL: a single matching page is selected', () => {
    const r = selectAppTarget([page(`${APP}/session`), page('https://example.com', 't2')], APP);
    expect(r.error).toBeNull();
    expect(r.target.url).toBe(`${APP}/session`);
  });

  it('CASUALTY: TWO app pages is an error, never "take the first"', () => {
    // The operator has the app open twice; picking one would attribute the take to the wrong tab and
    // nothing downstream could detect it.
    const r = selectAppTarget([page(`${APP}/session`, 'a'), page(`${APP}/analytics`, 'b')], APP);
    expect(r.target).toBeNull();
    expect(r.error).toMatch(/2 pages open/);
  });

  it('CASUALTY: no app page is an error with an actionable message', () => {
    const r = selectAppTarget([page('https://example.com')], APP);
    expect(r.target).toBeNull();
    expect(r.error).toMatch(/no open page/);
  });

  it('non-page targets (workers, extensions) are never selected', () => {
    const r = selectAppTarget([{ id: 'w', type: 'service_worker', url: `${APP}/sw.js` }], APP);
    expect(r.target).toBeNull();
  });
});

describe('evidence never carries a raw target URL', () => {
  it('CASUALTY: query and fragment are stripped — auth callbacks put tokens there', () => {
    const safe = safeTargetForEvidence(page(`${APP}/auth/callback?access_token=SECRET#refresh=ALSO`));
    expect(JSON.stringify(safe)).not.toContain('SECRET');
    expect(JSON.stringify(safe)).not.toContain('ALSO');
    expect(safe).toMatchObject({ origin: APP, pathname: '/auth/callback' });
  });

  it('an unparseable URL yields nulls rather than being echoed', () => {
    expect(safeTargetForEvidence({ id: 'x', type: 'page', url: 'not a url' }))
      .toMatchObject({ origin: null, pathname: null });
  });
});

describe('the ambiguity error never echoes a raw target URL', () => {
    it('CASUALTY: two matching tabs carrying secrets leak neither into the error', () => {
        // The operator hits this error exactly when several app tabs are open -- most likely straight
        // after an auth round-trip, when one of them IS the callback URL with a token in its query or
        // fragment. The error goes to a terminal and into run logs, which are as durable as the evidence
        // file, so redacting evidence while leaving this path raw protects nothing.
        const { error, target } = selectAppTarget([
            { id: '1', type: 'page', url: 'https://app.example/auth/callback?access_token=SECRET_QUERY' },
            { id: '2', type: 'page', url: 'https://app.example/session#id_token=SECRET_FRAGMENT' },
        ], 'https://app.example');

        expect(target).toBeNull();
        expect(error).not.toContain('SECRET_QUERY');
        expect(error).not.toContain('SECRET_FRAGMENT');
        expect(error).not.toContain('access_token');
        expect(error).not.toContain('?');
        expect(error).not.toContain('#');
        // Still actionable: the operator needs to know how many and which pages to close.
        expect(error).toContain('2 pages');
        expect(error).toContain('/auth/callback');
        expect(error).toContain('/session');
    });
});
