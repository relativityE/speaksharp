import { test as base, expect } from '@playwright/test';

/**
 * Deployed-live test base with a HOST-SCOPED Vercel Protection Bypass (#964).
 *
 * A global `extraHTTPHeaders` bypass leaked `x-vercel-*` headers onto EVERY request — including the
 * cross-origin `check-usage-limit` call to Supabase, whose edge-function CORS rejects those request
 * headers (preflight → `net::ERR_FAILED`), breaking free-user entitlement resolution.
 *
 * Fix: inject `x-vercel-protection-bypass` ONLY on requests whose host matches the tested Vercel
 * `base_url`/preview host, and NEVER `x-vercel-set-bypass-cookie` or any bypass header to Supabase or
 * any other origin. No-op when the secret is absent (e.g. against public prod).
 */
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    let baseHost: string | null = null;
    try { baseHost = baseURL ? new URL(baseURL).host : null; } catch { baseHost = null; }

    if (bypassSecret && baseHost) {
      // Match ONLY requests to the Vercel app host (URL predicate). Cross-origin requests (Supabase
      // edge functions, AssemblyAI token/streaming) are NOT intercepted at all — so nothing here can
      // perturb their timing/preflight, and they never receive any Vercel bypass header.
      await context.route(
        (url) => { try { return url.host === baseHost; } catch { return false; } },
        async (route) => {
          const request = route.request();
          await route.continue({ headers: { ...request.headers(), 'x-vercel-protection-bypass': bypassSecret } });
        },
      );
    }

    await use(context);
  },
});

export { expect };
