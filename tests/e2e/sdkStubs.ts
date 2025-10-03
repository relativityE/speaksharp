// sdkStubs.ts
import { Page, Route } from '@playwright/test';

// --- Blocked external domains ---
const BLOCKED_DOMAINS = [
  'sentry.io',
  'posthog.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
  // NOTE: supabase.co is handled by MSW, not blocked here.
];

// --- Main Stubbing Function ---
export async function stubThirdParties(page: Page) {
  // 1️⃣ Mock Stripe more efficiently
  await page.route('**/*.stripe.com/*', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* Mock Stripe.js */',
    });
  });

  // 2️⃣ Block unwanted external domains more efficiently
  for (const domain of BLOCKED_DOMAINS) {
    await page.route(`**/*.${domain}/*`, (route) => {
      console.log(`[BLOCKED] External domain: ${domain}`);
      return route.abort('connectionrefused');
    });
  }

  // ❗ No catch-all handler is needed. If a request doesn't match the routes above,
  // it will be allowed to continue by default. This is much more performant.
}