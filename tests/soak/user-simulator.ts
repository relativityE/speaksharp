import type { Page } from '@playwright/test';
import { MetricsCollector } from './metrics-collector';

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
     */
    async simulateUserJourney(page: Page, userId: string): Promise<void> {
        try {
            // Step 1: Login
            await this.login(page, userId);

            // Step 2: Navigate to session page
            await this.navigateToSessions(page);

            // Step 3: Start a practice session
            await this.startPracticeSession(page);

            // Step 4: Run session for configured duration
            await this.runActiveSession(page);

            // Step 5: Stop session
            await this.stopPracticeSession(page);

            // Step 6: Navigate to analytics
            await this.navigateToAnalytics(page);

            this.metrics.recordSuccess();
        } catch (error) {
            console.error(`[User ${userId}] Error during journey:`, error);
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

        await page.goto('/sessions');
        await page.waitForSelector('[data-testid="session-sidebar"]', {
            timeout: 5000
        });

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

            const nativeOption = page.getByText('Native', { exact: true });
            await nativeOption.click();
        }

        // Click start session button
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // Wait for session to become active
        await page.waitForSelector('[data-testid="session-status-indicator"]:has-text("Session Active")', {
            timeout: 10000,
        });

        this.metrics.recordResponseTime(Date.now() - startTime);
        console.log(`[User] ✓ Session started (Native mode: ${this.config.useNativeMode})`);
    }

    /**
     * Run session for the configured duration, monitoring memory
     */
    private async runActiveSession(page: Page): Promise<void> {
        const checkInterval = 10000; // Check every 10 seconds
        const iterations = Math.floor(this.config.sessionDuration / checkInterval);

        for (let i = 0; i < iterations; i++) {
            await page.waitForTimeout(checkInterval);

            // Track memory if enabled
            if (this.config.trackMemory) {
                await this.metrics.recordMemoryUsage(page);
            }

            // Verify session is still active
            const statusIndicator = page.getByTestId('session-status-indicator');
            const statusText = await statusIndicator.textContent();

            if (statusText !== 'Session Active') {
                console.warn(`[User] Session status changed unexpectedly: ${statusText}`);
                this.metrics.recordError();
                break;
            }
        }
    }

    /**
     * Stop the practice session
     */
    private async stopPracticeSession(page: Page): Promise<void> {
        const startTime = Date.now();

        const stopButton = page.getByTestId('session-start-stop-button');
        await stopButton.click();

        // Handle the session end dialog OR the "No speech detected" state (Toast or Empty Panel)
        const dialogLocator = page.locator('div[role="alertdialog"]');
        const emptyStateLocator = page.getByText('No speech was detected during the session');
        const toastLocator = page.getByText('No speech was detected. Session not saved');

        const sessionEndLocator = dialogLocator.or(emptyStateLocator).or(toastLocator);
        await sessionEndLocator.first().waitFor();

        if (await dialogLocator.isVisible()) {
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            await stayButton.click();
        } else {
            console.log(`[User] Session ended without speech (Toast or Empty State detected).`);
        }

        this.metrics.recordResponseTime(Date.now() - startTime);
        console.log(`[User] ✓ Session stopped`);
    }

    /**
     * Navigate to analytics page
     */
    private async navigateToAnalytics(page: Page): Promise<void> {
        const startTime = Date.now();

        await page.goto('/analytics');

        // Wait for analytics dashboard to load (either stats or empty state)
        const statsLocator = page.locator('[data-testid="stat-card-total-sessions"]');
        const emptyStateLocator = page.locator('[data-testid="analytics-dashboard-empty-state"]');

        await statsLocator.or(emptyStateLocator).first().waitFor({ timeout: 5000 });

        this.metrics.recordResponseTime(Date.now() - startTime);
    }

    /**
     * Introduce random delays to simulate human behavior
     */
    private async randomDelay(minMs: number = 500, maxMs: number = 2000): Promise<void> {
        const delay = Math.random() * (maxMs - minMs) + minMs;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}
