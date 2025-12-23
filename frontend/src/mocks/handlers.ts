import { http, HttpResponse, type RequestHandler } from 'msw';
import { createMockSession, createMockUserProfile, createMockUser } from './test-user-utils';

// Pre-populated custom vocabulary store with technical terms
const mockVocabularyStore: Map<string, Array<{ id: string; user_id: string; word: string; created_at: string }>> = new Map([
  ['test-user-123', [
    { id: 'vocab-1', user_id: 'test-user-123', word: 'Kubernetes', created_at: new Date(Date.now() - 7 * 86400000).toISOString() },
    { id: 'vocab-2', user_id: 'test-user-123', word: 'microservices', created_at: new Date(Date.now() - 6 * 86400000).toISOString() },
    { id: 'vocab-3', user_id: 'test-user-123', word: 'CI/CD', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
    { id: 'vocab-4', user_id: 'test-user-123', word: 'serverless', created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: 'vocab-5', user_id: 'test-user-123', word: 'neural networks', created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'vocab-6', user_id: 'test-user-123', word: 'gradient descent', created_at: new Date(Date.now() - 1 * 86400000).toISOString() },
  ]]
]);

export const handlers: RequestHandler[] = [
  http.get('*/auth/v1/user', () => {
    console.log('[MSW DEBUG] Intercepted: GET /auth/v1/user');
    const user = createMockUser();

    // DEFENSIVE: Verify mock user was created
    if (!user) {
      console.error('[MSW CRITICAL] createMockUser() returned null/undefined!');
      return HttpResponse.json({ error: 'Mock user creation failed' }, { status: 500 });
    }
    if (!user.id) {
      console.error('[MSW CRITICAL] createMockUser() returned user without id!', user);
    }

    return HttpResponse.json(user);
  }),

  http.post('*/auth/v1/signup', async () => {
    console.log('[MSW DEBUG] Intercepted: POST /auth/v1/signup');
    const session = createMockSession();

    // DEFENSIVE: Verify mock session was created
    if (!session) {
      console.error('[MSW CRITICAL] createMockSession() returned null/undefined for signup!');
      return HttpResponse.json({ error: 'Mock session creation failed' }, { status: 500 });
    }
    if (!session.user) {
      console.error('[MSW CRITICAL] createMockSession() returned session without user!', session);
    }

    return HttpResponse.json(session);
  }),

  http.post('*/auth/v1/token', async () => {
    console.log('[MSW DEBUG] Intercepted: POST /auth/v1/token');
    const session = createMockSession();

    // DEFENSIVE: Verify mock session was created
    if (!session) {
      console.error('[MSW CRITICAL] createMockSession() returned null/undefined for token!');
      return HttpResponse.json({ error: 'Mock session creation failed' }, { status: 500 });
    }
    if (!session.access_token) {
      console.error('[MSW CRITICAL] createMockSession() returned session without access_token!', session);
    }

    return HttpResponse.json(session);
  }),

  // This is the critical handler. It must return a profile that is
  // consistent with the one created by the AuthProvider mock.
  http.get('*/rest/v1/user_profiles', ({ request }) => {
    console.log('[MSW DEBUG] Intercepted: GET /rest/v1/user_profiles');
    const profile = createMockUserProfile();

    // DEFENSIVE: Verify mock profile was created with required fields
    if (!profile) {
      console.error('[MSW CRITICAL] createMockUserProfile() returned null/undefined!');
      return HttpResponse.json({ error: 'Mock profile creation failed' }, { status: 500 });
    }
    if (!profile.id) {
      console.error('[MSW CRITICAL] createMockUserProfile() returned profile without id!', profile);
    }
    if (!profile.subscription_status) {
      console.error('[MSW WARNING] createMockUserProfile() returned profile without subscription_status!', profile);
    }

    // The Supabase client uses this header to request a single object vs. an array.
    if (request.headers.get('Accept') === 'application/vnd.pgrst.object+json') {
      console.log('[MSW DEBUG] Returning single user_profile object');
      return HttpResponse.json(profile);
    }
    console.log('[MSW DEBUG] Returning user_profiles array');
    return HttpResponse.json([profile]);
  }),

  http.get('*/rest/v1/sessions', ({ request }) => {
    console.log('[MSW DEBUG] Intercepted: GET /rest/v1/sessions');

    // Check window flag for empty sessions (E2E test control)
    const windowFlag = typeof window !== 'undefined' && '__E2E_EMPTY_SESSIONS__' in window && Boolean(window['__E2E_EMPTY_SESSIONS__' as keyof typeof window]);
    console.log('[MSW DEBUG] window.__E2E_EMPTY_SESSIONS__:', windowFlag);

    // Check if test wants empty sessions via custom header
    const emptyFlag = request.headers.get('x-e2e-empty-sessions') === 'true';
    console.log('[MSW DEBUG] x-e2e-empty-sessions header:', emptyFlag);

    if (windowFlag || emptyFlag) {
      console.log('[MSW DEBUG] Returning empty sessions array');
      return HttpResponse.json([]);
    }

    // Rich mock session data for analytics testing
    // Shows improvement trend over 5 sessions for trend analysis
    const mockSessionHistory = [
      {
        id: 'session-1',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
        duration: 180,
        transcript: 'Um, so today I wanted to talk about my presentation skills.',
        title: 'First Practice Session',
        total_words: 85,
        engine: 'Native',
        clarity_score: 72.5,
        wpm: 28.3,
        filler_words: {
          um: { count: 8, timestamps: [1.2, 5.4, 12.1, 18.3, 25.6, 32.1, 45.2, 58.9] },
          uh: { count: 6, timestamps: [3.1, 9.2, 22.4, 38.7, 52.1, 65.3] },
          like: { count: 4, timestamps: [7.8, 28.9, 41.2, 72.1] },
          'you know': { count: 2, timestamps: [15.4, 55.8] },
          total: { count: 20 }
        }
      },
      {
        id: 'session-2',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
        duration: 240,
        transcript: 'Today I practiced discussing REST APIs and, um, database schemas.',
        title: 'Technical Practice',
        total_words: 120,
        engine: 'Cloud AI',
        clarity_score: 78.2,
        wpm: 30.1,
        filler_words: {
          um: { count: 5, timestamps: [8.2, 22.4, 45.6, 78.2, 112.3] },
          uh: { count: 4, timestamps: [15.1, 38.9, 62.4, 95.1] },
          like: { count: 3, timestamps: [28.3, 55.7, 88.2] },
          'you know': { count: 1, timestamps: [72.4] },
          total: { count: 13 }
        }
      },
      {
        id: 'session-3',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
        duration: 300,
        transcript: 'In this session I focused on explaining Kubernetes orchestration and CI/CD pipelines.',
        title: 'DevOps Vocabulary Practice',
        total_words: 165,
        engine: 'On-Device',
        clarity_score: 85.0,
        wpm: 33.0,
        filler_words: {
          um: { count: 3, timestamps: [18.4, 62.1, 145.8] },
          uh: { count: 2, timestamps: [42.3, 98.7] },
          like: { count: 2, timestamps: [75.2, 188.4] },
          total: { count: 7 }
        }
      },
      {
        id: 'session-4',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
        duration: 420,
        transcript: 'Today I presented about machine learning algorithms including neural networks and gradient descent.',
        title: 'ML Presentation Practice',
        total_words: 245,
        engine: 'Cloud AI',
        clarity_score: 91.5,
        wpm: 35.0,
        filler_words: {
          um: { count: 2, timestamps: [55.2, 185.4] },
          uh: { count: 1, timestamps: [122.8] },
          like: { count: 1, timestamps: [298.1] },
          total: { count: 4 }
        }
      },
      {
        id: 'session-5',
        user_id: 'test-user-123',
        created_at: new Date().toISOString(),
        duration: 480,
        transcript: 'This was my most fluent session yet! I discussed cloud architecture, serverless computing, and how SpeakSharp has helped me become a more confident speaker.',
        title: 'Cloud Architecture Deep Dive',
        total_words: 320,
        engine: 'On-Device',
        clarity_score: 95.8,
        wpm: 40.0,
        filler_words: {
          um: { count: 1, timestamps: [142.5] },
          total: { count: 1 }
        }
      },
    ];
    return HttpResponse.json(mockSessionHistory);
  }),

  // Custom Vocabulary endpoints (STATEFUL with PostgREST parsing)
  http.get('*/rest/v1/custom_vocabulary*', ({ request }) => {
    const url = new URL(request.url);

    // PostgREST format: ?user_id=eq.test-user-123
    let userId = 'test-user-123'; // Default
    const userIdParam = url.searchParams.get('user_id');

    if (userIdParam) {
      // Remove PostgREST operators (eq., neq., gt., etc.)
      userId = userIdParam.replace(/^(eq|neq|gt|gte|lt|lte|like|ilike)\./, '');
    }

    const userWords = mockVocabularyStore.get(userId) || [];

    console.log('[MSW GET] URL:', url.toString());
    console.log('[MSW GET] user_id param:', userIdParam);
    console.log('[MSW GET] Parsed userId:', userId);
    console.log('[MSW GET] Returning', userWords.length, 'words:', userWords);

    return HttpResponse.json(userWords);
  }),

  http.post('*/rest/v1/custom_vocabulary*', async ({ request }) => {
    console.log('[MSW POST] Intercepted: POST /rest/v1/custom_vocabulary');
    const body = await request.json() as { word: string; user_id?: string };
    const userId = body.user_id || 'test-user-123';

    const newWord = {
      id: `mock-word-${Date.now()}`,
      user_id: userId,
      word: body.word,
      created_at: new Date().toISOString(),
    };

    // Add to stateful store
    const userWords = mockVocabularyStore.get(userId) || [];
    userWords.push(newWord);
    mockVocabularyStore.set(userId, userWords);

    console.log('[MSW POST] Word added:', newWord);
    console.log('[MSW POST] User now has', userWords.length, 'words');

    // Return single object (Supabase .single() format)
    return HttpResponse.json(newWord);
  }),

  http.delete('*/rest/v1/custom_vocabulary*', ({ request }) => {
    console.log('[MSW DELETE] Intercepted: DELETE /rest/v1/custom_vocabulary');
    const url = new URL(request.url);

    // PostgREST format: ?id=eq.mock-word-123
    const idParam = url.searchParams.get('id');
    const wordId = idParam?.replace(/^(eq|neq|gt|gte|lt|lte|like|ilike)\./, '');

    console.log('[MSW DELETE] Deleting word ID:', wordId);

    // Remove from store
    for (const [userId, words] of mockVocabularyStore.entries()) {
      const index = words.findIndex(w => w.id === wordId);
      if (index > -1) {
        words.splice(index, 1);
        mockVocabularyStore.set(userId, words);
        console.log('[MSW DELETE] Word removed from user:', userId);
        break;
      }
    }

    return new HttpResponse(null, { status: 204 });
  }),

  // User Goals endpoints
  http.get('*/rest/v1/user_goals*', () => {
    console.log('[MSW DEBUG] Intercepted: GET /rest/v1/user_goals');
    // Return default goals for test user
    return HttpResponse.json({
      user_id: 'test-user-123',
      weekly_goal: 5,
      clarity_goal: 90,
    });
  }),

  http.post('*/rest/v1/user_goals*', async ({ request }) => {
    console.log('[MSW DEBUG] Intercepted: POST /rest/v1/user_goals (upsert)');
    const body = await request.json();
    console.log('[MSW DEBUG] Upserted goals:', body);
    return HttpResponse.json(body);
  }),

  // Ghost RPC: create_session_and_update_usage
  http.post('*/rpc/create_session_and_update_usage', async ({ request }) => {
    console.log('[MSW DEBUG] Intercepted: RPC create_session_and_update_usage');
    const { p_session_data } = await request.json() as { p_session_data: Record<string, unknown> };

    const new_session = {
      ...p_session_data,
      id: `session-mock-${Date.now()}`,
      user_id: 'test-user-123',
      created_at: new Date().toISOString(),
    };

    console.log('[MSW RPC] Created new session:', new_session);

    return HttpResponse.json({
      new_session,
      usage_exceeded: false
    });
  }),

  // Edge Function: check-usage-limit
  http.post('*/functions/v1/check-usage-limit', () => {
    console.log('[MSW DEBUG] Intercepted: POST /functions/v1/check-usage-limit');
    // Return unlimited usage for test user (Pro tier simulation)
    return HttpResponse.json({
      allowed: true,
      remaining_minutes: 999,
      limit_minutes: 999,
      is_pro: true,
    });
  }),

  // ============================================================
  // CATCH-ALL HANDLERS (must be last - log unmocked endpoints)
  // ============================================================

  // Catch-all for unmocked Edge Functions
  http.all('*/functions/v1/*', ({ request }) => {
    const url = new URL(request.url);
    const functionName = url.pathname.split('/functions/v1/')[1];
    console.warn(`[MSW ⚠️ UNMOCKED FUNCTION] ${request.method} /functions/v1/${functionName}`);
    console.warn(`[MSW ⚠️] Add a handler for this Edge Function in handlers.ts to silence this warning`);
    // Return empty success to prevent test failures
    return HttpResponse.json({ _msw_unmocked: true, function: functionName });
  }),

  // Catch-all for unmocked REST API endpoints
  http.all('*/rest/v1/*', ({ request }) => {
    const url = new URL(request.url);
    const tableName = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    console.warn(`[MSW ⚠️ UNMOCKED TABLE] ${request.method} /rest/v1/${tableName}`);
    console.warn(`[MSW ⚠️] Add a handler for this table in handlers.ts to silence this warning`);
    // Return empty array for GET, empty object for others
    if (request.method === 'GET') {
      return HttpResponse.json([]);
    }
    return HttpResponse.json({ _msw_unmocked: true, table: tableName });
  }),
];

// Export reset function for test setup
export function resetMockVocabularyStore() {
  // Reset to pre-populated default state
  mockVocabularyStore.set('test-user-123', [
    { id: 'vocab-1', user_id: 'test-user-123', word: 'Kubernetes', created_at: new Date(Date.now() - 7 * 86400000).toISOString() },
    { id: 'vocab-2', user_id: 'test-user-123', word: 'microservices', created_at: new Date(Date.now() - 6 * 86400000).toISOString() },
    { id: 'vocab-3', user_id: 'test-user-123', word: 'CI/CD', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
    { id: 'vocab-4', user_id: 'test-user-123', word: 'serverless', created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: 'vocab-5', user_id: 'test-user-123', word: 'neural networks', created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'vocab-6', user_id: 'test-user-123', word: 'gradient descent', created_at: new Date(Date.now() - 1 * 86400000).toISOString() },
  ]);
  console.log('[MSW] Vocabulary store reset with pre-populated data');
}
