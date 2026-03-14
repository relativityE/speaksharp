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
import logger from '../../frontend/src/lib/logger';

// ============================================================================
// HELPERS
// ============================================================================

const isDebug = process.env.E2E_DEBUG === 'true';

const mockLog = (msg: string, ...args: unknown[]) => {
    if (isDebug) {
        if (args.length > 0) {
            logger.info({ args }, `[E2E MOCK] ${msg}`);
        } else {
            logger.info(`[E2E MOCK] ${msg}`);
        }
    }
};

const mockError = (msg: string, ...args: unknown[]) => {
    // We keep ERRORS visible even in non-debug mode to follow "fail hard"
    if (args.length > 0) {
        logger.error({ args }, msg);
    } else {
        logger.error(msg);
    }
};

const SUPABASE_SINGLE_HEADERS = {
    'Content-Type': 'application/vnd.pgrst.object+json',
    'Preference-Applied': 'return=representation'
};

const SUPABASE_ARRAY_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Preference-Applied': 'return=representation'
};

/**
 * Normalizes Supabase request bodies which are always arrays for POST/PATCH
 */
function parseSupabaseBody<T>(body: string | null): T {
    if (!body) return {} as T;
    try {
        const parsed = JSON.parse(body);
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (e) {
        mockError('Failed to parse Supabase body', e);
        return {} as T;
    }
}


// ============================================================================
// MOCK DATA (mirrored from frontend/src/mocks/handlers.ts)
// ============================================================================

import {
    MOCK_USER,
    MOCK_USER_PROFILE,
    MOCK_SESSION,
    MOCK_SESSION_HISTORY,
    MOCK_GOALS,
    SUBSCRIPTION_STATUS
} from '@shared/test-fixtures';
import { createMockSession, STTEngine, MockSession } from '../support/factories/session.factory';


export { MOCK_SESSION_HISTORY };

// Per-page state storage for parallel test isolation
// This ensures that 'Pro' and 'Free' tests running concurrently don't step on each other.
interface PageState {
    profile: typeof MOCK_USER_PROFILE;
    userWords: Array<{ id: string; user_id: string; word: string; created_at: string }>;
    sessions: MockSession[];
    goals: typeof MOCK_GOALS;
    emptySessions: boolean;
}

const pageStateStore = new WeakMap<Page, PageState>();

function getPageState(page: Page): PageState {
    let state = pageStateStore.get(page);
    if (!state) {
        state = {
            profile: { ...MOCK_USER_PROFILE },
            userWords: [],
            sessions: MOCK_SESSION_HISTORY.map(s => createMockSession(s as Partial<MockSession>)),
            goals: { ...MOCK_GOALS },
            emptySessions: false
        };

        pageStateStore.set(page, state);
    }
    return state;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Register a route handler with logging
 */
async function registerRoute(
    page: Page,
    pattern: string | RegExp,
    handler: (route: Route) => Promise<void>
): Promise<void> {
    await page.route(pattern, async (route) => {
        // Redundant log removed for CI clarity. Enable E2E_DEBUG if needed.
        await handler(route);
    });
}

/**
 * Setup Supabase Auth endpoint mocks
 */
export async function setupSupabaseAuthMocks(page: Page): Promise<void> {
    // GET /auth/v1/user
    await registerRoute(page, '**/auth/v1/user', async (route) => {
        mockLog('[E2E MOCK] Fulfilling auth/v1/user');
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
    const SUPABASE_HEADERS = {
        'Content-Type': 'application/json',
        'Content-Range': '0-0/*',
        'X-Content-Range': '0-0/*',
    };

    // GET /rest/v1/user_profiles
    await page.route(/\/rest\/v1\/user_profiles(\?.*)?/, async (route) => {
        const reqHeaders = route.request().headers();
        if (!reqHeaders['accept']) reqHeaders['accept'] = '*/*';

        const acceptHeader = reqHeaders['accept'];
        const isSingleObject = acceptHeader === 'application/vnd.pgrst.object+json';
        const page = route.request().frame()?.page();
        if (!page) return route.continue();

        const state = getPageState(page);
        const profile = { ...state.profile };

        const userId = profile.id || 'test-user-123';
        mockLog(`[E2E MOCK] Fulfilling user_profiles for: ${userId} (${profile.subscription_status})`);
        await route.fulfill({
            status: 200,
            headers: isSingleObject ? SUPABASE_SINGLE_HEADERS : SUPABASE_ARRAY_HEADERS,
            body: JSON.stringify(isSingleObject ? profile : [profile]),
        });
    });

    // GET /rest/v1/sessions
    await page.route(/\/rest\/v1\/sessions(\?.*)?/, async (route) => {
        const reqHeaders = route.request().headers();
        if (!reqHeaders['accept']) reqHeaders['accept'] = '*/*';

        const page = route.request().frame()?.page();
        if (!page) return route.continue();
        const state = getPageState(page);

        if (state.emptySessions) {
            mockLog('[E2E MOCK] Returning empty sessions (flag set)');
        }

        // Check for specific ID filter (e.g., id=eq.xxx)
        const url = new URL(route.request().url());
        const idParam = url.searchParams.get('id');
        let filteredSessions = [...state.sessions];

        if (idParam && idParam.startsWith('eq.')) {
            const targetId = idParam.replace('eq.', '');
            filteredSessions = state.sessions.filter(s => (s as unknown as { id: string }).id === targetId);
        }

        const acceptHeader = reqHeaders['accept'];
        const isSingleObject = acceptHeader === 'application/vnd.pgrst.object+json';

        if (isSingleObject) {
            if (filteredSessions.length === 0) {
                await route.fulfill({
                    status: 406,
                    headers: SUPABASE_HEADERS,
                    body: JSON.stringify({ code: 'PGRST116', message: 'No rows returned' }),
                });
                return;
            }
            await route.fulfill({
                status: 200,
                headers: SUPABASE_SINGLE_HEADERS,
                body: JSON.stringify(filteredSessions[0]),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            headers: SUPABASE_ARRAY_HEADERS,
            body: JSON.stringify(filteredSessions),
        });
    });

    // RPC queries allowance
    await registerRoute(page, /\/rest\/v1\/rpc\/.*/, async (route) => {
        // Default RPC handler if not explicitly overridden
        const reqHeaders = route.request().headers();
        if (!reqHeaders['accept']) reqHeaders['accept'] = '*/*';

        if (route.request().method() === 'POST') {
            await route.fulfill({
                status: 200,
                headers: SUPABASE_HEADERS,
                body: JSON.stringify({ success: true }),
            });
        } else {
            await route.continue();
        }
    });

    // POST /rest/v1/rpc/create_session_and_update_usage
    await registerRoute(page, '**/rest/v1/rpc/create_session_and_update_usage', async (route) => {
        const page = route.request().frame()?.page();
        if (!page) return route.continue();
        const state = getPageState(page);

        const body = JSON.parse(route.request().postData() || '{}');
        const { p_session_data } = body;

        const newSession = createMockSession({
            id: `session-${Date.now()}`,
            user_id: p_session_data.user_id || 'test-user-123',
            duration: p_session_data.duration || 0,
            transcript: p_session_data.transcript || '',
            title: p_session_data.title || 'New Session',
            total_words: p_session_data.total_words || 0,
            engine: (p_session_data.engine as STTEngine) || 'native',
            clarity_score: p_session_data.clarity_score || 0,
            wpm: p_session_data.wpm || 0,
            filler_words: p_session_data.filler_words || {},
            accuracy: p_session_data.accuracy || 0,
        });

        state.sessions.unshift(newSession);

        await route.fulfill({
            status: 200,
            headers: SUPABASE_HEADERS,
            body: JSON.stringify({
                new_session: newSession,
                usage_exceeded: false
            }),
        });
    });


    // GET/POST /rest/v1/user_filler_words
    await registerRoute(page, /\/rest\/v1\/user_filler_words(\?.*)?/, async (route) => {
        const reqHeaders = route.request().headers();
        if (!reqHeaders['accept']) reqHeaders['accept'] = '*/*';

        const page = route.request().frame()?.page();
        if (!page) return route.continue();
        const state = getPageState(page);

        const method = route.request().method();

        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                headers: SUPABASE_HEADERS,
                body: JSON.stringify(state.userWords),
            });
        } else if (method === 'POST') {
            const body = parseSupabaseBody<{ user_id: string; word: string }>(route.request().postData());
            const userId = body.user_id || 'test-user-123';

            const newWord = {
                id: `word-${Date.now()}`,
                user_id: userId,
                word: body.word,
                created_at: new Date().toISOString(),
            };

            state.userWords.push(newWord);

            const isSingle = reqHeaders['accept'] === 'application/vnd.pgrst.object+json';

            await route.fulfill({
                status: 201,
                headers: isSingle ? SUPABASE_SINGLE_HEADERS : SUPABASE_ARRAY_HEADERS,
                body: JSON.stringify(isSingle ? newWord : [newWord]),
            });
        } else if (method === 'DELETE') {
            const url = new URL(route.request().url());
            const idParam = url.searchParams.get('id') || '';
            const wordId = idParam.replace('eq.', '');

            state.userWords = state.userWords.filter(w => w.id !== wordId);
            await route.fulfill({ 
                status: 204,
                headers: SUPABASE_HEADERS
            });
        } else {
            await route.continue();
        }
    });

    // GET/POST/PATCH/PUT /rest/v1/user_goals
    await registerRoute(page, /\/rest\/v1\/user_goals(\?.*)?/, async (route) => {
        const reqHeaders = route.request().headers();
        if (!reqHeaders['accept']) reqHeaders['accept'] = '*/*';

        const page = route.request().frame()?.page();
        if (!page) return route.continue();
        const state = getPageState(page);

        const method = route.request().method();

        if (method === 'GET') {
            const acceptHeader = reqHeaders['accept'] || '';
            const isSingleObject = acceptHeader.includes('application/vnd.pgrst.object+json');

            await route.fulfill({
                status: 200,
                headers: SUPABASE_HEADERS,
                body: JSON.stringify(isSingleObject ? state.goals : [state.goals]),
            });
        } else if (['POST', 'PATCH', 'PUT'].includes(method)) {
            const body = parseSupabaseBody<Record<string, unknown>>(route.request().postData());
            // Merge new goals into state
            state.goals = { ...state.goals, ...body };

            mockLog('[E2E MOCK] Updated user_goals:', JSON.stringify(state.goals));

            const isSingle = reqHeaders['accept'] === 'application/vnd.pgrst.object+json';

            await route.fulfill({
                status: (method === 'POST') ? 201 : 200,
                headers: isSingle ? SUPABASE_SINGLE_HEADERS : SUPABASE_ARRAY_HEADERS,
                body: JSON.stringify(isSingle ? state.goals : [state.goals]),
            });
        }
    });
}

/**
 * Setup Edge Function endpoint mocks
 */
export async function setupEdgeFunctionMocks(page: Page): Promise<void> {
    // Register catch-all FIRST so it is checked LAST (Playwright checks in reverse order)
    // Catch-all for other functions to prevent net::ERR_NAME_NOT_RESOLVED
    // POST /functions/v1/stripe-checkout
    await registerRoute(page, '**/functions/v1/stripe-checkout', async (route) => {
        mockLog('[E2E MOCK] Specific Handler: stripe-checkout');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/test' }),
        });
    });

    // POST /functions/v1/apply-promo
    await registerRoute(page, '**/functions/v1/apply-promo', async (route) => {
        const page = route.request().frame()?.page();
        if (!page) return route.continue();
        const state = getPageState(page);

        mockLog('[E2E MOCK] Specific Handler: apply-promo');
        const body = await route.request().postDataJSON();
        if (body?.promoCode === 'MOCK-PROMO-123') {
            state.profile.subscription_status = SUBSCRIPTION_STATUS.PRO;
            mockLog('[E2E MOCK] Promo code applied: state updated to PRO');

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
        const page = route.request().frame()?.page();
        if (!page) return route.continue();
        const state = getPageState(page);
        const userType = state.profile.subscription_status || 'free';
        const isPro = userType === 'pro';

        // Fix: Ensure free users are not blocked prematurely in E2E
        // Real logic allows 60 mins/day for free users.
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                can_start: true,
                remaining_seconds: isPro ? -1 : 3600,
                limit_seconds: isPro ? -1 : 3600,
                used_seconds: 0,
                userType: userType,
                is_pro: isPro
            }),
        });
    });

    // POST /functions/v1/assemblyai-token
    await registerRoute(page, '**/functions/v1/assemblyai-token', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: 'mock-assemblyai-token' }),
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
    response: { status?: number; contentType?: string; body: unknown } | unknown
): Promise<void> {
    const isFullResponse = response && typeof response === 'object' && ('body' in response || 'status' in response);
    const resObj = response as { status?: number; contentType?: string; body?: unknown };
    const status = isFullResponse ? (resObj.status || 200) : 200;
    const contentType = isFullResponse ? (resObj.contentType || 'application/json') : 'application/json';
    const body = isFullResponse && 'body' in resObj ? resObj.body : response;

    await page.route(`**/functions/v1/${functionName}`, async (route) => {
        mockLog(`[E2E MOCK OVERRIDE] Fulfilling ${functionName} with custom mock`);
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
            mockError(`[E2E STRICT] ❌ Unhandled request: ${route.request().method()} ${url} `);
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
 * await navigateToRoute(page, '/');
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
        userType?: 'free' | 'pro';
    } = {}
): Promise<void> {
    const { strictMode = false, emptySessions = false, userType } = options;

    // Inject profile override if userType is explicitly set
    if (userType) {
        await page.addInitScript((status: string) => {
            (window as Window & { __E2E_MOCK_PROFILE__?: { subscription_status: string } }).__E2E_MOCK_PROFILE__ = { subscription_status: status };
        }, userType);
    }

    // Initialize per-page state
    const state = getPageState(page);
    state.profile = { ...MOCK_USER_PROFILE };
    if (userType) {
        state.profile.subscription_status = userType;
    }
    state.userWords = [];
    state.sessions = emptySessions ? [] : MOCK_SESSION_HISTORY.map(s => createMockSession(s as Partial<MockSession>));
    state.emptySessions = emptySessions;

    // Set window flag for components or MSW handlers that check it
    if (emptySessions) {
        await page.addInitScript(() => {
            (window as Window & { __E2E_EMPTY_SESSIONS__?: boolean }).__E2E_EMPTY_SESSIONS__ = true;
        });
    }

    mockLog('[E2E MOCK] Setting up Playwright route interception...');

    // Set flag to tell e2e-bridge to skip MSW
    await page.addInitScript(() => {
        (window as unknown as { __E2E_CONTEXT__: boolean }).__E2E_CONTEXT__ = true;
    });

    // GLOBAL FALLBACK: Register this FIRST so it is checked LAST
    // Catches any unhandled requests to mock.supabase.co to prevent DNS errors
    await page.route('**', async (route) => {
        const url = route.request().url();
        if (url.includes('supabase.co')) {
            mockLog(`[E2E MOCK] ⚠️ Unhandled request to Supabase domain: ${route.request().method()} ${url}`);
            // Return 404 instead of failing with network error to prevent DNS/hang issues
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

    // Setup all mock handlers
    // Register Edge Functions FIRST to ensure they catch early pings during hydration
    await setupEdgeFunctionMocks(page);
    await setupSupabaseAuthMocks(page);
    await setupSupabaseDatabaseMocks(page);

    mockLog('[E2E MOCK] ✅ All routes configured');
}

/**
 * Update the mock profile for a page (Node-side only)
 */
export async function updateMockProfile(page: Page, profile: Partial<typeof MOCK_USER_PROFILE>) {
    const state = getPageState(page);
    state.profile = { ...state.profile, ...profile };
    mockLog('[E2E MOCK] Node-side profile updated:', JSON.stringify(state.profile));
}

/**
 * Inject mock session into the browser for authenticated state.
 * Call this after the page has loaded.
 */
export async function injectMockSession(page: Page): Promise<void> {
    await page.evaluate(({ session }) => {
        // Derive project ref from Vite environment in browser
        const win = window as unknown as {
            import?: { meta?: { env?: Record<string, string> } };
            __E2E_MOCK_SESSION__?: boolean;
        };
        const url = (win.import?.meta?.env?.VITE_SUPABASE_URL) || 'https://mock.supabase.co';

        let projectRef = 'mock';
        try {
            projectRef = new URL(url).hostname.split('.')[0];
        } catch (err) {
            /* fallback to mock */
            mockLog('[E2E MOCK] projectRef extraction failed, using default:', err);
        }

        const storageKey = `sb-${projectRef}-auth-token`;
        localStorage.setItem(storageKey, JSON.stringify(session));

        win.__E2E_MOCK_SESSION__ = true;
        logger.debug(`[E2E MOCK] Session backup injection: ${storageKey}`);
    }, { session: MOCK_SESSION as unknown });
}
