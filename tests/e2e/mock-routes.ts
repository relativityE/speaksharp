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
    subscription_status: 'free',
    usage_seconds: 1250,
    usage_reset_date: new Date(Date.now() + 15 * 86400000).toISOString(),
    created_at: new Date().toISOString(),
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
        engine: 'Native',
        clarity_score: 72.5,
        wpm: 28.3,
        filler_words: { um: { count: 8 }, uh: { count: 6 }, total: { count: 14 } },
    },
    {
        id: 'session-2',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
        duration: 240,
        title: 'Technical Practice',
        total_words: 120,
        engine: 'Cloud AI',
        clarity_score: 78.2,
        wpm: 30.1,
        filler_words: { um: { count: 5 }, uh: { count: 4 }, total: { count: 9 } },
    },
    {
        id: 'session-3',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
        duration: 300,
        title: 'DevOps Vocabulary Practice',
        total_words: 165,
        engine: 'Private',
        clarity_score: 85.0,
        wpm: 33.0,
        filler_words: { um: { count: 3 }, uh: { count: 2 }, total: { count: 5 } },
    },
    {
        id: 'session-4',
        user_id: 'test-user-123',
        created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
        duration: 420,
        title: 'ML Presentation Practice',
        total_words: 245,
        engine: 'Cloud AI',
        clarity_score: 91.5,
        wpm: 35.0,
        filler_words: { um: { count: 2 }, uh: { count: 1 }, total: { count: 3 } },
    },
    {
        id: 'session-5',
        user_id: 'test-user-123',
        created_at: new Date().toISOString(),
        duration: 540,
        title: 'System Design Presentation',
        total_words: 320,
        engine: 'Private',
        clarity_score: 94.0,
        wpm: 35.5,
        filler_words: { um: { count: 1 }, total: { count: 1 } },
    },
];

export const MOCK_GOALS = {
    user_id: 'test-user-123',
    weekly_goal: 5,
    clarity_goal: 90,
};

// Per-test state for custom vocabulary (resets on each setupE2EMocks call)
// Stateful mocks to allow dynamic changes during a test (e.g. promo code)
let statefulProfile = { ...MOCK_USER_PROFILE };
let userWordStore: Map<string, Array<{ id: string; user_id: string; word: string; created_at: string }>> = new Map();

// Per-test state for sessions (resets on each setupE2EMocks call)
// Initialize with mock history
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionStore: any[] = [];

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
        console.log(`[E2E MOCK]Intercepted: ${route.request().method()} ${route.request().url()} `);
        await handler(route);
    });
}

/**
 * Setup Supabase Auth endpoint mocks
 */
export async function setupSupabaseAuthMocks(page: Page): Promise<void> {
    // GET /auth/v1/user
    await registerRoute(page, '**/auth/v1/user', async (route) => {
        console.log('[E2E MOCK] Fulfilling auth/v1/user');
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

    // POST /auth/v1/logout (with or without query params like ?scope=global)
    await registerRoute(page, '**/auth/v1/logout*', async (route) => {
        await route.fulfill({ status: 204 });
    });
}

/**
 * Setup Supabase Database (REST API) endpoint mocks
 */
export async function setupSupabaseDatabaseMocks(page: Page): Promise<void> {
    // GET /rest/v1/user_profiles
    await page.route('**/rest/v1/user_profiles*', async (route) => {
        console.log(`[E2E MOCK]Intercepted: ${route.request().method()} ${route.request().url()} `);
        const acceptHeader = route.request().headers()['accept'];
        const isSingleObject = acceptHeader === 'application/vnd.pgrst.object+json';

        // Check if profile override flag is set (for free user testing)
        // Read override from window flag (set by setupE2EMocks or test)
        const profileOverride = await route.request().frame()?.page()?.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (window as any).__E2E_MOCK_PROFILE__ as { id: string; subscription_status: string } | undefined;
        }).catch(() => undefined);

        // Merge: MOCK_USER_PROFILE (base) -> statefulProfile (state) -> profileOverride (hard override)
        let profile = { ...statefulProfile };
        if (profileOverride) {
            console.log(`[E2E MOCK] Profile override detected: ${JSON.stringify(profileOverride)} `);
            profile = { ...profile, ...profileOverride };
        }

        const userId = profile.id || 'test-user-123';
        console.log(`[E2E MOCK] Fulfilling user_profiles for: ${userId} (${profile.subscription_status})`);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(isSingleObject ? profile : [profile]),
        });
    });

    // GET /rest/v1/sessions
    await page.route('**/rest/v1/sessions*', async (route) => {
        console.log(`[E2E MOCK]Intercepted: ${route.request().method()} ${route.request().url()} `);

        // Check if empty sessions flag is set in the page context
        // The flag is set via page.addInitScript() BEFORE navigation
        const isEmpty = await route.request().frame()?.page()?.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return !!(window as any).__E2E_EMPTY_SESSIONS__;
        }).catch(() => false);

        if (isEmpty) {
            console.log('[E2E MOCK] Returning empty sessions (flag set)');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
        } else {
            // Return stateful session store
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(sessionStore),
            });
        }
    });

    // POST /rest/v1/rpc/create_session_and_update_usage
    await registerRoute(page, '**/rest/v1/rpc/create_session_and_update_usage', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        const { p_session_data } = body;

        console.log('[E2E MOCK] RPC create_session called with:', p_session_data);

        // Create new session object
        const newSession = {
            id: `session - ${Date.now()} `,
            user_id: p_session_data.user_id || 'test-user-123',
            created_at: new Date().toISOString(),
            duration: p_session_data.duration || 0,
            transcript: p_session_data.transcript || '',
            title: p_session_data.title || 'New Session',
            total_words: p_session_data.total_words || 0,
            engine: p_session_data.engine || 'WebSpeech',
            clarity_score: p_session_data.clarity_score || 0,
            wpm: p_session_data.wpm || 0,
            filler_words: p_session_data.filler_words || {},
            accuracy: p_session_data.accuracy || 0,
        };

        // Add to store at the BEGINNING (latest first)
        sessionStore.unshift(newSession);
        console.log(`[E2E MOCK] Session created and added to store.Total sessions: ${sessionStore.length} `);

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                new_session: newSession,
                usage_exceeded: false
            }),
        });
    });

    // GET/POST /rest/v1/user_filler_words
    await registerRoute(page, '**/rest/v1/user_filler_words*', async (route) => {
        const method = route.request().method();

        if (method === 'GET') {
            const userId = 'test-user-123';
            const words = userWordStore.get(userId) || [];

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(words),
            });
        } else if (method === 'POST') {
            let body = JSON.parse(route.request().postData() || '{}');
            // Handle array payload (Supabase insert sends array)
            if (Array.isArray(body)) {
                body = body[0] || {};
            }
            const userId = body.user_id || 'test-user-123';

            const newWord = {
                id: `word - ${Date.now()} `,
                user_id: userId,
                word: body.word,
                created_at: new Date().toISOString(),
            };

            const userWords = userWordStore.get(userId) || [];
            userWords.push(newWord);
            userWordStore.set(userId, userWords);

            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify(newWord),
            });
        } else if (method === 'DELETE') {
            // Parse word ID from URL query params: ?id=eq.word-xxx&user_id=eq.test-user-123
            const url = new URL(route.request().url());
            const idParam = url.searchParams.get('id') || '';
            const wordId = idParam.replace('eq.', '');
            const userId = 'test-user-123';

            // Actually remove the word from the store
            const userWords = userWordStore.get(userId) || [];
            const filteredWords = userWords.filter(w => w.id !== wordId);
            userWordStore.set(userId, filteredWords);

            console.log(`[E2E MOCK] Deleted word ${wordId}, remaining: ${filteredWords.length} `);
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
    // Register catch-all FIRST so it is checked LAST (Playwright checks in reverse order)
    // Catch-all for other functions to prevent net::ERR_NAME_NOT_RESOLVED
    await registerRoute(page, '**/functions/v1/*', async (route) => {
        // Fallback only if no other specific route matched
        console.log(`[E2E MOCK]Catch - all intercepted function call: $ { route.request().url() } `);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, mocked: true }),
        });
    });

    // POST /functions/v1/stripe-checkout
    await registerRoute(page, '**/functions/v1/stripe-checkout', async (route) => {
        console.log('[E2E MOCK] Specific Handler: stripe-checkout');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/test' }),
        });
    });

    // POST /functions/v1/apply-promo
    await registerRoute(page, '**/functions/v1/apply-promo', async (route) => {
        console.log('[E2E MOCK] Specific Handler: apply-promo');
        const body = await route.request().postDataJSON();
        // Accept our standard E2E mock code
        if (body?.promoCode === 'MOCK-PROMO-123') {
            // Update stateful profile to Pro
            statefulProfile.subscription_status = 'pro';
            console.log('[E2E MOCK] Promo code applied: statefulProfile updated to PRO');

            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    message: 'Upgraded to Pro!',
                    proFeatureMinutes: 60
                })
            });
        } else {
            await route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, error: 'Invalid code' }),
            });
        }
    });

    // POST /functions/v1/get-deepgram-token
    await registerRoute(page, '**/functions/v1/get-deepgram-token', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: 'mock-deepgram-token' }),
        });
    });

    // POST /functions/v1/check-usage-limit
    await registerRoute(page, '**/functions/v1/check-usage-limit', async (route) => {
        // Determine subscription status from mock profile injection
        const profileOverride = await route.request().frame()?.page()?.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (window as any).__E2E_MOCK_PROFILE__ as { id: string; subscription_status: string } | undefined;
        }).catch(() => undefined);

        const isPro = profileOverride?.subscription_status === 'pro';

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                can_start: true,
                remaining_seconds: isPro ? -1 : 3600,
                limit_seconds: isPro ? -1 : 3600,
                used_seconds: 0,
                subscription_status: isPro ? 'pro' : 'free',
                is_pro: isPro
            }),
        });
    });
}

/**
 * Helper to register a specific edge function mock override.
 * LIFO ordering in Playwright means specific handlers registered LATER take precedence.
 */
export async function registerEdgeFunctionMock(
    page: Page,
    functionName: string,
    response: { status?: number; contentType?: string; body: any } | any
): Promise<void> {
    const isFullResponse = response && typeof response === 'object' && ('body' in response || 'status' in response);
    const status = isFullResponse ? (response.status || 200) : 200;
    const contentType = isFullResponse ? (response.contentType || 'application/json') : 'application/json';
    const body = isFullResponse ? response.body : response;

    await page.route(`**/functions/v1/${functionName}`, async (route) => {
        console.log(`[E2E MOCK OVERRIDE] Fulfilling ${functionName} with custom mock`);
        await route.fulfill({
            status,
            contentType,
            body: JSON.stringify(body),
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
            console.error(`[E2E STRICT] ❌ Unhandled request: ${route.request().method()} ${url} `);
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
        /** Hard override status. If not set, uses base statefulProfile (defaults to 'free'). */
        subscriptionStatus?: 'free' | 'pro';
    } = {}
): Promise<void> {
    const { strictMode = false, emptySessions: _emptySessions = false, subscriptionStatus } = options;

    // TODO: Implement emptySessions option to return empty session history
    // Currently unused but kept for future implementation
    void _emptySessions;

    // Inject profile override if subscriptionStatus is explicitly set
    // This must happen BEFORE navigation so it's available when routes are intercepted
    if (subscriptionStatus) {
        await page.addInitScript((status: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_MOCK_PROFILE__ = { subscription_status: status };
        }, subscriptionStatus);
    }

    // Reset per-test state
    statefulProfile = { ...MOCK_USER_PROFILE };
    userWordStore = new Map();
    sessionStore = [...MOCK_SESSION_HISTORY]; // Reset to default mock history

    console.log('[E2E MOCK] Setting up Playwright route interception...');

    // Set flag to tell e2e-bridge to skip MSW
    await page.addInitScript(() => {
        (window as unknown as { __E2E_PLAYWRIGHT__: boolean }).__E2E_PLAYWRIGHT__ = true;
    });

    // GLOBAL FALLBACK: Register this FIRST so it is checked LAST
    // Catches any unhandled requests to mock.supabase.co to prevent DNS errors
    await page.route('**', async (route) => {
        const url = route.request().url();
        if (url.includes('mock.supabase.co')) {
            console.warn(`[E2E MOCK] ⚠️ Unhandled request to mock domain: ${route.request().method()} ${url} `);
            // Return 404 instead of failing with network error
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Mock route not found', path: url }),
            });
            return;
        }
        // Allow other requests (assets, localhost, etc.) to proceed
        await route.continue();
    });

    // Optionally enable strict mode (catches unhandled requests)
    if (strictMode) {
        await setupStrictAllowList(page);
    }

    // Setup all mock handlers (These are registered LATER, so they run EARLIER)
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
        const storageKey = 'sb-mock-auth-token';
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
