// sdkStubs.ts
import { Page, Route } from '@playwright/test';
import { randomUUID } from 'crypto';

// --- Blocked external domains ---
const BLOCKED_DOMAINS = [
  'sentry.io',
  'posthog.com',
  'stripe.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
];

// --- Mock Users ---
interface UserProfile {
  id: string;
  subscription_status: 'pro' | 'premium' | 'free';
  preferred_mode?: 'on-device' | 'cloud';
}

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

// MOCK_USERS is now a cache for dynamically created users.
const MOCK_USERS: { [email: string]: MockUser } = {};

function getOrCreateMockUser(email: string): MockUser {
  if (MOCK_USERS[email]) {
    return MOCK_USERS[email];
  }

  const subscription_status = (email.split('@')[0] || 'free') as 'pro' | 'premium' | 'free';
  const newUser: MockUser = {
    id: `user_${randomUUID()}`,
    email: email,
    user_metadata: { subscription_status },
    aud: 'authenticated',
    role: 'authenticated',
  };

  MOCK_USERS[email] = newUser;
  return newUser;
}


const getMockSession = (user?: MockUser) => {
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
export async function stubThirdParties(page: Page, options: { usageExceeded?: boolean; forceOnDevice?: boolean } = {}) {
  // A single, comprehensive route handler is more reliable than multiple handlers.
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const hostname = url.hostname;
    const pathname = url.pathname;

    try {
      // 1️⃣ Handle Supabase mocks
      if (hostname.endsWith('mock.supabase.co')) {
        // --- Auth endpoints ---
        if (pathname.includes('/auth/v1/token')) {
          const postData = request.postDataJSON() as { email?: string; refresh_token?: string };
          if (postData?.email) {
            const user = getOrCreateMockUser(postData.email); // DYNAMIC
            const session = getMockSession(user);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
          }
          if (postData?.refresh_token) {
            const userId = postData.refresh_token.split('-refresh-token')[0];
            const user = Object.values(MOCK_USERS).find(u => u.id === userId);
            const session = getMockSession(user);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
          }
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Bad Request' }) });
        }

        if (pathname.includes('/auth/v1/user')) {
          const token = request.headers()['authorization']?.split('Bearer ')[1];
          const userId = token?.split('-access-token')[0];
          const user = Object.values(MOCK_USERS).find(u => u.id === userId);
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user || null) });
        }

        // --- Sessions ---
        if (pathname.includes('/rest/v1/sessions')) {
          if (request.method() === 'POST') {
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'mock-session-id', created_at: new Date().toISOString(), duration: 0 }) });
          }
          if (request.method() === 'GET') {
            const sessions = options.usageExceeded
              ? [{ id: 1, duration: 1800, created_at: new Date().toISOString(), user_id: 'free-user-id' }]
              : [];
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) });
          }
          return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        }

        // --- RPC get_user_details ---
        if (pathname.includes('/rest/v1/rpc/get_user_details')) {
          const token = request.headers()['authorization']?.split('Bearer ')[1];
          const userId = token?.split('-access-token')[0];
          const user = Object.values(MOCK_USERS).find(u => u.id === userId);
          const userDetails = user
            ? [{
                id: user.id,
                email: user.email,
                subscription_status: user.user_metadata.subscription_status,
                preferred_mode: user.user_metadata.preferred_mode || 'cloud',
              }]
            : [];
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userDetails) });
        }

        // --- User Profiles ---
        if (pathname.includes('/rest/v1/user_profiles')) {
          if (request.method() === 'GET') {
            const idParam = url.searchParams.get('id')?.replace('eq.', '');
            const user = Object.values(MOCK_USERS).find(u => u.id === idParam);
            const profile: Partial<UserProfile> = user ? { id: user.id, subscription_status: user.user_metadata.subscription_status } : {};
            if (options.forceOnDevice) {
              profile.preferred_mode = 'on-device';
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([profile]) });
          }
          return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        }

        // Catch-all for unmatched Supabase paths
        console.warn(`[UNMOCKED] Supabase request: ${url.href}`);
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Not Found in Mock: ${url.href}` }) });
      }

      // 2️⃣ Block unwanted external domains
      if (BLOCKED_DOMAINS.some(d => hostname.endsWith(d))) {
        console.log(`[BLOCKED] ${hostname}`);
        return route.abort('connectionrefused');
      }

      // 3️⃣ Allow all other requests to continue
      return route.continue();
    } catch (err) {
      console.error('Error in route handler:', err);
      return route.abort();
    }
  });
}
