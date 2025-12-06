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
];

// In-memory vocabulary store (module-level)
const mockVocabularyStore = new Map<string, Array<{
  id: string;
  user_id: string;
  word: string;
  created_at: string;
}>>;

// Export reset function for test setup
export function resetMockVocabularyStore() {
  mockVocabularyStore.clear();
  console.log('[MSW] Vocabulary store reset');
}
