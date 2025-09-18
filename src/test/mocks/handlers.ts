// src/test/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

interface TokenRequestBody {
  grant_type: 'password' | 'refresh_token' | 'anonymous';
  email?: string;
}

interface SignupRequestBody {
  email?: string;
}

interface SessionRequestBody {
  [key: string]: unknown;
}

interface Metrics {
  words_per_minute: number;
  accuracy: number;
}

// Mock user profiles
const mockProfiles = {
  'user-123': { id: 'user-123', subscription_status: 'free' },
  'pro-user': { id: 'pro-user', subscription_status: 'pro' },
};

// Mock sessions
const mockSessions = [
  {
    id: 'session-1',
    user_id: 'user-123',
    session_duration: 300,
    created_at: '2024-01-01T00:00:00Z',
    metrics: { words_per_minute: 150, accuracy: 95 }
  }
];

export const handlers = [
  // Supabase Auth endpoints
  http.post('https://*.supabase.co/auth/v1/token', async ({ request }) => {
    const body = await request.json() as TokenRequestBody;

    if (body.grant_type === 'password') {
      // Sign in with email/password
      if (body.email === 'test@example.com' || body.email?.includes('example.com')) {
        return HttpResponse.json({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          user: {
            id: body.email.includes('pro') ? 'pro-user' : 'user-123',
            email: body.email,
            created_at: '2024-01-01T00:00:00Z'
          }
        });
      }

      // Invalid credentials
      return HttpResponse.json(
        { error: 'Invalid login credentials' },
        { status: 400 }
      );
    }

    if (body.grant_type === 'refresh_token') {
      // Refresh token
      return HttpResponse.json({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600
      });
    }

    return HttpResponse.json({ error: 'Unsupported grant type' }, { status: 400 });
  }),

  // Sign up
  http.post('https://*.supabase.co/auth/v1/signup', async ({ request }) => {
    const body = await request.json() as SignupRequestBody;

    if (body.email?.includes('existing@')) {
      return HttpResponse.json(
        { error: 'User already registered' },
        { status: 422 }
      );
    }

    return HttpResponse.json({
      user: {
        id: 'new-user-id',
        email: body.email,
        created_at: new Date().toISOString(),
        email_confirmed_at: null
      },
      session: null // Email confirmation required
    });
  }),

  // Password reset
  http.post('https://*.supabase.co/auth/v1/recover', () => {
    return HttpResponse.json({ message: 'Check your email for the confirmation link' });
  }),

  // Get current session (replaces the /user endpoint for getSession)
  http.get('https://*.supabase.co/auth/v1/session', () => {
    // For an unauthenticated user, getSession returns an empty session
    return HttpResponse.json({
      access_token: null,
      token_type: "bearer",
      expires_in: null,
      expires_at: null,
      refresh_token: null,
      user: null
    });
  }),

  // Sign out
  http.post('https://*.supabase.co/auth/v1/logout', () => {
    return HttpResponse.json({});
  }),

  // Database endpoints - User profiles
  http.get('https://*.supabase.co/rest/v1/user_profiles', ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id')?.replace('eq.', '');

    if (userId && mockProfiles[userId as keyof typeof mockProfiles]) {
      return HttpResponse.json([mockProfiles[userId as keyof typeof mockProfiles]]);
    }

    return HttpResponse.json([]);
  }),

  // Database endpoints - Sessions
  http.get('https://*.supabase.co/rest/v1/sessions', ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id')?.replace('eq.', '');

    const userSessions = mockSessions.filter(s => s.user_id === userId);
    return HttpResponse.json(userSessions);
  }),

  http.post('https://*.supabase.co/rest/v1/sessions', async ({ request }) => {
    const body = await request.json() as { session_duration: number, metrics: Metrics, user_id?: string };

    const newSession = {
      id: `session-${Date.now()}`,
      user_id: body.user_id || 'user-123',
      session_duration: body.session_duration,
      created_at: new Date().toISOString(),
      metrics: body.metrics,
    };

    mockSessions.push(newSession);
    return HttpResponse.json(newSession, { status: 201 });
  }),

  // Stripe endpoints (if needed)
  http.post('https://api.stripe.com/v1/checkout/sessions', () => {
    return HttpResponse.json({
      id: 'cs_mock_checkout_session',
      url: 'https://checkout.stripe.com/mock-url'
    });
  }),

  // Handle any other Supabase endpoints
  http.all('https://*.supabase.co/', ({ request }) => {
    console.warn(`Unhandled Supabase request: ${request.method} ${request.url}`);
    return HttpResponse.json({ error: 'Not implemented in mock' }, { status: 501 });
  }),
];

// Anonymous user handlers (for tests that don't require auth)
export const anonymousHandlers = [
  // Anonymous sign-in
  http.post('https://*.supabase.co/auth/v1/token', async ({ request }) => {
    const body = await request.json() as TokenRequestBody;

    if (body.grant_type === 'anonymous') {
      return HttpResponse.json({
        access_token: 'anon-access-token',
        refresh_token: 'anon-refresh-token',
        expires_in: 3600,
        user: {
          id: 'anon-user',
          email: null,
          created_at: new Date().toISOString(),
          is_anonymous: true
        }
      });
    }

    return HttpResponse.json({ error: 'Invalid grant type' }, { status: 400 });
  }),

  // Anonymous sessions storage
  http.post('https://*.supabase.co/rest/v1/anonymous_sessions', async ({ request }) => {
    const body = await request.json() as SessionRequestBody;

    return HttpResponse.json({
      id: `anon-session-${Date.now()}`,
      ...body,
      created_at: new Date().toISOString()
    }, { status: 201 });
  }),
];
