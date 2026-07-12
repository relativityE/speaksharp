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
    // Deployed-live tests always run against the REAL deployed backend and must NEVER use MSW.
    // e2e-bridge starts MSW unless __E2E_CONTEXT__ is set OR the build defines VITE_SKIP_MSW /
    // VITE_USE_LIVE_DB. Vercel PREVIEW builds don't define those, so without this flag MSW would
    // intercept real network calls (e.g. assemblyai-token) and stall recording on the Preview.
    await context.addInitScript(() => {
      (window as unknown as { __E2E_CONTEXT__?: boolean }).__E2E_CONTEXT__ = true;
    });

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
          await route.continue({
            headers: {
              ...request.headers(),
              'x-vercel-protection-bypass': bypassSecret,
              // #963 worklet fix: also ask Vercel to persist an ORIGIN-SCOPED bypass cookie. Header
              // injection alone does NOT cover `AudioWorklet.addModule('/audio/audio-processor.worklet.js')`
              // — that module is fetched by the browser's internal worklet loader, which bypasses this
              // route handler, so on the SSO-protected preview it received no bypass and returned a
              // non-JS challenge → DOMException "Unable to load a worklet's module." → Cloud/Private mic
              // start FAILED. Setting the cookie on these routed (navigation/XHR) requests makes the
              // browser attach it automatically to the non-routed worklet sub-resource fetch.
              //
              // SAFETY (vs the #964 GLOBAL-header leak): this header is added ONLY on the base-host route,
              // and the resulting cookie is domain-scoped by the browser to the preview host — so it is
              // NEVER sent cross-origin to Supabase/AssemblyAI. `samesitenone` so it is included in the
              // worklet fetch context. A green `:108` (check-usage-limit CORS) in the same run proves no leak.
              'x-vercel-set-bypass-cookie': 'samesitenone',
            },
          });
        },
      );
    }

    await use(context);
  },
});

export { expect };
