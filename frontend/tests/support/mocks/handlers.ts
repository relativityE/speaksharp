import { http, HttpResponse } from 'msw';

interface TokenRequestBody {
  grant_type: 'password' | 'refresh_token' | 'anonymous';
  email?: string;
}

interface SignupRequestBody {
  email?: string;
}


export const handlers = [
  http.post('https://*.supabase.co/auth/v1/token', async ({ request }) => {
    const body = await request.json() as TokenRequestBody;
    console.log(`[MSW] Auth token request for grant_type=${body.grant_type}`);

    if (body.grant_type === 'password') {
      const email = body.email || '';
      let userId: string | null = null;
      let subscription_status = 'free';

      if (email.includes('pro-user@test.com')) {
        userId = 'pro-user';
        subscription_status = 'pro';
      } else if (email.includes('free-user@test.com') || email === 'test-user-signin@example.com') {
        userId = 'mock-user-id-signin'; // Use a consistent ID
      }

      if (userId) {
        return HttpResponse.json({
          data: {
            session: {
              access_token: 'mock-access-token-signin',
              token_type: 'bearer',
              expires_in: 3600,
              refresh_token: 'mock-refresh-token',
              user: {
                id: userId,
                aud: 'authenticated',
                role: 'authenticated',
                email: email,
                user_metadata: { subscription_status },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            },
            user: {
              id: userId,
              aud: 'authenticated',
              role: 'authenticated',
              email: email,
              user_metadata: { subscription_status },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          }
        });
      }

      // Invalid credentials
      return HttpResponse.json(
        { error: 'Invalid login credentials', message: 'Invalid login credentials' },
        { status: 400 }
      );
    }

    return HttpResponse.json({ error: 'Unsupported grant type' }, { status: 400 });
  }),
  http.post('https://*.supabase.co/auth/v1/signup', async ({ request }) => {
    const body = await request.json() as SignupRequestBody;
    console.log(`[MSW] Sign-up request for ${body.email}`);

    if (body.email === 'existing-user@example.com') {
      return HttpResponse.json(
        { message: 'An account with this email already exists.', error: 'user_already_exists' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      data: {
        session: {
          access_token: 'mock-access-token-signup',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token-signup',
          user: {
            id: 'new-user-id-signup',
            aud: 'authenticated',
            role: 'authenticated',
            email: body.email,
            user_metadata: { subscription_status: 'free' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
        user: {
          id: 'new-user-id-signup',
          aud: 'authenticated',
          role: 'authenticated',
          email: body.email,
          user_metadata: { subscription_status: 'free' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      }
    });
  }),

  // Password reset
  http.post('https://*.supabase.co/auth/v1/recover', () => {
    return HttpResponse.json({ message: 'Check your email for the confirmation link' });
  }),

  // Get current session (replaces the /user endpoint for getSession)
  http.get('https://*.supabase.co/auth/v1/session', () => {
    return HttpResponse.json({ data: { session: null } });
  }),

  // Sign out
  http.post('https://*.supabase.co/auth/v1/logout', () => {
    return HttpResponse.json({});
  }),

  // Database endpoints - User profiles
  http.get('https://*.supabase.co/rest/v1/user_profiles', ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id')?.replace('eq.', '');
    const acceptHeader = request.headers.get('Accept') || '';

    const mockProfiles = {
      'user-123': { id: 'user-123', subscription_status: 'free' },
      'pro-user': { id: 'pro-user', subscription_status: 'pro' },
      'new-user-id-signup': {id: 'new-user-id-signup', subscription_status: 'free'},
      'mock-user-id': { id: 'mock-user-id', email: 'test@example.com', subscription_status: 'free' },
      'mock-user-id-signin': { id: 'mock-user-id-signin', subscription_status: 'free' },
    };

    const profile = userId ? mockProfiles[userId as keyof typeof mockProfiles] : null;

    if (profile) {
      if (acceptHeader.includes('application/vnd.pgrst.object+json')) {
        return HttpResponse.json(profile);
      }
      return HttpResponse.json([profile]);
    }

    if (acceptHeader.includes('application/vnd.pgrst.object+json')) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json([]);
  }),
  http.all('https://*.supabase.co/', ({ request }) => {
    console.error(`[MSW] Unhandled Supabase request: ${request.method} ${request.url}`);
    return HttpResponse.json({ error: 'Unhandled request' }, { status: 501 });
  }),

  // PostHog analytics - mock to prevent network errors
  http.all('https://mock.posthog.com/*', () => {
    return HttpResponse.json({ status: 'ok' });
  }),
];