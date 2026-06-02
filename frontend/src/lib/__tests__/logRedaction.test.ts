import { describe, it, expect } from 'vitest';
import { redactTranscript, scrubConsoleBreadcrumb } from '../logRedaction';

describe('redactTranscript (layer 1: source)', () => {
  it('returns ONLY safe diagnostics — never the raw text', () => {
    const text = 'um the stale smell of old beer like lingers';
    const out = redactTranscript(text);
    expect(out).toEqual({ length: text.length, words: 9, redacted: true });
    // The raw text must not appear anywhere in the serialized payload.
    expect(JSON.stringify(out)).not.toContain('stale');
    expect(JSON.stringify(out)).not.toContain('beer');
  });

  it('is null/empty safe', () => {
    expect(redactTranscript('')).toEqual({ length: 0, words: 0, redacted: true });
    expect(redactTranscript(null)).toEqual({ length: 0, words: 0, redacted: true });
    expect(redactTranscript(undefined)).toEqual({ length: 0, words: 0, redacted: true });
    expect(redactTranscript('   ')).toEqual({ length: 3, words: 0, redacted: true });
  });

  it('counts words robustly across irregular whitespace', () => {
    expect(redactTranscript('one  two\tthree\nfour').words).toBe(4);
  });
});

describe('scrubConsoleBreadcrumb (layer 2: sink)', () => {
  it('DROPS console breadcrumbs (where transcript-bearing logs land)', () => {
    expect(scrubConsoleBreadcrumb({ category: 'console', message: 'newText: ... beer ...' })).toBeNull();
  });

  it('keeps non-console breadcrumbs (navigation, fetch, ui)', () => {
    const nav = { category: 'navigation', data: { to: '/session' } };
    const fetchBc = { category: 'fetch', data: { url: '/api' } };
    expect(scrubConsoleBreadcrumb(nav)).toBe(nav);
    expect(scrubConsoleBreadcrumb(fetchBc)).toBe(fetchBc);
  });

  it('is null-safe', () => {
    expect(scrubConsoleBreadcrumb(null)).toBeNull();
    expect(scrubConsoleBreadcrumb({})).toEqual({});
  });
});
