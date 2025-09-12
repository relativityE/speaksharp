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
interface UserMetadata {
  subscription_status: 'pro' | 'premium' | 'free';
  preferred_mode?: 'on-device' | 'cloud';
}

interface MockUser {
  id: string;
  email: string;
  user_metadata: UserMetadata;
  aud: 'authenticated';
  role: 'authenticated';
}

const MOCK_USERS: { [email: string]: MockUser } = {
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

const getMockSession = (user: MockUser | undefined) => {
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
  forceOnDevice?: boolean;
} = {}) {
  // Mock Supabase endpoints
  await page.route('https://mock.supabase.co/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const request = route.request();
    const pathname = url.pathname;
    const searchParams = url.searchParams;

    try {
      // --- Auth Endpoints ---
      if (pathname.includes('/auth/v1/token')) {
        const postData = request.postDataJSON() as { email?: string; refresh_token?: string };
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
        // FIXED: Always handle the route, even for bad requests
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Bad Request' }) });
      }

      if (pathname.includes('/auth/v1/user')) {
        const authHeader = request.headers()['authorization'];
        const token = authHeader?.split('Bearer ')[1];
        const userId = token?.split('-access-token')[0];
        const user = Object.values(MOCK_USERS).find(u => u.id === userId);
        // FIXED: Always return a proper response
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user || null) });
      }

      // --- Database Endpoints ---
      if (pathname.includes('/rest/v1/sessions')) {
        if (request.method() === 'POST') {
          return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'mock-session-id', created_at: new Date().toISOString(), duration: 0 }) });
        }
        if (request.method() === 'GET') {
          const sessions = options.usageExceeded ? [{ id: 1, duration: 1800, created_at: new Date().toISOString(), user_id: 'free-user-id' }] : [];
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) });
        }
        // FIXED: Handle other HTTP methods
        return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
      }

      if (pathname.includes('/rest/v1/rpc/get_user_details')) {
        const authHeader = request.headers()['authorization'];
        const token = authHeader?.split('Bearer ')[1];
        const userId = token?.split('-access-token')[0];
        const user = Object.values(MOCK_USERS).find(u => u.id === userId);
        if (user) {
          const userDetails = {
            id: user.id,
            email: user.email,
            subscription_status: user.user_metadata.subscription_status,
            preferred_mode: user.user_metadata.preferred_mode || 'cloud',
          };
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([userDetails]) }); // Return as array
        }
        // FIXED: Always return a response
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }); // Return empty array
      }

      if (pathname.includes('/rest/v1/user_profiles')) {
        if (request.method() === 'GET') {
          const idParam = searchParams.get('id')?.replace('eq.', '');
          const user = Object.values(MOCK_USERS).find(u => u.id === idParam);
          let profile: { id?: string; subscription_status?: 'free' | 'pro' | 'premium'; preferred_mode?: 'on-device' | 'cloud'; } = user ? {
            id: user.id,
            subscription_status: user.user_metadata.subscription_status
          } : {};
          if (options.forceOnDevice) {
            profile = { ...profile, preferred_mode: 'on-device' };
          }
          // .single() expects a single object, not an array
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
        }
        // FIXED: Handle other HTTP methods
        return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
      }

      // FIXED: Always handle unmatched routes
      console.error(`Unhandled Supabase mock request: ${request.method()} ${url.href}`);
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Not Found in Mock: ${url.href}` }) });
    } catch (error) {
      // FIXED: Add error handling to prevent hanging
      console.error('Error in Supabase route handler:', error);
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) });
    }
  });

  // Block external domains
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (BLOCKED_DOMAINS.some(domain => url.hostname.endsWith(domain))) {
      return route.fulfill({ status: 200, body: `Blocked by test: ${url.hostname}` });
    }
    // Add debugging and safer continuation
    console.log(`Allowing request to: ${url.href}`);
    try {
      return await route.continue();
    } catch (error) {
      console.error(`Route continuation failed for ${url.href}:`, error);
      // Abort the request if continuation fails, instead of hanging
      return route.abort();
    }
  });
}
