import { http, HttpResponse, type RequestHandler } from 'msw';
import logger from '@/lib/logger';
import { createMockSession, createMockUserProfile, createMockUser } from './test-user-utils';
import { MOCK_SESSION_HISTORY } from '@shared/test-fixtures';

interface MockVocabularyWord {
  id: string;
  user_id: string;
  word: string;
  created_at: string;
}

/**
 * Flexible session interface for mocks.
 * Extends PracticeSession but allows extra properties in filler_words (like timestamps)
 * to satisfy both the mock data and the application's type requirements.
 */
interface MockPracticeSession {
  id: string;
  user_id: string;
  created_at: string;
  [key: string]: unknown;
}

// Stateful stores with persistence
const mockVocabularyStore: Map<string, MockVocabularyWord[]> = new Map();
const mockSessionStore: Map<string, MockPracticeSession[]> = new Map();

// IndexedDB persistence helper
const DB_NAME = 'MSW_PERSISTENCE';
const STORE_NAME = 'stores';

const openDB = () => {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const saveToDB = async (key: string, value: Record<string, unknown[]>) => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        logger.error({ err, key }, '[MSW DB] Save failed');
    }
};

const loadFromDB = async (key: string) => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        return new Promise<Record<string, unknown[]> | null>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(tx.error);
        });
    } catch (err) {
        logger.error({ err, key }, '[MSW DB] Load failed');
        return null;
    }
};

// Initialize stores from DB or defaults
const initializeStores = async () => {
    const vocab = await loadFromDB('vocabulary');
    if (vocab) {
        for (const [k, v] of Object.entries(vocab)) mockVocabularyStore.set(k, v as MockVocabularyWord[]);
    } else {
        // Initial Seed
        mockVocabularyStore.set('test-user-123', [
            { id: 'vocab-1', user_id: 'test-user-123', word: 'Kubernetes', created_at: new Date(Date.now() - 7 * 86400000).toISOString() },
            { id: 'vocab-2', user_id: 'test-user-123', word: 'microservices', created_at: new Date(Date.now() - 6 * 86400000).toISOString() },
            { id: 'vocab-3', user_id: 'test-user-123', word: 'CI/CD', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
            { id: 'vocab-4', user_id: 'test-user-123', word: 'serverless', created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
            { id: 'vocab-5', user_id: 'test-user-123', word: 'neural networks', created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
            { id: 'vocab-6', user_id: 'test-user-123', word: 'gradient descent', created_at: new Date(Date.now() - 1 * 86400000).toISOString() },
        ]);
        await saveToDB('vocabulary', Object.fromEntries(mockVocabularyStore));
    }

    const sessions = await loadFromDB('sessions');
    if (sessions) {
        for (const [k, v] of Object.entries(sessions)) mockSessionStore.set(k, v as MockPracticeSession[]);
    } else {
        // Initial Seed
        mockSessionStore.set('test-user-123', [...MOCK_SESSION_HISTORY]);
        await saveToDB('sessions', Object.fromEntries(mockSessionStore));
    }
    logger.info('[MSW] Stores initialized and persisted');
};

// Run initialization
void initializeStores();

export const handlers: RequestHandler[] = [
  http.get('*/auth/v1/user', () => {
    logger.info('[MSW DEBUG] Intercepted: GET /auth/v1/user');
    const user = createMockUser();

    // DEFENSIVE: Verify mock user was created
    if (!user) {
      logger.error('[MSW CRITICAL] createMockUser() returned null/undefined!');
      return HttpResponse.json({ error: 'Mock user creation failed' }, { status: 500 });
    }
    if (!user.id) {
      logger.error({ user }, '[MSW CRITICAL] createMockUser() returned user without id!');
    }

    return HttpResponse.json(user);
  }),

  http.post('*/auth/v1/signup', async () => {
    logger.info('[MSW DEBUG] Intercepted: POST /auth/v1/signup');
    const session = createMockSession();

    // DEFENSIVE: Verify mock session was created
    if (!session) {
      logger.error('[MSW CRITICAL] createMockSession() returned null/undefined for signup!');
      return HttpResponse.json({ error: 'Mock session creation failed' }, { status: 500 });
    }
    if (!session.user) {
      logger.error({ session }, '[MSW CRITICAL] createMockSession() returned session without user!');
    }

    return HttpResponse.json(session);
  }),

  http.post('*/auth/v1/token', async () => {
    logger.info('[MSW DEBUG] Intercepted: POST /auth/v1/token');
    const session = createMockSession();

    // DEFENSIVE: Verify mock session was created
    if (!session) {
      logger.error('[MSW CRITICAL] createMockSession() returned null/undefined for token!');
      return HttpResponse.json({ error: 'Mock session creation failed' }, { status: 500 });
    }
    if (!session.access_token) {
      logger.error({ session }, '[MSW CRITICAL] createMockSession() returned session without access_token!');
    }

    return HttpResponse.json(session);
  }),

  // This is the critical handler. It must return a profile that is
  // consistent with the one created by the AuthProvider mock.
  http.get('*/rest/v1/user_profiles', ({ request }) => {
    logger.info('[MSW DEBUG] Intercepted: GET /rest/v1/user_profiles');
    const profile = createMockUserProfile();

    // DEFENSIVE: Verify mock profile was created with required fields
    if (!profile) {
      logger.error('[MSW CRITICAL] createMockUserProfile() returned null/undefined!');
      return HttpResponse.json({ error: 'Mock profile creation failed' }, { status: 500 });
    }
    if (!profile.id) {
      logger.error({ profile }, '[MSW CRITICAL] createMockUserProfile() returned profile without id!');
    }
    if (!profile.subscription_status) {
      logger.warn({ profile }, '[MSW WARNING] createMockUserProfile() returned profile without subscription_status!');
    }

    // The Supabase client uses this header to request a single object vs. an array.
    if (request.headers.get('Accept') === 'application/vnd.pgrst.object+json') {
      logger.info('[MSW DEBUG] Returning single user_profile object');
      return HttpResponse.json(profile);
    }
    logger.info('[MSW DEBUG] Returning user_profiles array');
    return HttpResponse.json([profile]);
  }),

  http.head('*/rest/v1/sessions', ({ request: _request }) => {
    logger.info('[MSW DEBUG] Intercepted: HEAD /rest/v1/sessions');
    const userId = 'test-user-123';
    const sessions = mockSessionStore.get(userId) || [];
    const count = sessions.length;

    return new HttpResponse(null, {
      status: 200,
      headers: {
        'Content-Range': `0-${Math.max(0, count - 1)}/${count}`,
        'Content-Type': 'application/json',
      },
    });
  }),

  http.get('*/rest/v1/sessions', ({ request }) => {
    logger.info('[MSW DEBUG] Intercepted: GET /rest/v1/sessions');

    // Check window flag for empty sessions (E2E test control)
    const windowFlag = typeof window !== 'undefined' && (window as unknown as { __E2E_EMPTY_SESSIONS__?: boolean }).__E2E_EMPTY_SESSIONS__;
    logger.info({ windowFlag }, '[MSW DEBUG] window.__E2E_EMPTY_SESSIONS__');

    // Check if test wants empty sessions via custom header
    const emptyFlag = request.headers.get('x-e2e-empty-sessions') === 'true';
    logger.info({ emptyFlag }, '[MSW DEBUG] x-e2e-empty-sessions header');

    if (windowFlag || emptyFlag) {
      logger.info('[MSW DEBUG] Returning empty sessions array');
      return HttpResponse.json([]);
    }

    const userId = 'test-user-123';
    const sessions = mockSessionStore.get(userId) || [];

    // Rich mock session data for analytics testing
    return HttpResponse.json(sessions);
  }),

  http.patch('*/rest/v1/sessions*', async ({ request }) => {
    logger.info('[MSW DEBUG] Intercepted: PATCH /rest/v1/sessions');
    const url = new URL(request.url);
    const idParam = url.searchParams.get('id');
    const sessionId = idParam?.replace(/^(eq|neq|gt|gte|lt|lte|like|ilike)\./, '');
    const body = await request.json() as Partial<MockPracticeSession>;

    const userId = 'test-user-123';
    const sessions = mockSessionStore.get(userId) || [];
    const index = sessions.findIndex(s => s.id === sessionId);

    if (index > -1) {
      sessions[index] = { ...sessions[index], ...body };
      mockSessionStore.set(userId, sessions);
      await saveToDB('sessions', Object.fromEntries(mockSessionStore));
      logger.info({ sessionId, updatedSession: sessions[index] }, '[MSW PATCH] Session updated');
      return new HttpResponse(null, { status: 204 });
    }

    logger.warn({ sessionId }, '[MSW PATCH] Session not found for update');
    return new HttpResponse(null, { status: 404 });
  }),

  // User Filler Words endpoints (STATEFUL with PostgREST parsing)
  http.get('*/rest/v1/user_filler_words*', ({ request }) => {
    const url = new URL(request.url);

    // PostgREST format: ?user_id=eq.test-user-123
    let userId = 'test-user-123'; // Default
    const userIdParam = url.searchParams.get('user_id');

    if (userIdParam) {
      // Remove PostgREST operators (eq., neq., gt., etc.)
      userId = userIdParam.replace(/^(eq|neq|gt|gte|lt|lte|like|ilike)\./, '');
    }

    const userWords = mockVocabularyStore.get(userId) || [];

    logger.info({ url: url.toString(), userIdParam, userId }, '[MSW GET] user_filler_words');
    logger.info({ wordCount: userWords.length, userWords }, '[MSW GET] Returning words');

    return HttpResponse.json(userWords);
  }),

  http.post('*/rest/v1/user_filler_words*', async ({ request }) => {
    logger.info('[MSW POST] Intercepted: POST /rest/v1/user_filler_words');
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
    await saveToDB('vocabulary', Object.fromEntries(mockVocabularyStore));

    logger.info({ newWord }, '[MSW POST] Word added');
    logger.info({ userWordCount: userWords.length }, '[MSW POST] User word count updated');

    // Return single object (Supabase .single() format)
    return HttpResponse.json(newWord);
  }),

  http.delete('*/rest/v1/user_filler_words*', async ({ request }) => {
    logger.info('[MSW DELETE] Intercepted: DELETE /rest/v1/user_filler_words');
    const url = new URL(request.url);

    // PostgREST format: ?id=eq.mock-word-123
    const idParam = url.searchParams.get('id');
    const wordId = idParam?.replace(/^(eq|neq|gt|gte|lt|lte|like|ilike)\./, '');

    logger.info({ wordId }, '[MSW DELETE] Deleting word ID');

    // Remove from store
    for (const [userId, words] of mockVocabularyStore.entries()) {
      const index = words.findIndex(w => w.id === wordId);
      if (index > -1) {
        words.splice(index, 1);
        mockVocabularyStore.set(userId, words);
        await saveToDB('vocabulary', Object.fromEntries(mockVocabularyStore));
        logger.info({ userId }, '[MSW DELETE] Word removed from user');
        break;
      }
    }

    return new HttpResponse(null, { status: 204 });
  }),

  // User Goals endpoints
  http.get('*/rest/v1/user_goals*', () => {
    logger.info('[MSW DEBUG] Intercepted: GET /rest/v1/user_goals');
    // Return default goals for test user
    return HttpResponse.json({
      user_id: 'test-user-123',
      weekly_goal: 5,
      clarity_goal: 90,
    });
  }),

  http.post('*/rest/v1/user_goals*', async ({ request }) => {
    logger.info('[MSW DEBUG] Intercepted: POST /rest/v1/user_goals (upsert)');
    const body = await request.json();
    logger.info({ body }, '[MSW DEBUG] Upserted goals');
    return HttpResponse.json(body);
  }),

  // Ghost RPC: create_session_and_update_usage
  http.post('*/rpc/create_session_and_update_usage', async ({ request }) => {
    logger.info('[MSW DEBUG] Intercepted: RPC create_session_and_update_usage');
    const { p_session_data } = await request.json() as { p_session_data: Record<string, unknown> };

    const userId = 'test-user-123';
    const new_session: MockPracticeSession = {
      ...(p_session_data as unknown as MockPracticeSession),
      id: `session-mock-${Date.now()}`,
      user_id: userId,
      created_at: new Date().toISOString(),
    };

    // PERSIST: Add to stateful session store
    const sessions = mockSessionStore.get(userId) || [];
    sessions.unshift(new_session); // Add to beginning (Desc order)
    mockSessionStore.set(userId, sessions);
    await saveToDB('sessions', Object.fromEntries(mockSessionStore));

    logger.info({ new_session, totalSessions: sessions.length }, '[MSW RPC] Created and persisted new session');

    return HttpResponse.json({
      new_session,
      usage_exceeded: false
    });
  }),

  // RPC: heartbeat_session
  http.post('*/rpc/heartbeat_session', async ({ request }) => {
    const { p_session_id } = await request.json() as { p_session_id: string };
    logger.info({ p_session_id }, '[MSW RPC] Heartbeat for session');
    return HttpResponse.json({ success: true });
  }),

  // RPC: complete_session
  http.post('*/rpc/complete_session', async ({ request }) => {
    const { p_session_id } = await request.json() as { p_session_id: string };
    logger.info({ p_session_id }, '[MSW RPC] Completing session');
    return HttpResponse.json({ success: true });
  }),

  // Edge Function: check-usage-limit
  http.post('*/functions/v1/check-usage-limit', () => {
    logger.info('[MSW DEBUG] Intercepted: POST /functions/v1/check-usage-limit');
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
    logger.warn({ method: request.method, functionName }, '[MSW ⚠️ UNMOCKED FUNCTION]');
    logger.warn('[MSW ⚠️] Add a handler for this Edge Function in handlers.ts to silence this warning');
    // Return empty success to prevent test failures
    return HttpResponse.json({ _msw_unmocked: true, function: functionName });
  }),

  // Catch-all for unmocked REST API endpoints
  http.all('*/rest/v1/*', ({ request }) => {
    const url = new URL(request.url);
    const tableName = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    logger.warn({ method: request.method, tableName }, '[MSW ⚠️ UNMOCKED TABLE]');
    logger.warn('[MSW ⚠️] Add a handler for this table in handlers.ts to silence this warning');
    // Return empty array for GET, empty object for others
    if (request.method === 'GET') {
      return HttpResponse.json([]);
    }
    return HttpResponse.json({ _msw_unmocked: true, table: tableName });
  }),
];

// Export reset function for test setup
export async function resetMockVocabularyStore() {
  // Reset to pre-populated default state
  mockVocabularyStore.set('test-user-123', [
    { id: 'vocab-1', user_id: 'test-user-123', word: 'Kubernetes', created_at: new Date(Date.now() - 7 * 86400000).toISOString() },
    { id: 'vocab-2', user_id: 'test-user-123', word: 'microservices', created_at: new Date(Date.now() - 6 * 86400000).toISOString() },
    { id: 'vocab-3', user_id: 'test-user-123', word: 'CI/CD', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
    { id: 'vocab-4', user_id: 'test-user-123', word: 'serverless', created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: 'vocab-5', user_id: 'test-user-123', word: 'neural networks', created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'vocab-6', user_id: 'test-user-123', word: 'gradient descent', created_at: new Date(Date.now() - 1 * 86400000).toISOString() },
  ]);
  
  mockSessionStore.set('test-user-123', [...MOCK_SESSION_HISTORY] as MockPracticeSession[]);
  
  await saveToDB('vocabulary', Object.fromEntries(mockVocabularyStore));
  await saveToDB('sessions', Object.fromEntries(mockSessionStore));
  
  logger.info('[MSW] All mock stores reset with pre-populated data');
}
