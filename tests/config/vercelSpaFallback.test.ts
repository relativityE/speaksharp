// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Verifies the Vercel SPA-fallback routing so a stale tab requesting a rotated-away /assets/*.js gets a
// real 404 — never 200 text/html — while real app routes still serve the SPA index. This "verifies the
// regex" (the PR must not rely on an unverified pattern).

const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

// The SPA fallback rewrite = the one whose destination is the index ("/").
const spa = vercel.rewrites.find((r) => r.destination === '/');
// Anchor the Vercel source pattern like Vercel does (full-path match).
const spaRe = new RegExp(`^${spa!.source}$`);
const rewritesToIndex = (path: string) => spaRe.test(path);

describe('vercel.json SPA fallback', () => {
  it('has a SPA fallback rewrite to the index', () => {
    expect(spa, 'a rewrite with destination "/" must exist').toBeTruthy();
  });

  it('real app routes ARE rewritten to the SPA index (still boot)', () => {
    for (const p of ['/', '/practice', '/session', '/analytics', '/analytics/7e7aca2c-c192-4a80-8976-df5637859164', '/pricing']) {
      expect(rewritesToIndex(p), `${p} must serve the SPA index`).toBe(true);
    }
  });

  it('static namespaces are EXCLUDED from the SPA fallback → a miss returns 404, not index HTML', () => {
    for (const p of [
      '/assets/main-BXvKJWUT.js',
      '/assets/TranscriptionProvider-BmRyoA0V.js',
      '/assets/index-abc123.css',
      '/models/whisper-base.onnx',
      '/api/health',
    ]) {
      expect(rewritesToIndex(p), `${p} must NOT be rewritten to index (must 404 on miss)`).toBe(false);
    }
  });

  it('does NOT apply a blanket immutable/1-year browser Cache-Control to /assets or /models', () => {
    // Vercel applies `headers` by pathname regardless of whether the file exists, and it cannot condition
    // a header on response status. A blanket immutable rule on /assets/(.*) or /models/(.*) therefore
    // stamps a 404 (a rotated-away chunk an old tab requests) as browser-immutable for a year. We removed
    // those rules and rely on Vercel's CDN edge-caching of the content-hashed assets instead.
    const immutableRules = vercel.headers.filter((h) =>
      h.headers.some((x) => x.key === 'Cache-Control' && /immutable/.test(x.value)),
    );
    expect(immutableRules, 'no header rule may set an immutable browser Cache-Control').toEqual([]);

    const longMaxAge = vercel.headers.filter((h) =>
      h.headers.some((x) => x.key === 'Cache-Control' && /max-age=(\d{6,})/.test(x.value)),
    );
    expect(longMaxAge, 'no header rule may set a multi-day+ browser max-age (would pin 404s too)').toEqual([]);
  });

  it('keeps sw.js on no-cache (unchanged)', () => {
    const sw = vercel.headers.find((h) => h.source === '/sw.js');
    expect(sw?.headers.some((x) => x.key === 'Cache-Control' && /no-cache/.test(x.value)),
      'sw.js must stay no-cache').toBe(true);
  });
});
