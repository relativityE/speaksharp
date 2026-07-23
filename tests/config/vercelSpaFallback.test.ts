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

  it('immutable 1-year caching is scoped to the real /assets and /models file namespaces only', () => {
    const immutable = vercel.headers.filter((h) =>
      h.headers.some((x) => x.key === 'Cache-Control' && /immutable/.test(x.value)),
    );
    const sources = immutable.map((h) => h.source).sort();
    expect(sources).toEqual(['/assets/(.*)', '/models/(.*)']);
    // Those namespaces no longer serve an HTML fallback (they 404 on miss), so immutable caching never
    // pins an index-HTML document under /assets.
    expect(rewritesToIndex('/assets/anything.js')).toBe(false);
    expect(rewritesToIndex('/models/anything.bin')).toBe(false);
  });
});
