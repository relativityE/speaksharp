// tests/sdkStubs.ts - REFACTORED
import { Page, Route } from '@playwright/test';

const BLOCKED_DOMAINS = [
  'sentry.io',
  'posthog.com',
  'stripe.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
];

// --- Mock Data ---

const MOCK_USERS = {
  'pro@example.com': {
    id: 'pro-user-id',
    email: 'pro@example.com',
    user_metadata: { subscription_status: 'pro' },
    aud: 'authenticated',
    role: 'authenticated',
  },
  'premium@example.com': {
    id: 'premium-user-id',
    email: 'premium@example.com',
    user_metadata: { subscription_status: 'premium' },
    aud: 'authenticated',
    role: 'authenticated',
  },
  'free@example.com': {
    id: 'free-user-id',
    email: 'free@example.com',
    user_metadata: { subscription_status: 'free' },
    aud: 'authenticated',
    role: 'authenticated',
  },
};

const getMockSession = (user) => {
  if (!user) return null;
  return {
    access_token: `${user.id}-access-token`,
    refresh_token: `${user.id}-refresh-token`,
    user,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
};

// --- Main Stubbing Function ---

export async function stubThirdParties(page: Page, options: {
  usageExceeded?: boolean;
} = {}) {

  // Block external domains
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (BLOCKED_DOMAINS.some(domain => url.hostname.endsWith(domain))) {
      return route.fulfill({ status: 200, body: `Blocked by test: ${url.hostname}` });
    }
    return route.continue();
  });

  // Mock Supabase endpoints
  await page.route('https://mock.supabase.co/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const request = route.request();
    const pathname = url.pathname;
    const searchParams = url.searchParams;

    // --- Auth Endpoints ---
    if (pathname.includes('/auth/v1/token')) {
        const postData = request.postDataJSON();
        if (postData.email) {
            const user = MOCK_USERS[postData.email];
            const session = getMockSession(user);
            if (session) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
            }
        }
        // Handle refresh token
        if (postData.refresh_token) {
            const userId = postData.refresh_token.split('-refresh-token')[0];
            const user = Object.values(MOCK_USERS).find(u => u.id === userId);
            const session = getMockSession(user);
             if (session) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
            }
        }
        return route.fulfill({ status: 400, body: 'Bad Request' });
    }

    if (pathname.includes('/auth/v1/user')) {
        const authHeader = request.headers()['authorization'];
        const token = authHeader?.split('Bearer ')[1];
        const userId = token?.split('-access-token')[0];
        const user = Object.values(MOCK_USERS).find(u => u.id === userId);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user || null) });
    }

    // --- Database Endpoints ---
    if (pathname.includes('/rest/v1/sessions')) {
      if (request.method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'mock-session-id', created_at: new Date().toISOString(), duration: 0 })
        });
      }
      if (request.method() === 'GET') {
        const sessions = options.usageExceeded ? [{ id: 1, duration: 1800, created_at: new Date().toISOString(), user_id: 'free-user-id' }] : [];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) });
      }
    }

    if (pathname.includes('/rest/v1/user_profiles')) { // Corrected table name
      if (request.method() === 'GET') {
        const idParam = searchParams.get('id')?.replace('eq.', '');
        const user = Object.values(MOCK_USERS).find(u => u.id === idParam);
        const profile = user ? { id: user.id, subscription_status: user.user_metadata.subscription_status } : {};
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([profile]) });
      }
    }

    console.log(`Unhandled Supabase mock request: ${request.method()} ${url.href}`);
    return route.fulfill({ status: 404, body: 'Not Found in Mock' });
  });
}
