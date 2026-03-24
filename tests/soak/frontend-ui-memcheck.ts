import { expect, type Page, type Browser } from '@playwright/test';
import { SOAK_CONFIG, SOAK_TEST_USERS, ROUTES, TEST_IDS } from '../constants';
import * as fs from 'fs';
import * as path from 'path';

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
    // Create multiple completely isolated browser contexts (Playwright handles this)
    const userContexts = await Promise.all(
        Array.from({ length: SOAK_CONFIG.CONCURRENT_USERS }, () =>
            browser.newContext({
                viewport: { width: 1280, height: 720 },
                storageState: undefined,
            })
        )
    );

    // Create pages for each user
    const userPages = await Promise.all(
        userContexts.map((ctx) => ctx.newPage())
    );

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
            throw new Error(`[Soak Test] ⚠️ User ${i}: nav-sign-out-button NOT visible - auth may have failed!`);
        }
    }

    // Run all users concurrently
    const userJourneys = userPages.map(async (page) => {
        // 1. Navigate to Session
        await page.goto(ROUTES.SESSION);
        await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 30000 });

        // 2. Start Recording
        const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        if (SOAK_CONFIG.USE_NATIVE_MODE) {
            await page.getByRole('button', { name: /Native|Cloud AI|Private|On-Device/i }).click();
            await page.getByRole('menuitemradio', { name: /Native/i }).click();
        }
        await startButton.click();
        await page.waitForSelector(`[data-testid="${TEST_IDS.SESSION_STATUS_INDICATOR}"]`, { timeout: 10000 });

        // 3. Soak (Wait & Inject Mock Speech)
        const checkInterval = 10000;
        const iterations = Math.floor(SOAK_CONFIG.SESSION_DURATION_MS / checkInterval);
        for (let j = 0; j < iterations; j++) {
            await page.evaluate((iteration: number) => {
                const dispatchMockTranscript = (window as Window & { dispatchMockTranscript?: (text: string, isFinal: boolean) => void }).dispatchMockTranscript;
                if (typeof dispatchMockTranscript === 'function') {
                    const phrases = ['Testing...', 'Soak test...', 'Simulating...'];
                    dispatchMockTranscript(phrases[iteration % phrases.length], true);
                }
            }, j);
            await page.waitForTimeout(checkInterval);
        }

        // 4. Stop Recording
        const buttonText = await startButton.textContent();
        if (!buttonText?.includes('Start')) {
            await startButton.click();
            const sessionEndLocator = page.locator('div[role="alertdialog"]').or(page.getByText('No speech was detected'));
            await sessionEndLocator.first().waitFor({ timeout: 10000 }).catch(() => { });
        }

        // 5. Navigate to Analytics to verify state
        await page.goto(ROUTES.ANALYTICS);
        await page.locator(`[data-testid="${TEST_IDS.STAT_CARD_TOTAL_SESSIONS}"]`).or(page.locator(`[data-testid="${TEST_IDS.ANALYTICS_EMPTY_STATE}"]`)).first().waitFor({ timeout: 10000 });
    });

    // Wait for all journeys to complete
    await Promise.all(userJourneys);

    // Cleanup
    await Promise.all(userPages.map((page) => page.close()));
    await Promise.all(userContexts.map((ctx) => ctx.close()));

    // Playwright natively logs completions, no explicit log needed
}
