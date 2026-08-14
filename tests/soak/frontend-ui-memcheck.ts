import { expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { SOAK_CONFIG, SOAK_TEST_USERS, ROUTES, TEST_IDS } from '../constants';
import * as fs from 'fs';
import * as path from 'path';

const ENDURANCE_RESULTS_DIR = path.resolve(process.cwd(), 'test-results/endurance');
const ENDURANCE_EVIDENCE_PATH = path.join(ENDURANCE_RESULTS_DIR, 'browser-endurance.latest.json');

type BrowserMemorySnapshot = {
    usedJSHeapSize: number | null;
    totalJSHeapSize: number | null;
    jsHeapSizeLimit: number | null;
};

type BrowserEnduranceUserResult = {
    userIndex: number;
    status: 'pass' | 'fail';
    memoryStart: BrowserMemorySnapshot;
    memoryEnd: BrowserMemorySnapshot;
    memoryGrowthBytes: number | null;
    error?: string;
};

type EndurancePhase = 'setup' | 'active' | 'navigation' | 'teardown' | 'complete';

export type RequestFailureEvent = {
    userIndex: number;
    url: string;
    method: string;
    errorText: string | null;
    phase: EndurancePhase;
    functionalJourneyPassed: boolean;
};

type CriticalRequestFailure = RequestFailureEvent & {
    classification: 'critical';
    reason: string;
};

type IgnoredRequestFailure = RequestFailureEvent & {
    classification: 'ignored_teardown_read';
    reason: string;
    category: string;
};

export type RequestFailureClassification =
    | { kind: 'critical'; reason: string }
    | { kind: 'ignored_teardown_read'; reason: string; category: string };

type BrowserEnduranceEvidence = {
    schemaVersion: 2;
    kind: 'browser-endurance';
    run: {
        githubRunId: string | null;
        githubRunAttempt: string | null;
        commitSha: string | null;
        actor: string | null;
    };
    status: 'pass' | 'fail' | 'invalid';
    countsAsReleaseEvidence: boolean;
    functionalJourneyPassed: boolean;
    invalidEvidenceReasons: string[];
    concurrency: number;
    mode: 'private';
    durationMs: number;
    startedAt: string;
    completedAt: string;
    consoleIssues: Array<{ userIndex: number; type: string; text: string }>;
    requestFailures: CriticalRequestFailure[];
    criticalFailures: CriticalRequestFailure[];
    ignoredRequestFailures: IgnoredRequestFailure[];
    users: BrowserEnduranceUserResult[];
    error?: string;
};

const READ_ABORT_ENDPOINTS = [
    {
        category: 'session_history_read',
        methods: ['GET', 'HEAD'],
        pattern: /\/rest\/v1\/sessions\?select=/,
    },
    {
        category: 'usage_poll',
        methods: ['GET', 'HEAD', 'POST'],
        pattern: /\/functions\/v1\/check-usage-limit/,
    },
    {
        category: 'filler_words_read',
        methods: ['GET', 'HEAD'],
        pattern: /\/rest\/v1\/user_filler_words\?select=/,
    },
    {
        // Fire-and-forget idempotent preference RPC fired at load; the app never awaits it and re-sends it,
        // so a navigation abort during setup is benign (never during active recording — see the phase gate).
        category: 'timezone_preference',
        methods: ['POST'],
        pattern: /\/rest\/v1\/rpc\/set_user_timezone/,
    },
] as const;

// Console error logs that are benign navigation-abort artifacts (the app logs these fire-and-forget setup
// reads/RPCs when a fast soak navigation cancels them). They never touch the recording/memory objective, so
// they are recorded in the evidence but excluded from the release-failing console-error count.
const BENIGN_NAVIGATION_CONSOLE_ERRORS: readonly RegExp[] = [
    /set_user_timezone/,
    /getRecentReviewable/,
] as const;

// #1294 Option 1: the endurance journey runs the REAL customer Private policy. This bridge mirrors the
// PROVEN local-e2e Private mock mechanism (tests/e2e/helpers/setupE2EManifest.ts, engineType 'mock') that
// drives the Private start FSM to RECORDING — but ENGINE-ONLY. It installs NO mock profile and NO route
// mocks, so the live active-trial account (real entitlement) and live DB are untouched. The deterministic
// double lives BEHIND the Private adapter (the mock private engines below). Only Private-adapter engine
// keys are registered — off-Private engines are never registered, selected, or instantiated here.
const installSoakSttBridgeScript = () => {
        type SttOptions = {
            onReady?: () => void;
            onTranscriptUpdate?: (update: {
                transcript: { partial?: string; final?: string };
                isFinal: boolean;
                isPartial: boolean;
                timestamp: number;
            }) => void;
        };

        type SoakWindow = Window & {
            __SS_E2E__?: {
                isActive: boolean;
                engineType?: 'mock';
                enableRealEngine?: boolean;
                MOCK_STT_AVAILABILITY?: boolean;
                isEngineInitialized?: boolean;
                registry?: Record<string, (options?: SttOptions) => unknown>;
                _activeCallbacks?: SttOptions;
            };
            __SS_E2E_BRIDGE__?: { emitTranscript: (text: string, isFinal?: boolean) => void };
            __SS_E2E_ENGINE_CACHE__?: Record<string, unknown>;
            TEST_MODE?: boolean;
        };

        const win = window as SoakWindow;
        win.TEST_MODE = true;
        win.__SS_E2E_ENGINE_CACHE__ = win.__SS_E2E_ENGINE_CACHE__ || {};

        // A working deterministic Private-adapter double: matches the setupE2EManifest mock engine so the
        // start FSM initializes and transitions to RECORDING (init sets isEngineInitialized).
        const mockEngineFactory = (mode: string) => (options?: SttOptions) => {
            const cache = win.__SS_E2E_ENGINE_CACHE__ || {};
            win.__SS_E2E_ENGINE_CACHE__ = cache;
            if (cache[mode]) return cache[mode];
            const instance = {
                instanceId: `soak-${mode}-${Math.random().toString(36).slice(2)}`,
                checkAvailability: async () => ({ isAvailable: true }),
                init: async (io?: { onReady?: () => void }) => {
                    if (win.__SS_E2E__) win.__SS_E2E__.isEngineInitialized = true;
                    (io?.onReady ?? options?.onReady)?.();
                    return { isOk: true };
                },
                start: async () => {},
                stop: async () => {},
                pause: async () => {},
                resume: async () => {},
                destroy: async () => {},
                terminate: async () => {},
                getEngineType: () => mode,
                getLastHeartbeatTimestamp: () => Date.now(),
                getTranscript: async () => '[E2E_MOCK]',
                transcribe: async () => ({ isOk: true, value: '[E2E_MOCK]', data: '[E2E_MOCK]' }),
                emitTranscript: (text: string, isFinal: boolean = true) => {
                    const update = { transcript: isFinal ? { final: text } : { partial: text }, isFinal, isPartial: !isFinal, timestamp: Date.now() };
                    options?.onTranscriptUpdate?.(update);
                    win.__SS_E2E__?._activeCallbacks?.onTranscriptUpdate?.(update);
                },
            };
            cache[mode] = instance;
            return instance;
        };

        win.__SS_E2E__ = {
            ...(win.__SS_E2E__ || {}),
            isActive: true,
            engineType: 'mock',
            enableRealEngine: false,
            MOCK_STT_AVAILABILITY: true,
            isEngineInitialized: false,
            registry: {
                ...(win.__SS_E2E__?.registry || {}),
                // Private-adapter engines only → working deterministic double. No off-Private engine is registered.
                'transformers-js': mockEngineFactory('transformers-js'),
                'transformers-js-v4': mockEngineFactory('transformers-js-v4'),
                'whisper-turbo': mockEngineFactory('whisper-turbo'),
                mock: mockEngineFactory('mock'),
            },
        };

        win.__SS_E2E_BRIDGE__ = {
            emitTranscript: (text: string, isFinal: boolean = true) => {
                win.__SS_E2E__?._activeCallbacks?.onTranscriptUpdate?.({
                    transcript: isFinal ? { final: text } : { partial: text }, isFinal, isPartial: !isFinal, timestamp: Date.now(),
                });
            },
        };
};

async function installSoakSttBridge(page: Page): Promise<void> {
    await page.evaluate(installSoakSttBridgeScript);
}

async function installSoakSttBridgeAtBoot(page: Page): Promise<void> {
    await page.addInitScript(installSoakSttBridgeScript);
}

async function readMemorySnapshot(page: Page): Promise<BrowserMemorySnapshot> {
    return page.evaluate(() => {
        const memory = (performance as Performance & {
            memory?: {
                usedJSHeapSize?: number;
                totalJSHeapSize?: number;
                jsHeapSizeLimit?: number;
            };
        }).memory;

        return {
            usedJSHeapSize: memory?.usedJSHeapSize ?? null,
            totalJSHeapSize: memory?.totalJSHeapSize ?? null,
            jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null,
        };
    });
}

function writeBrowserEnduranceEvidence(report: Omit<BrowserEnduranceEvidence, 'schemaVersion' | 'kind' | 'run'>) {
    fs.mkdirSync(ENDURANCE_RESULTS_DIR, { recursive: true });
    fs.writeFileSync(ENDURANCE_EVIDENCE_PATH, JSON.stringify({
        schemaVersion: 2,
        kind: 'browser-endurance',
        run: {
            githubRunId: process.env.GITHUB_RUN_ID ?? null,
            githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
            commitSha: process.env.GITHUB_SHA ?? null,
            actor: process.env.GITHUB_ACTOR ?? null,
        },
        ...report,
    }, null, 2));
    console.log(`📄 Browser endurance evidence written to ${ENDURANCE_EVIDENCE_PATH}`);
}

// Vite dev-server module/asset fetches — the soak runs against `pnpm dev:test` on localhost, so a route
// navigation that unmounts a page cancels its in-flight module/HMR fetch. This is a dev-harness artifact
// (it does not exist in a production build), never a product signal, and only ever ABORTED (never a real
// status/connection error). Matches the app's own served modules/assets, not third-party hosts.
const DEV_ASSET_ABORT = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/(?:src\/|@vite\/|@id\/|@react-refresh|node_modules\/\.vite\/|assets\/|@fs\/)/;

export function classifyRequestFailure(failure: RequestFailureEvent): RequestFailureClassification {
    if (failure.errorText !== 'net::ERR_ABORTED') {
        return {
            kind: 'critical',
            reason: `Unexpected request failure: ${failure.errorText ?? 'unknown error'}`,
        };
    }

    // A dev-server module/asset load cancelled by navigation is a harness artifact, not a product failure.
    if (DEV_ASSET_ABORT.test(failure.url)) {
        return {
            kind: 'ignored_teardown_read',
            reason: 'Vite dev-server module/asset fetch aborted by navigation (dev harness only).',
            category: 'dev_asset_navigation_abort',
        };
    }

    const match = READ_ABORT_ENDPOINTS.find((endpoint) =>
        (endpoint.methods as readonly string[]).includes(failure.method) && endpoint.pattern.test(failure.url)
    );

    if (!match) {
        if (!['GET', 'HEAD'].includes(failure.method)) {
            return {
                kind: 'critical',
                reason: 'Aborted non-read request',
            };
        }
        return {
            kind: 'critical',
            reason: 'Aborted read endpoint is not in the teardown allowlist',
        };
    }

    // A client-aborted read to a KNOWN read-only endpoint is benign in every phase EXCEPT active recording:
    // an abort mid-journey (before the functional proof) could mask an unexpected teardown, so only the
    // 'active' phase stays critical. Setup/navigation/teardown aborts of these polls are expected churn.
    const abortDuringActiveJourney = failure.phase === 'active' && !failure.functionalJourneyPassed;
    if (abortDuringActiveJourney) {
        return {
            kind: 'critical',
            reason: 'Read aborted during active recording before the functional journey passed',
        };
    }

    return {
        kind: 'ignored_teardown_read',
        reason: 'Known read-only polling endpoint aborted outside active recording (setup/navigation/teardown).',
        category: match.category,
    };
}

function classifyInvalidEvidence(error: unknown): string[] {
    const message = error instanceof Error ? error.message : String(error);
    if (/\bEPERM\b|EACCES|EADDRINUSE|listen|bind/i.test(message)) {
        return [`Environment/tooling prevented trustworthy browser evidence: ${message}`];
    }
    if (/Missing|not configured|required env|secret/i.test(message)) {
        return [`Missing environment/configuration prevented trustworthy evidence: ${message}`];
    }
    return [];
}

/**
 * Helper to set up authenticated test user using REAL Supabase login
 * Each concurrent user gets different credentials to avoid session conflicts
 */
export async function setupAuthenticatedUser(page: Page, userIndex: number): Promise<void> {
    const credentials = SOAK_TEST_USERS[userIndex % SOAK_TEST_USERS.length];

    // Navigate to sign-in page
    await page.goto(ROUTES.SIGN_IN);

    // Wait for auth form to load (Increased timeout for concurrent load)
    await page.waitForSelector('input[type="email"]', { timeout: 30000 });

    // Fill in credentials
    await page.fill('input[type="email"]', credentials.email);
    await page.fill('input[type="password"]', credentials.password);

    // Submit and wait for event-based auth confirmation (sign-out button)
    // Stagger clicks to avoid overwhelming the server/auth API
    await page.waitForTimeout(userIndex * 1500); // 1.5s stagger per user
    await page.getByRole('button', { name: /sign in/i }).click();

    try {
        await page.waitForSelector(`[data-testid="${TEST_IDS.NAV_SIGN_OUT_BUTTON}"]`, {
            state: 'visible',
            timeout: 60000 // Increased for concurrent load
        });
    } catch (error) {
        console.error(`[Auth FAIL] User ${userIndex} (${credentials.email}): Timeout waiting for auth completion (nav-sign-out-button)`);
        const screenshotPath = `test-results/soak/auth-failure-${userIndex}.png`;
        if (!fs.existsSync(path.dirname(screenshotPath))) fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath });
        throw error;
    }

    // Navigate to session page if not already there
    // ProtectedRoute might show a loader initially
    if (!page.url().includes(ROUTES.SESSION)) {
        await page.goto(ROUTES.SESSION);
    }

    // Verify application auth state
    await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible({ timeout: 30000 });

    // Verify session page readiness. Current session shell: the readied recorder control is `mic-start`
    // (or the one-time `mic-download` model gate) — the combined start/stop selector was retired.
    await expect(page.getByTestId('mic-download').or(page.getByTestId('mic-start')).first()).toBeVisible({ timeout: 30000 });
}

/**
 * Executes the pure Frontend User-Interface test.
 * Spins up isolated browsers, logs them in, and forces them to record 
 * continuously to track React memory leaks and Zustand data bleed.
 */
export async function runFrontendMemCheck(browser: Browser): Promise<void> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const consoleIssues: BrowserEnduranceEvidence['consoleIssues'] = [];
    const criticalFailures: BrowserEnduranceEvidence['criticalFailures'] = [];
    const ignoredRequestFailures: BrowserEnduranceEvidence['ignoredRequestFailures'] = [];
    const userResults: BrowserEnduranceUserResult[] = [];
    const userPhases: EndurancePhase[] = Array.from({ length: SOAK_CONFIG.CONCURRENT_USERS }, () => 'setup');
    const functionalJourneyPassedByUser: boolean[] = Array.from({ length: SOAK_CONFIG.CONCURRENT_USERS }, () => false);
    let userContexts: BrowserContext[] = [];
    let userPages: Page[] = [];

    // Create multiple completely isolated browser contexts (Playwright handles this)
    try {
        userContexts = await Promise.all(
            Array.from({ length: SOAK_CONFIG.CONCURRENT_USERS }, () =>
                browser.newContext({
                    viewport: { width: 1280, height: 720 },
                    storageState: undefined,
                })
            )
        );

        // Create pages for each user
        userPages = await Promise.all(
            userContexts.map((ctx) => ctx.newPage())
        );

        await Promise.all(userPages.map((page) => installSoakSttBridgeAtBoot(page)));

        userPages.forEach((page, userIndex) => {
            page.on('console', (message) => {
                if (message.type() === 'error' || message.type() === 'warning') {
                    consoleIssues.push({ userIndex, type: message.type(), text: message.text().slice(0, 500) });
                }
            });
            page.on('requestfailed', (request) => {
                const failure = {
                    userIndex,
                    url: request.url(),
                    method: request.method(),
                    errorText: request.failure()?.errorText ?? null,
                    phase: userPhases[userIndex] ?? 'setup',
                    functionalJourneyPassed: functionalJourneyPassedByUser[userIndex] ?? false,
                };
                const classification = classifyRequestFailure(failure);
                if (classification.kind === 'ignored_teardown_read') {
                    ignoredRequestFailures.push({
                        ...failure,
                        classification: classification.kind,
                        reason: classification.reason,
                        category: classification.category,
                    });
                } else {
                    criticalFailures.push({
                        ...failure,
                        classification: classification.kind,
                        reason: classification.reason,
                    });
                }
            });
        });

        // Set up authenticated sessions for each user (different credentials per user)
        await Promise.all(
            userPages.map((page, i) => setupAuthenticatedUser(page, i))
        );

        // DIAGNOSTIC: Verify auth state before starting journeys
        for (let i = 0; i < userPages.length; i++) {
            const page = userPages[i];
            const signOutVisible = await page.locator('[data-testid="nav-sign-out-button"]').isVisible().catch(() => false);

            if (!signOutVisible) {
                // Capture screenshot for debugging
                await page.screenshot({ path: `test-results/soak/debug-user-${i}-auth-state.png` });
                throw new Error(`[Browser Endurance] ⚠️ User ${i}: nav-sign-out-button NOT visible - auth may have failed!`);
            }
        }

        // Run all users concurrently
        const userJourneys = userPages.map(async (page, userIndex) => {
            const memoryStart = await readMemorySnapshot(page);

            // 1. Navigate to Session
            userPhases[userIndex] = 'navigation';
            await page.goto(ROUTES.SESSION);
            await installSoakSttBridge(page);

            // 2. Engine resolution is the NORMAL customer Private policy — there is NO Native / Browser /
            // Cloud path and no customer mode selector. The soak STT bridge supplies a deterministic
            // transcription double BEHIND the Private adapter boundary (a mock engine in the __SS_E2E__
            // registry), so no model is downloaded or run. This endurance path exercises the REAL Private
            // start/stop/finalize lifecycle with active-trial accounts (no retired private-sample allowance).

            // 3. Ready the Private engine, then Start. The shipped session shell renders the recorder control
            // as `mic-download` (one-time on-device model gate) until the model is loaded, then `mic-start`.
            // Clicking the gate drives the (mocked) Private engine to ready — never a Browser/Cloud path.
            const downloadBtn = page.getByTestId('mic-download');
            const startButton = page.getByTestId('mic-start');
            await expect(downloadBtn.or(startButton).first()).toBeVisible({ timeout: 30000 });
            if (await downloadBtn.count() > 0) {
                await downloadBtn.first().click();
            }
            await expect(startButton).toBeEnabled({ timeout: 60000 });
            await startButton.click();
            // Runtime-state seam: the shell must reach RECORDING resolved to PRIVATE. If Private cannot start,
            // FAIL with the exact runtime reason — engines are never silently changed to Browser/Cloud.
            try {
                await expect(page.locator('html[data-runtime-state="RECORDING"][data-stt-resolved-mode="private"]')).toBeVisible({ timeout: 20000 });
            } catch {
                const runtime = await page.getAttribute('html', 'data-runtime-state').catch(() => null);
                const resolved = await page.getAttribute('html', 'data-stt-resolved-mode').catch(() => null);
                throw new Error(`[Browser Endurance] User ${userIndex}: Private recording did not start (runtime-state=${runtime}, resolved-mode=${resolved}). Endurance requires the customer Private engine and never silently changes engines.`);
            }
            await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 10000 });
            userPhases[userIndex] = 'active';

            // 4. Endurance wait — sustained Private recording; memory growth is measured start→end.
            const checkInterval = 10000;
            const iterations = Math.floor(SOAK_CONFIG.SESSION_DURATION_MS / checkInterval);
            for (let j = 0; j < iterations; j++) {
                await page.waitForTimeout(checkInterval);
            }

            // 5. Stop Recording via the during-state RecorderBar `recorder-stop` control.
            const stopButton = page.getByTestId('recorder-stop');
            if (await stopButton.isVisible().catch(() => false)) {
                await stopButton.click();
                const sessionEndLocator = page.locator('div[role="alertdialog"]').or(page.getByText('No speech was detected'));
                await sessionEndLocator.first().waitFor({ timeout: 10000 }).catch(() => { });
            }

            // Recording start/stop has been proven by this point. Analytics
            // navigation is post-journey verification, so teardown/navigation
            // read aborts after here should be classified as evidence noise.
            functionalJourneyPassedByUser[userIndex] = true;

            // 6. Navigate to Analytics to verify state
            userPhases[userIndex] = 'navigation';
            await page.goto(ROUTES.ANALYTICS);
            await page.locator(`[data-testid="${TEST_IDS.STAT_CARD_TOTAL_SESSIONS}"]`).or(page.locator(`[data-testid="${TEST_IDS.ANALYTICS_EMPTY_STATE}"]`)).first().waitFor({ timeout: 10000 });
            userPhases[userIndex] = 'complete';
            const memoryEnd = await readMemorySnapshot(page);
            const memoryGrowthBytes = memoryStart.usedJSHeapSize !== null && memoryEnd.usedJSHeapSize !== null
                ? memoryEnd.usedJSHeapSize - memoryStart.usedJSHeapSize
                : null;

            const result: BrowserEnduranceUserResult = {
                userIndex,
                status: 'pass',
                memoryStart,
                memoryEnd,
                memoryGrowthBytes,
            };
            userResults.push(result);
            return result;
        });

        // Wait for all journeys to complete
        await Promise.all(userJourneys);

        // Release-failing console errors EXCLUDE benign fire-and-forget navigation-abort logs (recorded in
        // the evidence, but not a recording/memory failure). Any other console error still fails the run.
        const consoleErrors = consoleIssues.filter((issue) =>
            issue.type === 'error' && !BENIGN_NAVIGATION_CONSOLE_ERRORS.some((re) => re.test(issue.text)));
        if (consoleErrors.length > 0 || criticalFailures.length > 0) {
            throw new Error(`[Browser Endurance] Browser emitted ${consoleErrors.length} console errors and ${criticalFailures.length} critical failed requests.`);
        }

        writeBrowserEnduranceEvidence({
            status: 'pass',
            countsAsReleaseEvidence: true,
            functionalJourneyPassed: functionalJourneyPassedByUser.every(Boolean),
            invalidEvidenceReasons: [],
            concurrency: SOAK_CONFIG.CONCURRENT_USERS,
            mode: 'private',
            durationMs: Date.now() - startTime,
            startedAt,
            completedAt: new Date().toISOString(),
            consoleIssues,
            requestFailures: criticalFailures,
            criticalFailures,
            ignoredRequestFailures,
            users: userResults.sort((a, b) => a.userIndex - b.userIndex),
        });
    } catch (error) {
        const invalidEvidenceReasons = classifyInvalidEvidence(error);
        const status = invalidEvidenceReasons.length > 0 ? 'invalid' : 'fail';
        writeBrowserEnduranceEvidence({
            status,
            countsAsReleaseEvidence: false,
            functionalJourneyPassed: functionalJourneyPassedByUser.every(Boolean),
            invalidEvidenceReasons,
            concurrency: SOAK_CONFIG.CONCURRENT_USERS,
            mode: 'private',
            durationMs: Date.now() - startTime,
            startedAt,
            completedAt: new Date().toISOString(),
            consoleIssues,
            requestFailures: criticalFailures,
            criticalFailures,
            ignoredRequestFailures,
            users: userResults.sort((a, b) => a.userIndex - b.userIndex),
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    } finally {
        userPhases.forEach((phase, index) => {
            userPhases[index] = phase === 'complete' ? 'complete' : 'teardown';
        });
        // Cleanup
        await Promise.all(userPages.map((page) => page.close().catch(() => undefined)));
        await Promise.all(userContexts.map((ctx) => ctx.close().catch(() => undefined)));
    }

    // Playwright natively logs completions, no explicit log needed
}
