import type { Page } from '@playwright/test';
import { MetricsCollector } from './metrics-collector';
import { navigateToRoute } from '../e2e/helpers';
import { ROUTES, TEST_IDS, TIMEOUTS } from '../constants';

/**
 * Configuration for user simulation
 */
export interface UserSimulatorConfig {
    /** Duration of each practice session in milliseconds (default: 5 minutes) */
    sessionDuration?: number;
    /** Use Native Browser mode instead of Cloud AI to save API credits */
    useNativeMode?: boolean;
    /** Enable memory tracking (requires Chrome with --enable-precise-memory-info) */
    trackMemory?: boolean;
}

/**
 * Simulates realistic user behavior for soak testing
 */
export class UserSimulator {
    private metrics: MetricsCollector;
    private config: Required<UserSimulatorConfig>;

    constructor(metrics: MetricsCollector, config: UserSimulatorConfig = {}) {
        this.metrics = metrics;
        this.config = {
            sessionDuration: config.sessionDuration ?? 5 * 60 * 1000, // 5 minutes default
            useNativeMode: config.useNativeMode ?? true, // Default to Native to save credits
            trackMemory: config.trackMemory ?? false,
        };
    }

    /**
     * Simulate a complete user journey
     * NOTE: Auth is handled by setupAuthenticatedUser in soak-test.spec.ts BEFORE this is called.
     * Do NOT call login() here - it would redundantly navigate and break auth state.
     */
    async simulateUserJourney(page: Page, userId: string): Promise<void> {
        try {
            // Step 1: Navigate to session page
            await this.navigateToSessions(page);

            // Step 2: Start a practice session
            await this.startPracticeSession(page);

            // Step 3: Run session for configured duration
            await this.runActiveSession(page, userId);

            // Step 4: Stop session
            await this.stopPracticeSession(page, userId);

            // Step 5: Navigate to analytics
            await this.navigateToAnalytics(page, userId);

            this.metrics.recordSuccess();
        } catch (error) {
            console.error(`[User ${userId}] ❌ Journey failed:`, error);
            this.metrics.recordError();
        }
    }

    /**
     * Login to the application
     */
    private async login(page: Page, userId: string): Promise<void> {
        const startTime = Date.now();

        await page.goto('/');

        // Use programmatic login from test helpers
        await page.evaluate(() => {
            // This will be handled by the test setup with programmaticLogin
        });

        // Wait for authentication to complete
        await page.waitForSelector('[data-testid="nav-sign-out-button"]', {
            timeout: 10000
        });

        this.metrics.recordResponseTime(Date.now() - startTime);
        console.log(`[User ${userId}] ✓ Logged in`);
    }

    /**
     * Navigate to the sessions page
     */
    private async navigateToSessions(page: Page): Promise<void> {
        const startTime = Date.now();

        console.log(`[User] 📍 Navigating to session page: ${ROUTES.SESSION}`);
        await page.goto(ROUTES.SESSION, { waitUntil: 'networkidle' });
        console.log(`[User] 📍 Current URL: ${page.url()}`);

        // Wait for the session page to fully load - look for the start/stop button
        console.log(`[User] ⏳ Waiting for start button...`);
        try {
            await page.waitForSelector(`[data-testid="${TEST_IDS.SESSION_START_STOP_BUTTON}"]`, {
                timeout: TIMEOUTS.PAGE_LOAD
            });
            console.log(`[User] ✅ Session page loaded, start button visible`);
        } catch {
            // Capture what we see for debugging
            const bodyText = await page.textContent('body');
            console.log(`[User] ❌ Start button not found! Page body (first 1000 chars):`);
            console.log(bodyText?.substring(0, 1000));
            await page.screenshot({ path: `test-results/soak/debug-session-${Date.now()}.png` });
            console.log(`[User] 📸 Screenshot saved`);
            throw new Error(`Start button not found on session page. URL: ${page.url()}`);
        }

        this.metrics.recordResponseTime(Date.now() - startTime);
    }

    /**
     * Start a practice session
     */
    private async startPracticeSession(page: Page): Promise<void> {
        const startTime = Date.now();

        // Select native mode if configured (to save API credits)
        if (this.config.useNativeMode) {
            const modeButton = page.getByRole('button', { name: /Native|Cloud AI|On-Device/ });
            await modeButton.click();

            // Use menuitemradio role to target the actual menu item, not the trigger button
            const nativeOption = page.getByRole('menuitemradio', { name: 'Native' });
            await nativeOption.click();
        }

        // Click start session button
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // Wait for session to become active (status shows READY when ready)
        await page.waitForSelector('[data-testid="session-status-indicator"]', {
            timeout: 10000,
        });

        this.metrics.recordResponseTime(Date.now() - startTime);
        console.log(`[User] ✓ Session started (Native mode: ${this.config.useNativeMode})`);
    }

    /**
     * Run session for the configured duration, monitoring memory
     * In E2E mode, we simulate speech to keep the session active
     */
    private async runActiveSession(page: Page, userId: string): Promise<void> {
        const checkInterval = 10000;
        const iterations = Math.floor(this.config.sessionDuration / checkInterval);
        let lastStatus: string | null = null;
        const progressLogInterval = 6; // Log every 6 iterations (60 seconds = 1 minute heartbeat)

        console.log(`[User ${userId}] 🏁 Journey: Practice Session started (${(this.config.sessionDuration / 60000).toFixed(1)}m)`);

        for (let i = 0; i < iterations; i++) {
            // Simulate speech input
            await page.evaluate((iteration: number) => {
                const dispatchMockTranscript = (window as Window & { dispatchMockTranscript?: (text: string, isFinal: boolean) => void }).dispatchMockTranscript;
                if (typeof dispatchMockTranscript === 'function') {
                    const phrases = ['Testing...', 'Soak test...', 'Simulating...'];
                    dispatchMockTranscript(phrases[iteration % phrases.length], true);
                }
            }, i);

            await page.waitForTimeout(checkInterval);

            // Track memory if enabled
            if (this.config.trackMemory) await this.metrics.recordMemoryUsage(page);

            // Verify session status
            const statusIndicator = page.getByTestId('session-status-indicator');
            const statusText = (await statusIndicator.textContent()) || 'Unknown';

            // Log on status CHANGE
            if (statusText !== lastStatus) {
                if (statusText === 'Session Active') {
                    console.log(`[User ${userId}] ✓ Session Active`);
                } else {
                    console.warn(`[User ${userId}] ⚠️ Status Change: ${statusText} (at ${i}/${iterations})`);
                }
                lastStatus = statusText;
            }

            // Periodic progress log (every 30 seconds)
            if ((i + 1) % progressLogInterval === 0) {
                const elapsedSeconds = (i + 1) * (checkInterval / 1000);
                const remainingSeconds = ((iterations - i - 1) * checkInterval) / 1000;
                console.log(`[User ${userId}] ⏱️ Progress: ${elapsedSeconds}s elapsed, ${remainingSeconds}s remaining`);
            }
        }
        console.log(`[User ${userId}] 🏁 Journey: Practice Session complete`);
    }

    /**
     * Stop the practice session
     */
    private async stopPracticeSession(page: Page, userId: string): Promise<void> {
        const startTime = Date.now();

        const stopButton = page.getByTestId('session-start-stop-button');
        const buttonText = await stopButton.textContent();

        // If session already stopped (button says "Start"), don't click it again
        if (buttonText?.includes('Start')) {
            this.metrics.recordResponseTime(Date.now() - startTime);
            return;
        }

        await stopButton.click();

        // Handle the session end dialog OR the "No speech detected" state
        const dialogLocator = page.locator('div[role="alertdialog"]');
        const emptyStateLocator = page.getByText('No speech was detected during the session');
        const toastLocator = page.getByText('No speech was detected. Session not saved');
        const buttonShowsStart = stopButton.filter({ hasText: 'Start' });

        const sessionEndLocator = dialogLocator.or(emptyStateLocator).or(toastLocator).or(buttonShowsStart);
        await sessionEndLocator.first().waitFor({ timeout: 10000 });

        if (await dialogLocator.isVisible()) {
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            await stayButton.click();
        }

        this.metrics.recordResponseTime(Date.now() - startTime);
        console.log(`[User ${userId}] ✓ Session Stopped`);
    }

    /**
     * Navigate to analytics page
     */
    private async navigateToAnalytics(page: Page, userId: string): Promise<void> {
        const startTime = Date.now();

        // Use navigateToRoute helper to preserve auth context
        await navigateToRoute(page, ROUTES.ANALYTICS);

        // Wait for analytics dashboard to load (either stats or empty state)
        const statsLocator = page.locator(`[data-testid="${TEST_IDS.STAT_CARD_TOTAL_SESSIONS}"]`);
        const emptyStateLocator = page.locator('[data-testid="analytics-dashboard-empty-state"]');

        await statsLocator.or(emptyStateLocator).first().waitFor({ timeout: TIMEOUTS.SHORT });

        this.metrics.recordResponseTime(Date.now() - startTime);
        console.log(`[User ${userId}] ✓ Analytics Loaded`);
    }

    /**
     * Introduce random delays to simulate human behavior
     */
    private async randomDelay(minMs: number = 500, maxMs: number = 2000): Promise<void> {
        const delay = Math.random() * (maxMs - minMs) + minMs;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}
