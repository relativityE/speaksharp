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
      await context.route('**/*', async (route) => {
        const request = route.request();
        let sameHost = false;
        try { sameHost = new URL(request.url()).host === baseHost; } catch { sameHost = false; }
        if (sameHost) {
          // Only the Vercel app host gets the protection-bypass header; nothing else does.
          await route.continue({ headers: { ...request.headers(), 'x-vercel-protection-bypass': bypassSecret } });
        } else {
          await route.continue();
        }
      });
    }

    await use(context);
  },
});

export { expect };
