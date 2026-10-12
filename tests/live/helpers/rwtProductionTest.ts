import { test as base, expect } from '@playwright/test';
import { routeVercelBypass } from './deployedLiveTest';
import { applyRwtIdentity, rwtIdentityFor } from './rwtBrowserIdentity';
import { applyHumanReflex, resolveHumanReflexMs } from './rwtHumanReflex';

/**
 * The RWT Production test base: a real user's page, with nothing injected.
 *
 * Rehearsal 1 (run 36506361220, PM 5881740741) HOLDed before signup because `deployedLiveTest` sets
 * `window.__E2E_CONTEXT__` on every page, and `approvedSurfaceFailures` correctly refuses any `__E2E` key. That flag only
 * stops MSW on Preview builds; Production never starts MSW. This base keeps the host-scoped Vercel bypass (no page-visible
 * key) and adds no init script, so the surface guard stays strict and a real-user journey carries no test surface.
 */
/** The bound on any RWT action or navigation that names no timeout of its own. */
export const RWT_ACTION_TIMEOUT_MS = 90_000;

export const test = base.extend({
    context: async ({ context, baseURL, browser }, use) => {
        await routeVercelBypass(context, baseURL);
        // #1258 PM 5932744381: the browser's own identity minus its headless signals, on every page this context opens,
        // so PostHog's bot filter does not discard the run's canary-classed telemetry. `navigator.webdriver` is the third
        // signal and is set at launch (RWT_BROWSER_IDENTITY_ARGS, supplied by every RWT spec's launch options).
        const identity = await rwtIdentityFor(browser);
        context.on('page', (page) => { void applyRwtIdentity(context, page, identity).catch(() => { /* closed page */ }); });
        // #1258 PM 6132878919: the deployed-live config sets no action or navigation timeout, so an action whose target
        // never appears waited until the 35-minute test timeout (run 38304068207). Every action and navigation without its
        // own timeout is now bounded; waits that need longer already pass an explicit timeout.
        context.setDefaultTimeout(RWT_ACTION_TIMEOUT_MS);
        context.setDefaultNavigationTimeout(RWT_ACTION_TIMEOUT_MS);
        await use(context);
    },
    page: async ({ context, browser, page }, use) => {
        // The fixture page exists before `context.on('page')` could see it: apply here, and await it, before any navigation.
        await applyRwtIdentity(context, page, await rwtIdentityFor(browser));
        // #1258 PO 2026-10-12: a person's think-time before every action (rwtHumanReflex.ts). Resolved here, so an invalid
        // dispatch value fails before the test body makes any write.
        const release = applyHumanReflex(page, resolveHumanReflexMs());
        try {
            await use(page);
        } finally {
            release();
        }
    },
});

export { expect };
