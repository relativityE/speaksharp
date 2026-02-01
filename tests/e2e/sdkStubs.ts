import { Page } from '@playwright/test';

const BLOCKED_DOMAINS = [
  'sentry.io',
  'posthog.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
];

export async function stubThirdParties(page: Page) {
  for (const domain of BLOCKED_DOMAINS) {
    await page.route(`**/*.${domain}/*`, (route) => {
      console.error(`[STUB] Blocked external request to ${domain}: ${route.request().url()}`);
      return route.abort('connectionrefused');
    });
  }

  await page.route('**/*.stripe.com/*', (route) => {
    console.log('[STUB] Mocked Stripe request', route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* Mock Stripe.js */' });
  });
}