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

    console.log(`[Soak Test] [Auth Start] User ${userIndex} logging in...`);
    console.log(`[Soak Test]   Target User: ${credentials.email}`);

    // Navigate to sign-in page
    const navStart = Date.now();
    await page.goto(ROUTES.SIGN_IN);
    console.log(`[Soak Test] [Nav] Sign-in page loaded in ${Date.now() - navStart}ms`);

    // Wait for auth form to load
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    // Fill in credentials
    await page.fill('input[type="email"]', credentials.email);
    await page.fill('input[type="password"]', credentials.password);

    // CRITICAL FIX: Robustly click and wait for navigation
    console.log(`[Soak Test] [Auth] Submitting credentials...`);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Explicitly WAIT for the redirect to the dashboard/home
    console.log(`[Soak Test] [Auth] Waiting for dashboard redirect...`);

    try {
        await page.waitForURL((url) => {
            return url.pathname === '/session' || url.pathname === '/';
        }, { timeout: 30000 });
    } catch (error) {
        // DIAGNOSTIC: Check if there's an error message on the page
        console.error(`[Soak Test] [Auth Error] Authentication failed for ${credentials.email}`);

        // Scan for common error messages
        const pageContent = await page.textContent('body');
        if (pageContent?.includes('Invalid login credentials')) {
            console.error('[Soak Test] [Auth Error] Message: Invalid login credentials');
        } else if (pageContent?.includes('error') || pageContent?.includes('Failed')) {
            console.error(`[Soak Test] [Auth Error] Potential error found: ${pageContent.substring(0, 200)}...`);
        }

        // Capture a diagnostic screenshot
        const screenshotPath = `test-results/soak/auth-failure-${userIndex}.png`;
        if (!fs.existsSync(path.dirname(screenshotPath))) {
            fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        }
        await page.screenshot({ path: screenshotPath });
        console.log(`[Soak Test] [Auth Error] Diagnostic screenshot saved to: ${screenshotPath}`);

        throw error;
    }

    console.log(`[Soak Test] [Auth Success] Logged in as ${credentials.email}`);

    // Verify application auth state
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 15000 });
    console.log(`[Soak Test] [Auth Success] Nav Sign Out button visible`);

    // Navigate to session page if not already there
    if (!page.url().includes(ROUTES.SESSION)) {
        console.log(`[Soak Test] [Nav] Redirecting to ${ROUTES.SESSION}...`);
        await page.goto(ROUTES.SESSION, { waitUntil: 'networkidle' });
    }

    // Verify session page readiness
    await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 15000 });

    console.log(`[Soak Test] [Auth End] User ${userIndex} fully ready for simulation`);
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
        // Generate and save report
        const report = metrics.generateReport(SOAK_CONFIG.CONCURRENT_USERS);

        // Print to console
        metrics.printSummary(report);

        // Save JSON report
        const reportPath = path.join(
            SOAK_CONFIG.RESULTS_DIR,
            `metrics-${Date.now()}.json`
        );
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        // Save human-readable summary
        const summaryPath = path.join(
            SOAK_CONFIG.RESULTS_DIR,
            `summary-${Date.now()}.txt`
        );
        fs.writeFileSync(summaryPath, generateTextSummary(report));

        console.log(`\n📊 Report saved to: ${reportPath}`);
    });

    test('should handle concurrent users for 5 minutes', async ({ browser }) => {
        const startTime = Date.now();
        console.log(`\n🚀 Starting soak test with ${SOAK_CONFIG.CONCURRENT_USERS} concurrent users...`);
        console.log(`📅 Start time: ${new Date(startTime).toISOString()}`);
        console.log(`⏱️  Duration: ${SOAK_CONFIG.SESSION_DURATION_MS / 1000 / 60} minutes per user\n`);

        // Create multiple browser contexts (simulate separate users)
        const userContexts = await Promise.all(
            Array.from({ length: SOAK_CONFIG.CONCURRENT_USERS }, () =>
                browser.newContext({
                    viewport: { width: 1280, height: 720 },
                    // Unique storage state per user
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
        const report = metrics.generateReport(SOAK_CONFIG.CONCURRENT_USERS);

        // All users should complete successfully
        expect(report.metrics.successCount).toBe(SOAK_CONFIG.CONCURRENT_USERS);
        expect(report.metrics.errorCount).toBe(0);

        // Response times should be reasonable (< 5s for any operation)
        expect(report.metrics.responseTime.p95).toBeLessThan(5000);

        // Memory should not grow excessively (< 200MB)
        if (report.metrics.memoryUsage.count > 0) {
            expect(report.metrics.memoryUsage.max).toBeLessThan(200);
        }
    });
});

/**
 * Generate human-readable text summary
 */
function generateTextSummary(report: ReturnType<MetricsCollector['generateReport']>): string {
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════');
    lines.push('        SOAK TEST SUMMARY REPORT');
    lines.push('═══════════════════════════════════════════════\n');

    lines.push(`Test Start:       ${new Date(report.startTime).toISOString()}`);
    lines.push(`Test End:         ${new Date(report.endTime).toISOString()}`);
    lines.push(`Duration:         ${(report.duration / 1000).toFixed(1)}s`);
    lines.push(`Concurrent Users: ${report.concurrentUsers}\n`);

    lines.push('───────────────────────────────────────────────');
    lines.push('RESULTS:');
    lines.push('───────────────────────────────────────────────');
    lines.push(`✅ Successful Operations: ${report.metrics.successCount}`);
    lines.push(`❌ Failed Operations:     ${report.metrics.errorCount}`);
    lines.push(`📊 Success Rate:          ${((report.metrics.successCount / (report.metrics.successCount + report.metrics.errorCount)) * 100).toFixed(1)}%\n`);

    lines.push('───────────────────────────────────────────────');
    lines.push('RESPONSE TIME (ms):');
    lines.push('───────────────────────────────────────────────');
    lines.push(`Min:     ${report.metrics.responseTime.min.toFixed(2)}`);
    lines.push(`Max:     ${report.metrics.responseTime.max.toFixed(2)}`);
    lines.push(`Avg:     ${report.metrics.responseTime.avg.toFixed(2)}`);
    lines.push(`Median:  ${report.metrics.responseTime.median.toFixed(2)}`);
    lines.push(`P95:     ${report.metrics.responseTime.p95.toFixed(2)}`);
    lines.push(`P99:     ${report.metrics.responseTime.p99.toFixed(2)}\n`);

    if (report.metrics.memoryUsage.count > 0) {
        lines.push('───────────────────────────────────────────────');
        lines.push('MEMORY USAGE (MB):');
        lines.push('───────────────────────────────────────────────');
        lines.push(`Min:     ${report.metrics.memoryUsage.min.toFixed(2)}`);
        lines.push(`Max:     ${report.metrics.memoryUsage.max.toFixed(2)}`);
        lines.push(`Avg:     ${report.metrics.memoryUsage.avg.toFixed(2)}`);
        lines.push(`P95:     ${report.metrics.memoryUsage.p95.toFixed(2)}\n`);
    }

    lines.push('═══════════════════════════════════════════════\n');

    return lines.join('\n');
}
