// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { parseExclusionManifest, requireExclusionManifest, isProhibitedManifestDomain, MANIFEST_CATEGORIES } from '../../scripts/lib/auditManifest.mjs';

// #1294 addendum — ONE strict shared manifest parser for BOTH tester audits. FAILS CLOSED on absent /
// malformed / loosely-shaped / incomplete / duplicate / prohibited-domain manifests, before any client
// construction, and never emits an address.

const FIVE = (over = {}) => JSON.stringify({ owner_admin: [], synthetic: [], checkout: [], canary: [], qa: [], ...over });

describe('parseExclusionManifest — accepts only a strict five-category manifest', () => {
  it('the five canonical keys are exactly these', () => {
    expect(MANIFEST_CATEGORIES).toEqual(['owner_admin', 'synthetic', 'checkout', 'canary', 'qa']);
  });

  it('a valid five-category manifest with empty NON-applicable arrays succeeds', () => {
    const r = parseExclusionManifest(FIVE({ owner_admin: ['owner@example.test'], qa: ['qa@example.test'] }));
    expect(r.ok).toBe(true);
    expect(r.byEmail.get('owner@example.test')).toBe('owner_admin');
    expect(r.byEmail.get('qa@example.test')).toBe('qa');
  });

  it.each([
    ['absent', undefined],
    ['empty', '   '],
    ['not JSON', '{not json'],
    ['a bare array (loosely shaped)', '["a@example.test"]'],
    ['an object of the wrong keys', JSON.stringify({ internal: ['a@example.test'] })],
    ['a missing category', JSON.stringify({ owner_admin: [], synthetic: [], checkout: [], canary: [] })],
    ['an extra unknown category', FIVE({ extra: [] })],
    ['a non-array category', JSON.stringify({ owner_admin: 'x@example.test', synthetic: [], checkout: [], canary: [], qa: [] })],
    ['a blank entry', FIVE({ qa: ['  '] })],
    ['a non-email entry', FIVE({ qa: ['not-an-email'] })],
    ['zero addresses total', FIVE()],
  ])('FAILS CLOSED on %s', (_label, raw) => {
    expect(parseExclusionManifest(raw).ok).toBe(false);
  });

  it('FAILS CLOSED on a cross-category duplicate address', () => {
    const r = parseExclusionManifest(FIVE({ owner_admin: ['dup@example.test'], qa: ['dup@example.test'] }));
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain('dup@example.test'); // category names only — never the address
  });

  it('REJECTS speaksharp.app apex and every subdomain (SpeakSharp does not own it)', () => {
    expect(isProhibitedManifestDomain('x@speaksharp.app')).toBe(true);
    expect(isProhibitedManifestDomain('x@mail.speaksharp.app')).toBe(true);
    expect(isProhibitedManifestDomain('x@example.test')).toBe(false);
    expect(parseExclusionManifest(FIVE({ canary: ['canary@speaksharp.app'] })).ok).toBe(false);
    expect(parseExclusionManifest(FIVE({ synthetic: ['s@e2e.speaksharp.app'] })).ok).toBe(false);
  });

  it('FAILS CLOSED on the currently-supplied retired-domain manifest (4 synthetic + 1 canary @speaksharp.app)', () => {
    const retired = JSON.stringify({
      owner_admin: ['owner@example.test'],
      synthetic: ['s1@speaksharp.app', 's2@speaksharp.app', 's3@speaksharp.app', 's4@speaksharp.app'],
      checkout: [], canary: ['canary-user@speaksharp.app'], qa: [],
    });
    const r = parseExclusionManifest(retired);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/speaksharp\.app/); // names the domain policy, not any address
  });
});

describe('requireExclusionManifest — fail-closed BEFORE client construction, no address emitted', () => {
  it('on an invalid manifest: calls exit(1), logs a sanitized (address-free) reason, returns empty', () => {
    const exit = vi.fn();
    const logs = [];
    const { byEmail } = requireExclusionManifest(FIVE({ canary: ['leak@speaksharp.app'] }), { label: 'cohort', exit, log: (m) => logs.push(m) });
    expect(exit).toHaveBeenCalledWith(1);
    expect(byEmail.size).toBe(0);
    expect(logs.join('\n')).not.toContain('leak@speaksharp.app'); // never the address
    expect(logs.join('\n')).toMatch(/FAILING CLOSED/);
  });

  it('on a valid manifest: does not exit and returns the byEmail map', () => {
    const exit = vi.fn();
    const { byEmail } = requireExclusionManifest(FIVE({ qa: ['qa@example.test'] }), { exit, log: () => {} });
    expect(exit).not.toHaveBeenCalled();
    expect(byEmail.get('qa@example.test')).toBe('qa');
  });
});
