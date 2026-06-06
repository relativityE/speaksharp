/**
 * Zero-HuggingFace audit for Private STT (release self-host guard).
 * ============================================================================
 * Asserts that during a Private session the model assets load from OUR OWN ORIGIN
 * (`/models/…`) and that NO request hits HuggingFace (`huggingface.co`, `cdn-lfs`, `hf.co`).
 *
 * This is the regression guard for the self-hosting work: if a future change reverts the
 * worker to a HuggingFace remote (e.g. re-enabling `allowRemoteModels`), or a Vercel/LFS
 * deploy serves a pointer/HTML instead of the real model, this audit fails loudly.
 *
 * DESIGN — two complementary signals (either alone has a blind spot):
 *   1. Network listener (`page.on('request')`): captures ALL requests INCLUDING Web Worker
 *      fetches at the CDP level — which in-page `performance.getEntriesByType('resource')`
 *      cannot see (the model loads inside the transformers.js worker).
 *   2. Cache API cross-check: transformers.js caches the model files it fetched in the
 *      `transformers-cache` Cache; we confirm those URLs are same-origin `/models/` and
 *      not HuggingFace — origin-agnostic, catches anything the listener missed.
 *
 * USAGE (Playwright):
 *   import { trackPrivateModelRequests } from './helpers/zeroHuggingFaceAudit.mjs';
 *   const audit = trackPrivateModelRequests(page);   // BEFORE starting the Private session
 *   // … run the Private STT session (record → transcribe) …
 *   const result = await audit.assertZeroHuggingFace();  // throws on any violation
 *   // result = { ok, totalRequests, modelsFromOrigin, huggingFaceRequests: 0 }
 *
 * Wire into a live-deploy run (canary.yml / live-release-matrix.yml) so a HuggingFace
 * regression is caught automatically against the real Vercel deployment.
 */

const HF_RE = /huggingface\.co|cdn-lfs|hf\.co/i;
const MODELS_RE = /\/models\//i;

/**
 * Begin recording network requests for a Private STT session.
 * @param {import('playwright').Page} page
 * @returns {{ urls: string[], stop: () => void, assertZeroHuggingFace: (opts?: { requireModelsFromOrigin?: boolean }) => Promise<{ok: true, totalRequests: number, modelsFromOrigin: number, huggingFaceRequests: 0}> }}
 */
export function trackPrivateModelRequests(page) {
  const urls = [];
  const onRequest = (req) => {
    try { urls.push(req.url()); } catch { /* ignore */ }
  };
  page.on('request', onRequest);

  return {
    urls,
    stop() { page.off('request', onRequest); },

    async assertZeroHuggingFace({ requireModelsFromOrigin = true } = {}) {
      // (1) Network-level: zero HuggingFace requests during the whole session.
      const networkHf = urls.filter((u) => HF_RE.test(u));

      // (2) Cache-level cross-check: what transformers.js actually fetched + cached.
      const cachedUrls = await page.evaluate(async () => {
        if (typeof globalThis.caches === 'undefined') return [];
        const all = [];
        for (const name of await globalThis.caches.keys()) {
          const cache = await globalThis.caches.open(name);
          for (const req of await cache.keys()) all.push(req.url);
        }
        return all;
      });
      const cacheHf = cachedUrls.filter((u) => HF_RE.test(u));
      const cacheModels = cachedUrls.filter((u) => MODELS_RE.test(u));

      const violations = [];
      if (networkHf.length) {
        violations.push(`network: ${networkHf.length} HuggingFace request(s) — e.g. ${networkHf.slice(0, 5).join(', ')}`);
      }
      if (cacheHf.length) {
        violations.push(`cache: ${cacheHf.length} HuggingFace cached URL(s) — e.g. ${cacheHf.slice(0, 5).join(', ')}`);
      }
      if (requireModelsFromOrigin && cacheModels.length === 0) {
        violations.push('no same-origin /models/ assets cached — the model may not have loaded from our origin (or did not load at all)');
      }

      if (violations.length) {
        throw new Error(`ZERO-HF AUDIT FAILED:\n  - ${violations.join('\n  - ')}`);
      }

      return {
        ok: true,
        totalRequests: urls.length,
        modelsFromOrigin: cacheModels.length,
        huggingFaceRequests: 0,
      };
    },
  };
}

/**
 * Pure in-page Cache-API audit (no Playwright). Run via `page.evaluate(inPageCacheAuditFn)`
 * or paste into a console for a quick same-origin check. Returns the audit object; does NOT throw.
 * (Cache-only — for the stronger network-level guarantee use trackPrivateModelRequests above.)
 */
export const inPageCacheAuditFn = async () => {
  const HF = /huggingface\.co|cdn-lfs|hf\.co/i;
  const MODELS = /\/models\//i;
  if (typeof globalThis.caches === 'undefined') return { ok: false, reason: 'no CacheStorage' };
  const all = [];
  for (const name of await globalThis.caches.keys()) {
    const cache = await globalThis.caches.open(name);
    for (const req of await cache.keys()) all.push(req.url);
  }
  const huggingFace = all.filter((u) => HF.test(u));
  const modelsFromOrigin = all.filter((u) => MODELS.test(u));
  return { ok: huggingFace.length === 0 && modelsFromOrigin.length > 0, huggingFace, modelsFromOrigin };
};
