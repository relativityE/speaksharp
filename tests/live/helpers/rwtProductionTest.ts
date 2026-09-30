import { test as base, expect } from '@playwright/test';
import { routeVercelBypass } from './deployedLiveTest';

/**
 * The RWT Production test base: a real user's page, with nothing injected.
 *
 * Rehearsal 1 (run 36506361220, PM 5881740741) HOLDed before signup because `deployedLiveTest` sets
 * `window.__E2E_CONTEXT__` on every page, and `approvedSurfaceFailures` correctly refuses any `__E2E` key. That flag only
 * stops MSW on Preview builds; Production never starts MSW. This base keeps the host-scoped Vercel bypass (no page-visible
 * key) and adds no init script, so the surface guard stays strict and a real-user journey carries no test surface.
 */
export const test = base.extend({
    context: async ({ context, baseURL }, use) => {
        await routeVercelBypass(context, baseURL);
        await use(context);
    },
});

export { expect };
