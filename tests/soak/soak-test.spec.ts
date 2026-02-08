import { test, expect, type Page } from '@playwright/test';
import { MetricsCollector } from './metrics-collector';
import { UserSimulator } from './user-simulator';
import { SOAK_CONFIG, SOAK_TEST_USERS, ROUTES, TEST_IDS } from '../constants';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper to set up authenticated test user using REAL Supabase login
 * Each concurrent user gets different credentials to avoid session conflicts
 */
async function setupAuthenticatedUser(page: Page, userIndex: number): Promise<void> {
    const credentials = SOAK_TEST_USERS[userIndex % SOAK_TEST_USERS.length];

    // Navigate to sign-in page
    const start = Date.now();
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
        await page.goto(ROUTES.SESSION, { waitUntil: 'networkidle' });
    }

    // Verify application auth state
    await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible({ timeout: 30000 });

    // Verify session page readiness
    console.log(`[Soak Test] User ${userIndex} on: ${page.url()}`);
    await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 30000 });

    console.log(`[Auth OK] User ${userIndex} (${credentials.email}) in ${Date.now() - start}ms`);
}

test.describe('Soak Test - Concurrent User Simulation', () => {
    let metrics: MetricsCollector;

    test.beforeAll(() => {
        // Ensure results directory exists
        if (!fs.existsSync(SOAK_CONFIG.RESULTS_DIR)) {
            fs.mkdirSync(SOAK_CONFIG.RESULTS_DIR, { recursive: true });
        }
    });

    test.beforeEach(() => {
        metrics = new MetricsCollector();
    });

    test.afterEach(async () => {
        // Generate metrics for console summary
        const numFree = parseInt(process.env.NUM_FREE_USERS || '0', 10);
        const numPro = parseInt(process.env.NUM_PRO_USERS || '0', 10);
        const activeUsers = (numFree + numPro) || 3;

        const report = metrics.generateReport(activeUsers);

        // Print summary to console only (No file bloat as requested)
        metrics.printSummary(report);
    });

    test('should verify UI stability under moderate concurrency (Smoke Test)', async ({ browser }) => {
        const numFree = parseInt(process.env.NUM_FREE_USERS || '0', 10);
        const numPro = parseInt(process.env.NUM_PRO_USERS || '0', 10);
        const SMOKE_CONCURRENCY = (numFree + numPro) || 3;
        const startTime = Date.now();
        console.log(`\n🚀 Starting Performance Smoke Test with ${SMOKE_CONCURRENCY} concurrent users...`);
        console.log(`📅 Start time: ${new Date(startTime).toISOString()}`);
        console.log(`⏱️  Duration: ${SOAK_CONFIG.SESSION_DURATION_MS / 1000 / 60} minutes per user\n`);

        // Create multiple browser contexts (simulate separate users)
        const userContexts = await Promise.all(
            Array.from({ length: SMOKE_CONCURRENCY }, () =>
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
        console.log('\n[Soak Test] 🔍 DIAGNOSTIC: Verifying auth state for all users...');
        for (let i = 0; i < userPages.length; i++) {
            const page = userPages[i];
            const url = page.url();
            const signOutVisible = await page.locator('[data-testid="nav-sign-out-button"]').isVisible().catch(() => false);
            const startButtonVisible = await page.locator('[data-testid="session-start-stop-button"]').isVisible().catch(() => false);
            console.log(`[Soak Test] User ${i}: URL=${url}, SignOutBtn=${signOutVisible}, StartBtn=${startButtonVisible}`);

            if (!signOutVisible) {
                console.error(`[Soak Test] ⚠️ User ${i}: nav-sign-out-button NOT visible - auth may have failed!`);
                // Capture screenshot for debugging
                await page.screenshot({ path: `test-results/soak/debug-user-${i}-auth-state.png` });
            }
        }
        console.log('[Soak Test] 🔍 DIAGNOSTIC complete\n');

        // Create simulators for each user
        const simulators = userPages.map(
            () =>
                new UserSimulator(metrics, {
                    sessionDuration: SOAK_CONFIG.SESSION_DURATION_MS,
                    useNativeMode: SOAK_CONFIG.USE_NATIVE_MODE,
                    trackMemory: SOAK_CONFIG.TRACK_MEMORY,
                })
        );

        // Run all users concurrently
        const userJourneys = simulators.map((simulator, i) => {
            const page = userPages[i];
            const userId = `user-${i}`;

            console.log(`[User ${i}] 🏁 Starting journey...`);

            return simulator.simulateUserJourney(page, userId).catch((error) => {
                console.error(`[User ${i}] ❌ Journey failed:`, error);
                metrics.recordError();
            });
        });

        // Wait for all journeys to complete
        await Promise.all(userJourneys);

        // Cleanup
        await Promise.all(userPages.map((page) => page.close()));
        await Promise.all(userContexts.map((ctx) => ctx.close()));

        const endTime = Date.now();
        const durationSec = (endTime - startTime) / 1000;

        console.log(`\n✅ Soak test completed in ${durationSec.toFixed(1)}s`);

        // Assertions to verify test health
        const report = metrics.generateReport(SMOKE_CONCURRENCY);

        // All users should complete successfully
        expect(report.metrics.successCount).toBe(SMOKE_CONCURRENCY);
        expect(report.metrics.errorCount).toBe(0);

        // Response times should be reasonable
        expect(report.metrics.responseTime.p95).toBeLessThan(SOAK_CONFIG.P95_THRESHOLD_MS);

        // Memory should not grow excessively
        if (report.metrics.memoryUsage.count > 0) {
            expect(report.metrics.memoryUsage.max).toBeLessThan(SOAK_CONFIG.MAX_MEMORY_MB);
        }
    });
});


