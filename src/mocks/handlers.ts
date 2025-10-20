import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Session, User } from '@supabase/supabase-js';

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

function createMockUser(userData: { id: string; email: string; }): User {
    const now = new Date().toISOString();
    return {
        id: userData.id,
        email: userData.email,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { subscription_status: 'free' },
        aud: 'authenticated',
        role: 'authenticated',
        created_at: now,
        updated_at: now,
    };
}


export const handlers: RequestHandler[] = [
  // Mock for session validation
  http.get('*/auth/v1/user', ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.includes('mock-access-token')) {
        const mockUser = createMockUser({ id: 'smoke-test-user-id', email: 'smoke-test-user@example.com' });
        return HttpResponse.json(mockUser);
    }
    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),

  // Mock for user sign-up
  http.post('*/auth/v1/signup', async ({ request }) => {
    const { email } = await request.json() as { email: string };

    if (email === 'existing-user@example.com') {
      // FIX: Return a structure that the Supabase client will interpret as an error.
      // The key is the 'message' property.
      return HttpResponse.json(
        { "message": "User already registered" },
        { status: 400 }
      );
    }

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

    let email = 'fallback-user@example.com';
    if (userId) {
      email = `${userId.replace('-id', '')}@example.com`;
    }

    const profile = {
      id: userId || 'fallback-id',
      name: 'Test User',
      email,
      subscription_status: email.includes('pro') ? 'pro' : 'free',
    };

    if (request.headers.get('Accept') === 'application/vnd.pgrst.object+json') {
      return HttpResponse.json(profile);
    }
    return HttpResponse.json([profile]);
  }),
];
