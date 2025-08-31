import { Page } from '@playwright/test';

export async function stubThirdParties(page: Page) {
  await page.route('**://js.stripe.com/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://m.stripe.network/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://cdn.posthog.com/**', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**://js.sentry-cdn.com/**', r => r.fulfill({ status: 204, body: '' }));
  // allow everything else
}
