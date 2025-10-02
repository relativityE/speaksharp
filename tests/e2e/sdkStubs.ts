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
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const requestUrl = request.url();

    // Ignore non-http requests
    if (!requestUrl.startsWith('http')) {
      return route.continue();
    }

    const url = new URL(requestUrl);
    const hostname = url.hostname;

    try {
      // 1️⃣ Mock Stripe
      if (hostname.endsWith('stripe.com')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: '/* Mock Stripe.js */',
        });
      }

      // 2️⃣ Block unwanted external domains
      if (BLOCKED_DOMAINS.some(d => hostname.endsWith(d))) {
        console.log(`[BLOCKED] External domain: ${hostname}`);
        return route.abort('connectionrefused');
      }

      // 3️⃣ Allow everything else (including requests to our app and Supabase, which MSW will handle)
      return route.continue();
    } catch (err) {
      console.error('Error in route handler:', err);
      return route.abort();
    }
  });
}