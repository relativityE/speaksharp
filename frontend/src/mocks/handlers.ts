import { http, HttpResponse, type RequestHandler } from 'msw';
import { createMockSession, createMockUserProfile, createMockUser } from './test-user-utils';


export const handlers: RequestHandler[] = [
  http.get('*/auth/v1/user', () => {
    console.log('[MSW DEBUG] Intercepted: GET /auth/v1/user');
    // This handler is less important when using programmatic login,
    // but we keep it for completeness.
    const user = createMockUser();
    return HttpResponse.json(user);
  }),

  http.post('*/auth/v1/signup', async () => {
    console.log('[MSW DEBUG] Intercepted: POST /auth/v1/signup');
    const session = createMockSession();
    return HttpResponse.json(session);
  }),

  http.post('*/auth/v1/token', async () => {
    console.log('[MSW DEBUG] Intercepted: POST /auth/v1/token');
    const session = createMockSession();
    return HttpResponse.json(session);
  }),

  // This is the critical handler. It must return a profile that is
  // consistent with the one created by the AuthProvider mock.
  http.get('*/rest/v1/user_profiles', ({ request }) => {
    console.log('[MSW DEBUG] Intercepted: GET /rest/v1/user_profiles');
    const profile = createMockUserProfile();

    // The Supabase client uses this header to request a single object vs. an array.
    if (request.headers.get('Accept') === 'application/vnd.pgrst.object+json') {
      console.log('[MSW DEBUG] Returning single user_profile object');
      return HttpResponse.json(profile);
    }
    console.log('[MSW DEBUG] Returning user_profiles array');
    return HttpResponse.json([profile]);
  }),

  http.get('*/rest/v1/sessions', () => {
    console.log('[MSW DEBUG] Intercepted: GET /rest/v1/sessions');
    const mockSessionHistory = [
      {
        id: 'session-1',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        duration: 300, // 5 minutes
        transcript: 'This is a test transcript with some um filler words and uh pauses.',
        title: 'Practice Session 1',
        total_words: 150,
        accuracy: 0.92,
        filler_words: {
          um: { count: 3 },
          uh: { count: 2 },
          like: { count: 1 },
          total: { count: 6 }
        },
        clarity_score: 95,
        articulation_score: 90,
        pace_score: 85,
        volume_score: 80,
      },
      {
        id: 'session-2',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        duration: 420, // 7 minutes
        transcript: 'Another practice session transcript.',
        title: 'Practice Session 2',
        total_words: 200,
        accuracy: 0.88,
        filler_words: {
          um: { count: 5 },
          uh: { count: 3 },
          like: { count: 2 },
          total: { count: 10 }
        },
        clarity_score: 88,
        articulation_score: 85,
        pace_score: 82,
        volume_score: 78,
      },
    ];
    return HttpResponse.json(mockSessionHistory);
  }),
];
