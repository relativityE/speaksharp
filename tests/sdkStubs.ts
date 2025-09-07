// tests/sdkStubs.ts - ENHANCED VERSION
import { Page } from '@playwright/test';

const BLOCKED_DOMAINS = [
  'sentry.io',
  'posthog.com',
  'stripe.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
];

const MOCK_SUPABASE_URL = 'https://mock.supabase.co';

export async function stubThirdParties(page: Page, options: {
  usageExceeded?: boolean;
} = {}) {

  // Block external domains first
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (BLOCKED_DOMAINS.some(domain => url.hostname.endsWith(domain))) {
      if (url.hostname.includes('stripe.com') && route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ checkout_url: '/checkout-success' }),
        });
      } else {
        return route.fulfill({ status: 200, body: `Blocked by test: ${url.hostname}` });
      }
    }
    return route.continue();
  });

  // Enhanced Supabase mocking
  await page.route('https://mock.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const request = route.request();
    const pathname = url.pathname;
    const searchParams = url.searchParams;

    // Sessions endpoint
    if (pathname.includes('/rest/v1/sessions')) {
      if (request.method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'mock-session-id',
            created_at: new Date().toISOString(),
            duration: 0
          })
        });
      }

      if (request.method() === 'GET') {
        const sessions = options.usageExceeded ?
          [{
            id: 1,
            duration: 1800,
            created_at: new Date().toISOString(),
            user_id: 'free-user-id'
          }] : [];

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sessions)
        });
      }
    }

    // Profiles endpoint
    if (pathname.includes('/rest/v1/profiles')) {
      if (request.method() === 'GET') {
        const idParam = searchParams.get('id');
        let userId = 'unknown';

        if (idParam && idParam.startsWith('eq.')) {
          userId = idParam.replace('eq.', '');
        }

        let profile = {};
        if (userId === 'pro-user-id') {
          profile = {
            id: 'pro-user-id',
            email: 'pro@example.com',
            subscription_status: 'pro',
            created_at: new Date().toISOString()
          };
        } else if (userId === 'free-user-id') {
          profile = {
            id: 'free-user-id',
            email: 'free@example.com',
            subscription_status: 'free',
            created_at: new Date().toISOString()
          };
        } else {
          profile = {
            id: userId,
            email: 'user@example.com',
            subscription_status: 'free',
            created_at: new Date().toISOString()
          };
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([profile])
        });
      }
    }

    // Auth endpoints - CRITICAL ADDITIONS
    if (pathname.includes('/auth/v1/user')) {
      const mockSession = await page.evaluate(() => window.__E2E_MOCK_SESSION__);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockSession?.user || null)
      });
    }

    // Session endpoint
    if (pathname.includes('/auth/v1/token') && searchParams.get('grant_type') === 'refresh_token') {
      const mockSession = await page.evaluate(() => window.__E2E_MOCK_SESSION__);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockSession || {})
      });
    }

    // Default 404 for unmocked endpoints
    return route.fulfill({ status: 404, body: 'Not Found' });
  });

  // Mark stubs as ready
  await page.addInitScript(() => {
    window.__STUBS_READY__ = true;
  });
}
