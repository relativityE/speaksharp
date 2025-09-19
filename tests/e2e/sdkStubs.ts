// sdkStubs.ts
import { Page, Route } from '@playwright/test';
import { randomUUID } from 'crypto';

// --- Blocked external domains ---
const BLOCKED_DOMAINS = [
  'sentry.io',
  'posthog.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
];

// --- Mock Users ---
interface UserProfile {
  id: string;
  subscription_status: 'pro' | 'free';
  preferred_mode?: 'on-device' | 'cloud';
}

interface UserMetadata {
  subscription_status: 'pro' | 'free';
  preferred_mode?: 'on-device' | 'cloud';
}

interface MockUser {
  id: string;
  email: string;
  user_metadata: UserMetadata;
  aud: 'authenticated';
  role: 'authenticated';
}

const MOCK_USERS: Record<string, MockUser> = {};

function getOrCreateMockUser(email: string): MockUser {
  if (MOCK_USERS[email]) return MOCK_USERS[email];

  const subscription_status = (email.split('@')[0] || 'free') as 'pro' | 'free';
  const newUser: MockUser = {
    id: `user_${randomUUID()}`,
    email,
    user_metadata: { subscription_status },
    aud: 'authenticated',
    role: 'authenticated',
  };

  MOCK_USERS[email] = newUser;
  return newUser;
}

function getMockSession(user?: MockUser) {
  if (!user) return null;
  return {
    access_token: `${user.id}-access-token`,
    refresh_token: `${user.id}-refresh-token`,
    user,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
}

// --- Main Stubbing Function ---
export async function stubThirdParties(page: Page, options: { usageExceeded?: boolean; forceOnDevice?: boolean } = {}) {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const hostname = url.hostname;
    const pathname = url.pathname;

    try {
      // 1️⃣ Supabase mocks — match ANY supabase.co project
      if (hostname.endsWith('.supabase.co')) {
        console.log('[MOCKING]', url.href);

        // --- Auth: token ---
        if (pathname.includes('/auth/v1/token')) {
          const postData = request.postDataJSON() as { email?: string; refresh_token?: string };
          let user: MockUser | undefined;

          if (postData?.email) {
            user = getOrCreateMockUser(postData.email);
          } else if (postData?.refresh_token) {
            const userId = postData.refresh_token.split('-refresh-token')[0];
            user = Object.values(MOCK_USERS).find(u => u.id === userId);
          }

          const session = getMockSession(user);
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(session),
          });
        }

        // --- Auth: user ---
        if (pathname.includes('/auth/v1/user')) {
          const token = request.headers()['authorization']?.split('Bearer ')[1];
          const userId = token?.split('-access-token')[0];
          const user = Object.values(MOCK_USERS).find(u => u.id === userId);
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(user || null),
          });
        }

        // --- Sessions ---
        if (pathname.includes('/rest/v1/sessions')) {
          if (request.method() === 'POST') {
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify({ id: 'mock-session-id', created_at: new Date().toISOString(), duration: 0 }),
            });
          }
          if (request.method() === 'GET') {
            const sessions = options.usageExceeded
              ? [{ id: 1, duration: 1800, created_at: new Date().toISOString(), user_id: 'free-user-id' }]
              : [];
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(sessions),
            });
          }
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
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(userDetails),
          });
        }

        // --- User Profiles ---
        if (pathname.includes('/rest/v1/user_profiles') && request.method() === 'GET') {
          const idParam = url.searchParams.get('id')?.replace('eq.', '');
          const user = Object.values(MOCK_USERS).find(u => u.id === idParam);

          // Ensure consistent runtime shape
          const profile: UserProfile = user
            ? {
                id: user.id,
                subscription_status: user.user_metadata.subscription_status ?? 'free',
                preferred_mode: user.user_metadata.preferred_mode ?? 'cloud',
              }
            : { id: 'unknown', subscription_status: 'free', preferred_mode: 'cloud' };

          if (options.forceOnDevice) {
            profile.preferred_mode = 'on-device';
          }

          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(profile), // .single() expects an object, not an array of one
          });
        }

        console.warn(`[UNMOCKED] Supabase request: ${url.href}`);
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Not Found in Mock: ${url.href}` }) });
      }

      // 2️⃣ Mock Stripe
      if (hostname.endsWith('stripe.com')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: '/* Mock Stripe.js */',
        });
      }

      // 3️⃣ Block unwanted external domains
      if (BLOCKED_DOMAINS.some(d => hostname.endsWith(d))) {
        console.log(`[BLOCKED] ${hostname}`);
        return route.abort('connectionrefused');
      }

      // 4️⃣ Allow everything else
      return route.continue();
    } catch (err) {
      console.error('Error in route handler:', err);
      return route.abort();
    }
  });
}
