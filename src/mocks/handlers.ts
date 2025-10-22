import { http, HttpResponse, type RequestHandler } from 'msw';
import { createMockSession, createMockUserProfile, createMockUser } from './test-user-utils';

export const handlers: RequestHandler[] = [
  http.get('*/auth/v1/user', ({ request: _request }) => {
    // This handler is less important when using programmatic login,
    // but we keep it for completeness.
    const user = createMockUser();
    return HttpResponse.json(user);
  }),

  http.post('*/auth/v1/signup', async ({ request: _request }) => {
    const session = createMockSession();
    return HttpResponse.json(session);
  }),

  http.post('*/auth/v1/token', async ({ request: _request }) => {
    const session = createMockSession();
    return HttpResponse.json(session);
  }),

  // This is the critical handler. It must return a profile that is
  // consistent with the one created by the AuthProvider mock.
  http.get('*/rest/v1/user_profiles', ({ request }) => {
    const profile = createMockUserProfile();

    // The Supabase client uses this header to request a single object vs. an array.
    if (request.headers.get('Accept') === 'application/vnd.pgrst.object+json') {
      return HttpResponse.json(profile);
    }
    return HttpResponse.json([profile]);
  }),

  http.get('*/rest/v1/sessions', () => {
    return HttpResponse.json([]);
  }),
];
