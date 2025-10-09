import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Session } from '@supabase/supabase-js';

/**
 * Creates a realistic, structurally-correct mock Supabase session object.
 * @param {object} userData - The user data to embed in the session.
 * @returns {Session} A complete mock session object.
 */
function createMockSession(userData: { id: string; email: string; }): Session {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `mock-access-token-${now}`,
    refresh_token: `mock-refresh-token-${now}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: userData.id,
      email: userData.email,
      app_metadata: {
        provider: 'email',
        providers: ['email'],
      },
      user_metadata: {
        subscription_status: 'free',
      },
      aud: 'authenticated',
      role: 'authenticated',
      created_at: new Date(now * 1000).toISOString(),
      updated_at: new Date(now * 1000).toISOString(),
    },
  };
}

export const handlers: RequestHandler[] = [
  // Mock for user sign-up
  http.post('*/auth/v1/signup', async ({ request }) => {
    const { email } = await request.json() as { email: string };

    if (email === 'existing-user@example.com') {
      return HttpResponse.json(
        { message: 'User already registered', code: '422' },
        { status: 422 }
      );
    }

    // For any other email, simulate successful sign-up by returning a session
    const session = createMockSession({
      id: `new-user-${Date.now()}`,
      email: email,
    });
    return HttpResponse.json(session);
  }),

  // Mock for user sign-in
  http.post('*/auth/v1/token', async ({ request }) => {
    const { email } = await request.json() as { email: string };
    const session = createMockSession({
      id: `test-user-id-${email}`,
      email: email,
    });
    return HttpResponse.json(session);
  }),

  // Mock for fetching a user profile.
  http.get('*/rest/v1/user_profiles', ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id')?.replace('eq.', '');

    const profile = {
      id: userId || 'fallback-id',
      name: 'Test User',
      email: `${userId || 'test'}@example.com`,
      subscription_status: 'free',
    };

    // Supabase .single() requests this header. We must return an object, not an array.
    if (request.headers.get('Accept') === 'application/vnd.pgrst.object+json') {
      return HttpResponse.json(profile);
    }
    return HttpResponse.json([profile]);
  }),
];