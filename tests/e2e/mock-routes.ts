/**
 * Playwright Route Interception for E2E Tests
 * 
 * This module replaces MSW service worker with Playwright-native route interception.
 * 
 * ## Why Playwright Routes Instead of MSW?
 * 
 * MSW uses service workers which are:
 * - Global per origin (not per test)
 * - Race-prone in parallel shards
 * - Asynchronous startup (requires e2e:msw-ready sync)
 * 
 * Playwright routes are:
 * - Per-page/per-test isolation
 * - Deterministic setup
 * - No global browser state
 * 
 * @see https://playwright.dev/docs/network#handle-requests
 */

import { Page, Route } from '@playwright/test';

// ============================================================================
// MOCK DATA (mirrored from frontend/src/mocks/handlers.ts)
// ============================================================================

export const MOCK_USER = {
    id: 'test-user-123',
    email: 'test@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: { name: 'Test User' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: new Date().toISOString(),
};

export const MOCK_USER_PROFILE = {
    id: 'test-user-123',
    email: 'test@example.com',
    subscription_status: 'pro',
    monthly_usage_count: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
};

export const MOCK_SESSION = {
    access_token: 'mock-access-token-for-e2e-testing',
    refresh_token: 'mock-refresh-token-for-e2e-testing',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: MOCK_USER,
};

// Rich mock session history for analytics testing
export const MOCK_SESSION_HISTORY = [
    {
        id: 'session-1',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
        duration: 180,
        transcript: 'Um, so today I wanted to talk about my presentation skills.',
        title: 'First Practice Session',
        total_words: 85,
        words_per_minute: 28,
        accuracy: 0.72,
        filler_words: { um: { count: 8 }, uh: { count: 6 }, total: { count: 14 } },
        clarity_score: 65,
        articulation_score: 60,
        pace_score: 55,
        volume_score: 70,
    },
    {
        id: 'session-2',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
        duration: 240,
        title: 'Technical Practice',
        total_words: 120,
        words_per_minute: 30,
        accuracy: 0.78,
        filler_words: { um: { count: 5 }, uh: { count: 4 }, total: { count: 9 } },
        clarity_score: 72,
        articulation_score: 70,
        pace_score: 68,
        volume_score: 75,
    },
    {
        id: 'session-3',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
        duration: 300,
        title: 'DevOps Vocabulary Practice',
        total_words: 165,
        words_per_minute: 33,
        accuracy: 0.85,
        filler_words: { um: { count: 3 }, uh: { count: 2 }, total: { count: 5 } },
        clarity_score: 80,
        articulation_score: 78,
        pace_score: 75,
        volume_score: 82,
    },
    {
        id: 'session-4',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
        duration: 420,
        title: 'ML Presentation Practice',
        total_words: 245,
        words_per_minute: 35,
        accuracy: 0.91,
        filler_words: { um: { count: 2 }, uh: { count: 1 }, total: { count: 3 } },
        clarity_score: 87,
        articulation_score: 88,
        pace_score: 84,
        volume_score: 87,
    },
    {
        id: 'session-5',
        user_id: 'test-user-123',
        created_at: new Date().toISOString(),
        duration: 540,
        title: 'System Design Presentation',
        total_words: 320,
        words_per_minute: 36,
        accuracy: 0.94,
        filler_words: { um: { count: 1 }, total: { count: 1 } },
        clarity_score: 92,
        articulation_score: 93,
        pace_score: 90,
        volume_score: 92,
    },
];

export const MOCK_GOALS = {
    user_id: 'test-user-123',
    weekly_goal: 5,
    clarity_goal: 90,
};

// Per-test state for custom vocabulary (resets on each setupE2EMocks call)
let vocabularyStore: Map<string, Array<{ id: string; user_id: string; word: string; created_at: string }>> = new Map();

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Register a route handler with logging
 */
async function registerRoute(
    page: Page,
    pattern: string,
    handler: (route: Route) => Promise<void>
): Promise<void> {
    await page.route(pattern, async (route) => {
        console.log(`[E2E MOCK] Intercepted: ${route.request().method()} ${route.request().url()}`);
        await handler(route);
    });
}

/**
 * Setup Supabase Auth endpoint mocks
 */
export async function setupSupabaseAuthMocks(page: Page): Promise<void> {
    // GET /auth/v1/user
    await registerRoute(page, '**/auth/v1/user', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_USER),
        });
    });

    // POST /auth/v1/token
    await registerRoute(page, '**/auth/v1/token*', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_SESSION),
        });
    });

    // POST /auth/v1/signup
    await registerRoute(page, '**/auth/v1/signup', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_SESSION),
        });
    });

    // POST /auth/v1/logout
    await registerRoute(page, '**/auth/v1/logout', async (route) => {
        await route.fulfill({ status: 204 });
    });
}

/**
 * Setup Supabase Database (REST API) endpoint mocks
 */
export async function setupSupabaseDatabaseMocks(page: Page): Promise<void> {
    // GET /rest/v1/user_profiles
    await registerRoute(page, '**/rest/v1/user_profiles*', async (route) => {
        const acceptHeader = route.request().headers()['accept'];
        const isSingleObject = acceptHeader === 'application/vnd.pgrst.object+json';

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(isSingleObject ? MOCK_USER_PROFILE : [MOCK_USER_PROFILE]),
        });
    });

    // GET /rest/v1/sessions
    await registerRoute(page, '**/rest/v1/sessions*', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_SESSION_HISTORY),
        });
    });

    // GET/POST /rest/v1/custom_vocabulary
    await registerRoute(page, '**/rest/v1/custom_vocabulary*', async (route) => {
        const method = route.request().method();

        if (method === 'GET') {
            const userId = 'test-user-123';
            const words = vocabularyStore.get(userId) || [];

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(words),
            });
        } else if (method === 'POST') {
            const body = JSON.parse(route.request().postData() || '{}');
            const userId = body.user_id || 'test-user-123';

            const newWord = {
                id: `word-${Date.now()}`,
                user_id: userId,
                word: body.word,
                created_at: new Date().toISOString(),
            };

            const userWords = vocabularyStore.get(userId) || [];
            userWords.push(newWord);
            vocabularyStore.set(userId, userWords);

            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify(newWord),
            });
        } else if (method === 'DELETE') {
            await route.fulfill({ status: 204 });
        } else {
            await route.continue();
        }
    });

    // GET /rest/v1/user_goals
    await registerRoute(page, '**/rest/v1/user_goals*', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_GOALS),
        });
    });
}

/**
 * Setup Edge Function endpoint mocks
 */
export async function setupEdgeFunctionMocks(page: Page): Promise<void> {
    // POST /functions/v1/create-checkout-session
    await registerRoute(page, '**/functions/v1/create-checkout-session', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ url: 'https://checkout.stripe.com/test' }),
        });
    });

    // POST /functions/v1/get-deepgram-token
    await registerRoute(page, '**/functions/v1/get-deepgram-token', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: 'mock-deepgram-token' }),
        });
    });
}

// ============================================================================
// STRICT ALLOW-LIST MODE (Recommended refinement)
// ============================================================================

/**
 * Setup strict mode that rejects unhandled requests.
 * Call this BEFORE setting up specific route handlers.
 * 
 * This catches:
 * - Accidental real network calls
 * - Missing mock handlers
 * - API contract drift
 */
export async function setupStrictAllowList(page: Page): Promise<void> {
    // Allow static assets and known safe patterns
    const ALLOWED_PATTERNS = [
        /\.(js|css|png|jpg|jpeg|svg|woff|woff2|ico)$/,
        /^http:\/\/localhost/,
        /mockServiceWorker\.js$/, // MSW SW if still present
    ];

    await page.route('**/*', async (route) => {
        const url = route.request().url();

        // Allow if matches any allowed pattern
        const isAllowed = ALLOWED_PATTERNS.some(pattern => pattern.test(url));

        if (isAllowed) {
            await route.continue();
        } else {
            console.error(`[E2E STRICT] ❌ Unhandled request: ${route.request().method()} ${url}`);
            // Fail the request to make it obvious
            await route.abort('failed');
        }
    });
}

// ============================================================================
// MAIN SETUP FUNCTION
// ============================================================================

/**
 * Setup all E2E mocks for a page.
 * 
 * Call this before navigating to your app:
 * ```ts
 * await setupE2EMocks(page);
 * await page.goto('/');
 * ```
 * 
 * @param page - Playwright Page object
 * @param options - Configuration options
 */
export async function setupE2EMocks(
    page: Page,
    options: {
        strictMode?: boolean;
        emptySessions?: boolean;
    } = {}
): Promise<void> {
    const { strictMode = false, emptySessions: _emptySessions = false } = options;

    // TODO: Implement emptySessions option to return empty session history
    // Currently unused but kept for future implementation
    void _emptySessions;

    // Reset per-test state
    vocabularyStore = new Map();

    console.log('[E2E MOCK] Setting up Playwright route interception...');

    // Optionally enable strict mode (catches unhandled requests)
    if (strictMode) {
        await setupStrictAllowList(page);
    }

    // Setup all mock handlers
    await setupSupabaseAuthMocks(page);
    await setupSupabaseDatabaseMocks(page);
    await setupEdgeFunctionMocks(page);

    console.log('[E2E MOCK] ✅ All routes configured');
}

/**
 * Inject mock session into the browser for authenticated state.
 * Call this after the page has loaded.
 */
export async function injectMockSession(page: Page): Promise<void> {
    await page.evaluate(({ session }) => {
        // Store in localStorage (Supabase format)
        const storageKey = 'sb-localhost-auth-token';
        localStorage.setItem(storageKey, JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at,
            expires_in: session.expires_in,
            token_type: session.token_type,
            user: session.user,
        }));

        // Set flag that app checks for mock session
        (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;

        console.log('[E2E MOCK] Session injected into localStorage');
    }, { session: MOCK_SESSION });
}
