// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

const MOCK_USER_ID = 'e7a27341-3333-4f58-9411-92a881792634';
const EXISTING_USER_EMAIL = 'existing-user@example.com';

export const handlers = [
  // --- Supabase Auth ---
  // This handler simulates user sign-in.
  http.post('*/auth/v1/token', async ({ request }) => {
    const body = (await request.json()) as { email?: string; grant_type?: string };

    // This is a password-based sign-in.
    return HttpResponse.json({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: {
        id: MOCK_USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        email: body.email,
        app_metadata: { provider: 'email' },
        user_metadata: { subscription_status: 'free' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  // This handler simulates user sign-up.
  http.post('*/auth/v1/signup', async ({ request }) => {
    const body = (await request.json()) as { email?: string };

    // Simulate the case where the user already exists.
    if (body.email === EXISTING_USER_EMAIL) {
      return HttpResponse.json(
        { msg: 'User already registered', code: 400 },
        { status: 400 },
      );
    }

    // Simulate a successful sign-up for a new user.
    return HttpResponse.json({
      id: MOCK_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: body.email,
      app_metadata: { provider: 'email' },
      user_metadata: { subscription_status: 'free' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }),

  // --- Supabase DB ---
  http.get('*/rest/v1/user_profiles', ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id')?.replace('eq.', '');
    const isSingleObjectRequest = request.headers.get('Accept') === 'application/vnd.pgrst.object+json';

    if (!userId) {
      // Return a generic empty array if no user ID is specified.
      return HttpResponse.json([]);
    }

    // Dynamically create the user profile based on the requested ID.
    const subscription_status = userId === 'mock-user-id-pro' ? 'pro' : 'free';
    const userProfile = {
      id: userId,
      subscription_status: subscription_status,
      preferred_mode: 'cloud',
      email: `mock-${userId}@example.com`,
    };

    if (isSingleObjectRequest) {
      return HttpResponse.json(userProfile);
    }

    return HttpResponse.json([userProfile]);
  }),

  // Generic catch-all for other session-related calls that tests might trigger
  http.post('*/rest/v1/sessions', () => {
    return HttpResponse.json({ id: 'mock-session-id' }, { status: 201 });
  }),
];