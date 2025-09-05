import { Page } from '@playwright/test';

export async function stubThirdParties(page: Page) {
  // Block third-party analytics and tracking scripts to prevent them from
  // interfering with E2E tests.
  await page.route('**://js.stripe.com/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://m.stripe.network/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://cdn.posthog.com/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://js.sentry-cdn.com/**', r => r.fulfill({ status: 204, body: '' }));
}
