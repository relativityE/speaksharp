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

type BrowserEnduranceEvidence = {
    schemaVersion: 1;
    kind: 'browser-endurance';
    run: {
        githubRunId: string | null;
        githubRunAttempt: string | null;
        commitSha: string | null;
        actor: string | null;
    };
    status: 'pass' | 'fail';
    concurrency: number;
    mode: 'native' | 'configured-default';
    durationMs: number;
    startedAt: string;
    completedAt: string;
    consoleIssues: Array<{ userIndex: number; type: string; text: string }>;
    requestFailures: Array<{ userIndex: number; url: string; errorText: string | null }>;
    ignoredRequestFailures?: Array<{ userIndex: number; url: string; errorText: string | null; reason: string }>;
    users: BrowserEnduranceUserResult[];
    error?: string;
};

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
                forceNativeMode?: boolean;
                registry?: Record<string, (options?: SttOptions) => unknown>;
                _activeCallbacks?: SttOptions;
            };
            __SS_E2E_ENGINE_CACHE__?: Record<string, unknown>;
            TEST_MODE?: boolean;
        };

        const win = window as SoakWindow;
        win.TEST_MODE = true;
        win.__SS_E2E_ENGINE_CACHE__ = win.__SS_E2E_ENGINE_CACHE__ || {};

        const minimalStubFactory = (mode: string) => (options?: SttOptions) => {
            const cache = win.__SS_E2E_ENGINE_CACHE__ || {};
            win.__SS_E2E_ENGINE_CACHE__ = cache;
            const cacheKey = `soak-${mode}`;
            if (cache[cacheKey]) return cache[cacheKey];

            const instance = {
                instanceId: `soak-${mode}-${Math.random().toString(36).slice(2)}`,
                checkAvailability: async () => ({ isAvailable: true }),
                init: async () => {
                    win.__SS_E2E__ = win.__SS_E2E__ || { isActive: true };
                    options?.onReady?.();
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
                getTranscript: async () => '',
                emitTranscript: (text: string, isFinal: boolean = true) => {
                    const update = {
                        transcript: isFinal ? { final: text } : { partial: text },
                        isFinal,
                        isPartial: !isFinal,
                        timestamp: Date.now(),
                    };
                    options?.onTranscriptUpdate?.(update);
                    win.__SS_E2E__?._activeCallbacks?.onTranscriptUpdate?.(update);
                },
            };
            cache[cacheKey] = instance;
            return instance;
        };

        win.__SS_E2E__ = {
            ...(win.__SS_E2E__ || {}),
            isActive: true,
            engineType: 'mock',
            forceNativeMode: true,
            registry: {
                ...(win.__SS_E2E__?.registry || {}),
                'native-browser': minimalStubFactory('native-browser'),
                'transformers-js': minimalStubFactory('transformers-js'),
                'transformers-js-v4': minimalStubFactory('transformers-js-v4'),
                'whisper-turbo': minimalStubFactory('whisper-turbo'),
                assemblyai: minimalStubFactory('assemblyai'),
                mock: minimalStubFactory('mock'),
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
        schemaVersion: 1,
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

function getIgnorableRequestFailureReason(failure: { url: string; errorText: string | null }): string | null {
    if (failure.errorText !== 'net::ERR_ABORTED') return null;

    const isSupabaseRead = failure.url.includes('/rest/v1/sessions?select=');
    return isSupabaseRead
        ? 'Supabase sessions read was aborted during normal route/context teardown after functional checks passed.'
        : null;
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

    // Verify session page readiness
    await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 30000 });
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
    const requestFailures: BrowserEnduranceEvidence['requestFailures'] = [];
    const ignoredRequestFailures: NonNullable<BrowserEnduranceEvidence['ignoredRequestFailures']> = [];
    const userResults: BrowserEnduranceUserResult[] = [];
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
                    errorText: request.failure()?.errorText ?? null,
                };
                const reason = getIgnorableRequestFailureReason(failure);
                if (reason) {
                    ignoredRequestFailures.push({ ...failure, reason });
                } else {
                    requestFailures.push(failure);
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
            await page.goto(ROUTES.SESSION);
            await installSoakSttBridge(page);
            await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 30000 });

            // 2. Force Browser/Native STT before recording. This endurance
            // proof tracks browser stability; Private model download/cache
            // behavior belongs to dedicated Private proofs.
            const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
            if (SOAK_CONFIG.USE_NATIVE_MODE) {
                const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
                await expect(modeSelect).toBeVisible({ timeout: 15000 });
                await modeSelect.click();
                await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).click();
                await expect(modeSelect).toHaveAttribute('data-state', 'native', { timeout: 10000 });
            }

            // 3. Start Recording. If this is disabled, fail with the selected
            // mode so stale Private/download gating is obvious in logs.
            await expect(startButton).toBeEnabled({ timeout: 10000 });
            await startButton.click();
            await page.waitForSelector(`[data-testid="${TEST_IDS.SESSION_STATUS_INDICATOR}"]`, { timeout: 10000 });
            await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 10000 });

            // 4. Endurance wait. Native transcript output is browser-owned,
            // so this path validates sustained recording stability rather
            // than mocked transcript accuracy.
            const checkInterval = 10000;
            const iterations = Math.floor(SOAK_CONFIG.SESSION_DURATION_MS / checkInterval);
            for (let j = 0; j < iterations; j++) {
                await page.waitForTimeout(checkInterval);
            }

            // 5. Stop Recording
            const buttonText = await startButton.textContent();
            if (!buttonText?.includes('Start')) {
                await startButton.click();
                const sessionEndLocator = page.locator('div[role="alertdialog"]').or(page.getByText('No speech was detected'));
                await sessionEndLocator.first().waitFor({ timeout: 10000 }).catch(() => { });
            }

            // 6. Navigate to Analytics to verify state
            await page.goto(ROUTES.ANALYTICS);
            await page.locator(`[data-testid="${TEST_IDS.STAT_CARD_TOTAL_SESSIONS}"]`).or(page.locator(`[data-testid="${TEST_IDS.ANALYTICS_EMPTY_STATE}"]`)).first().waitFor({ timeout: 10000 });
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

        const consoleErrors = consoleIssues.filter((issue) => issue.type === 'error');
        if (consoleErrors.length > 0 || requestFailures.length > 0) {
            throw new Error(`[Browser Endurance] Browser emitted ${consoleErrors.length} console errors and ${requestFailures.length} failed requests.`);
        }

        writeBrowserEnduranceEvidence({
            status: 'pass',
            concurrency: SOAK_CONFIG.CONCURRENT_USERS,
            mode: SOAK_CONFIG.USE_NATIVE_MODE ? 'native' : 'configured-default',
            durationMs: Date.now() - startTime,
            startedAt,
            completedAt: new Date().toISOString(),
            consoleIssues,
            requestFailures,
            ignoredRequestFailures,
            users: userResults.sort((a, b) => a.userIndex - b.userIndex),
        });
    } catch (error) {
        writeBrowserEnduranceEvidence({
            status: 'fail',
            concurrency: SOAK_CONFIG.CONCURRENT_USERS,
            mode: SOAK_CONFIG.USE_NATIVE_MODE ? 'native' : 'configured-default',
            durationMs: Date.now() - startTime,
            startedAt,
            completedAt: new Date().toISOString(),
            consoleIssues,
            requestFailures,
            ignoredRequestFailures,
            users: userResults.sort((a, b) => a.userIndex - b.userIndex),
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    } finally {
        // Cleanup
        await Promise.all(userPages.map((page) => page.close().catch(() => undefined)));
        await Promise.all(userContexts.map((ctx) => ctx.close().catch(() => undefined)));
    }

    // Playwright natively logs completions, no explicit log needed
}
