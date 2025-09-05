import { Page, Route } from '@playwright/test';

export async function stubThirdParties(page: Page, options: { usageExceeded?: boolean } = {}) {
  // Block third-party analytics and tracking scripts
  await page.route('**://js.stripe.com/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://m.stripe.network/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://cdn.posthog.com/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://js.sentry-cdn.com/**', r => r.fulfill({ status: 204, body: '' }));

  // Conditionally mock the Supabase RPC call for usage checks
  await page.route('**/rest/v1/rpc/update_user_usage*', async (route: Route) => {
    if (options.usageExceeded) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // The user's suggestion had an error here, it should be a simple `true`, not `{ data: true, error: null }`
        // because the RPC call returns the boolean directly.
        body: JSON.stringify(true),
      });
    } else {
      // For tests that don't need to mock this, let the request proceed
      await route.continue();
    }
  });
}
