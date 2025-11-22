import { test, expect, type Page } from '@playwright/test';
import { MetricsCollector } from './metrics-collector';
import { UserSimulator } from './user-simulator';
import fs from 'fs';
import path from 'path';

/**
 * Configuration for soak test
 */
const SOAK_CONFIG = {
    // Budget-aware defaults for alpha testing
    concurrentUsers: 2, // Free Supabase tier handles 10 connections, 2 users is safe
    sessionDuration: 5 * 60 * 1000, // 5 minutes (per user request)
    useNativeMode: true, // Avoid AssemblyAI costs
    trackMemory: true, // Monitor for memory leaks
    resultsDir: 'test-results/soak',
};

/**
 * Helper to set up authenticated test user using REAL Supabase auth
 * Uses existing test users from database:
 * - User 0: test@test.com
 * - User 1: soak-test-0@example.com
 */
async function setupAuthenticatedUser(page: Page, userId: string): Promise<void> {
    // Map user IDs to actual emails in database
    const userCredentials: Record<string, { email: string; password: string }> = {
        'user-0': { email: 'test@test.com', password: 'TestPass123!' },
        'user-1': { email: 'soak-test-0@example.com', password: 'soak-test-password-123' },
    };


    const credentials = userCredentials[userId];
    if (!credentials) {
        throw new Error(`No credentials configured for ${userId}`);
    }

    // Navigate to auth page
    await page.goto('/auth');

    // Wait for auth form to load
    await page.waitForSelector('[data-testid="email-input"]', { timeout: 5000 });

    // Fill in credentials
    await page.fill('[data-testid="email-input"]', credentials.email);
    await page.fill('[data-testid="password-input"]', credentials.password);

    // Click sign in button
    await page.click('[data-testid="sign-in-submit"]');

    // Wait for successful authentication (redirects to home or dashboard)
    await page.waitForSelector('[data-testid="nav-sign-out-button"]', {
        timeout: 15000, // Allow time for Supabase auth
    });

    console.log(`[Soak Test] ✅ ${credentials.email} authenticated successfully`);
}

test.describe('Soak Test - Concurrent User Simulation', () => {
    let metrics: MetricsCollector;

    test.beforeAll(() => {
        // Ensure results directory exists
        if (!fs.existsSync(SOAK_CONFIG.resultsDir)) {
            fs.mkdirSync(SOAK_CONFIG.resultsDir, { recursive: true });
        }
    });

    test.beforeEach(() => {
        metrics = new MetricsCollector();
    });

    test.afterEach(async () => {
        // Generate and save report
        const report = metrics.generateReport(SOAK_CONFIG.concurrentUsers);

        // Print to console
        metrics.printSummary(report);

        // Save JSON report
        const reportPath = path.join(
            SOAK_CONFIG.resultsDir,
            `metrics-${Date.now()}.json`
        );
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        // Save human-readable summary
        const summaryPath = path.join(
            SOAK_CONFIG.resultsDir,
            `summary-${Date.now()}.txt`
        );
        fs.writeFileSync(summaryPath, generateTextSummary(report));

        console.log(`\n📊 Report saved to: ${reportPath}`);
    });

    test('should handle concurrent users for 5 minutes', async ({ browser }) => {
        const startTime = Date.now();
        console.log(`\n🚀 Starting soak test with ${SOAK_CONFIG.concurrentUsers} concurrent users...`);
        console.log(`📅 Start time: ${new Date(startTime).toISOString()}`);
        console.log(`⏱️  Duration: ${SOAK_CONFIG.sessionDuration / 1000 / 60} minutes per user\n`);

        // Create multiple browser contexts (simulate separate users)
        const userContexts = await Promise.all(
            Array.from({ length: SOAK_CONFIG.concurrentUsers }, () =>
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

        // Set up authenticated sessions for each user
        await Promise.all(
            userPages.map((page, i) => setupAuthenticatedUser(page, `user-${i}`))
        );

        // Create simulators for each user
        const simulators = userPages.map(
            () =>
                new UserSimulator(metrics, {
                    sessionDuration: SOAK_CONFIG.sessionDuration,
                    useNativeMode: SOAK_CONFIG.useNativeMode,
                    trackMemory: SOAK_CONFIG.trackMemory,
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
        const report = metrics.generateReport(SOAK_CONFIG.concurrentUsers);

        // All users should complete successfully
        expect(report.metrics.successCount).toBe(SOAK_CONFIG.concurrentUsers);
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
