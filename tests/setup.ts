// tests/setup.ts
import { test as base } from "@playwright/test";

const isDebug = !!process.env.DEBUG;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/*", async route => {
      const url = route.request().url();

      // Intercept profile fetches to return mock data based on user ID
      if (url.includes('/rest/v1/profiles') && route.request().method() === 'GET') {
        const urlParams = new URLSearchParams(url.split('?')[1]);
        const userId = urlParams.get('id')?.split('.')[1]; // e.g., 'eq.free-user-id' -> 'free-user-id'

        if (userId === 'free-user-id') {
          console.log(`[mock] Intercepted profile fetch for: ${userId}`);
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ id: userId, subscription_status: 'free' }]),
          });
        }

        if (userId === 'pro-user-id') {
          console.log(`[mock] Intercepted profile fetch for: ${userId}`);
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ id: userId, subscription_status: 'pro' }]),
          });
        }
      }

      // Allow Supabase + local dev
      if (
        url.includes("supabase.co") ||
        url.includes("localhost") ||
        url.includes("127.0.0.1")
      ) {
        if (isDebug) console.log(`[allow] ${url}`);
        return route.continue();
      }

      if (isDebug) {
        // In debug mode: log and continue (see what’s being called)
        console.log(`[debug-pass] ${url}`);
        return route.continue();
      }

      // In strict mode: block it
      console.warn(`[block] ${url}`);
      return route.fulfill({ status: 204, body: "" });
    });

    await use(page);
  },
});

export { expect } from "@playwright/test";
