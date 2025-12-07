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

    // Rich mock session data for analytics testing
    // Shows improvement trend over 5 sessions for trend analysis
    const mockSessionHistory = [
      {
        id: 'session-1',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 7 * 86400000).toISOString(), // 7 days ago
        duration: 180, // 3 minutes - beginner session
        transcript: 'Um, so today I wanted to, uh, talk about my presentation skills. Like, I think I need to, um, practice more with, uh, technical terms like API and microservices.',
        title: 'First Practice Session',
        total_words: 85,
        words_per_minute: 28,
        accuracy: 0.72,
        filler_words: {
          um: { count: 8, timestamps: [1.2, 5.4, 12.1, 18.3, 25.6, 32.1, 45.2, 58.9] },
          uh: { count: 6, timestamps: [3.1, 9.2, 22.4, 38.7, 52.1, 65.3] },
          like: { count: 4, timestamps: [7.8, 28.9, 41.2, 72.1] },
          'you know': { count: 2, timestamps: [15.4, 55.8] },
          total: { count: 20 }
        },
        clarity_score: 65,
        articulation_score: 60,
        pace_score: 55,
        volume_score: 70,
        pauses: { count: 12, avg_duration: 1.8 },
        topics: ['presentation', 'public speaking', 'technical terms']
      },
      {
        id: 'session-2',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 5 * 86400000).toISOString(), // 5 days ago
        duration: 240, // 4 minutes
        transcript: 'Today I practiced discussing REST APIs and, um, database schemas. I think my pacing is, uh, getting better but I still use too many filler words.',
        title: 'Technical Practice',
        total_words: 120,
        words_per_minute: 30,
        accuracy: 0.78,
        filler_words: {
          um: { count: 5, timestamps: [8.2, 22.4, 45.6, 78.2, 112.3] },
          uh: { count: 4, timestamps: [15.1, 38.9, 62.4, 95.1] },
          like: { count: 3, timestamps: [28.3, 55.7, 88.2] },
          'you know': { count: 1, timestamps: [72.4] },
          total: { count: 13 }
        },
        clarity_score: 72,
        articulation_score: 70,
        pace_score: 68,
        volume_score: 75,
        pauses: { count: 8, avg_duration: 1.4 },
        topics: ['REST API', 'database', 'technical vocabulary']
      },
      {
        id: 'session-3',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 3 * 86400000).toISOString(), // 3 days ago
        duration: 300, // 5 minutes
        transcript: 'In this session I focused on explaining Kubernetes orchestration and CI/CD pipelines. My confidence with these DevOps terms is improving.',
        title: 'DevOps Vocabulary Practice',
        total_words: 165,
        words_per_minute: 33,
        accuracy: 0.85,
        filler_words: {
          um: { count: 3, timestamps: [18.4, 62.1, 145.8] },
          uh: { count: 2, timestamps: [42.3, 98.7] },
          like: { count: 2, timestamps: [75.2, 188.4] },
          total: { count: 7 }
        },
        clarity_score: 80,
        articulation_score: 78,
        pace_score: 75,
        volume_score: 82,
        pauses: { count: 5, avg_duration: 1.1 },
        topics: ['Kubernetes', 'CI/CD', 'DevOps']
      },
      {
        id: 'session-4',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 1 * 86400000).toISOString(), // 1 day ago
        duration: 420, // 7 minutes
        transcript: 'Today I presented about machine learning algorithms including neural networks and gradient descent. I feel much more comfortable with the technical terminology now.',
        title: 'ML Presentation Practice',
        total_words: 245,
        words_per_minute: 35,
        accuracy: 0.91,
        filler_words: {
          um: { count: 2, timestamps: [55.2, 185.4] },
          uh: { count: 1, timestamps: [122.8] },
          like: { count: 1, timestamps: [298.1] },
          total: { count: 4 }
        },
        clarity_score: 87,
        articulation_score: 88,
        pace_score: 84,
        volume_score: 86,
        pauses: { count: 3, avg_duration: 0.8 },
        topics: ['machine learning', 'neural networks', 'algorithms']
      },
      {
        id: 'session-5',
        user_id: 'test-user-123',
        created_at: new Date().toISOString(), // Today
        duration: 480, // 8 minutes - best session
        transcript: 'This was my most fluent session yet! I discussed cloud architecture, serverless computing, and how SpeakSharp has helped me become a more confident speaker. The custom vocabulary feature really helped with the technical terms.',
        title: 'Cloud Architecture Deep Dive',
        total_words: 320,
        words_per_minute: 40,
        accuracy: 0.95,
        filler_words: {
          um: { count: 1, timestamps: [142.5] },
          total: { count: 1 }
        },
        clarity_score: 94,
        articulation_score: 92,
        pace_score: 91,
        volume_score: 88,
        pauses: { count: 2, avg_duration: 0.6 },
        topics: ['cloud architecture', 'serverless', 'AWS']
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
