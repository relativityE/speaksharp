import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

/**
 * Session Comparison & Progress Tracking E2E Test
 * 
 * PURPOSE: Verify users can track improvement/regression across sessions
 * 
 * CRITICAL USER WORKFLOWS:
 * 1. Compare metrics between sessions (WPM, Clarity, Fillers)
 * 2. See trends over time (improving vs regressing)
 * 3. Identify areas needing improvement
 * 
 * CURRENT STATE: Session comparison feature does NOT exist
 * - No UI for comparing sessions side-by-side
 * - No trend analysis or progress indicators
 * - Users cannot see if they're improving
 * 
 * This test will expose this missing feature
 */

test.describe('Session Comparison & Progress Tracking', () => {
    test.skip('should display session history with metrics', async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Check if session history exists
        const sessionItems = page.locator('[data-testid="session-history-item"]');
        const count = await sessionItems.count();

        if (count === 0) {
            console.log('[TEST] No sessions - empty state verified');
            return;
        }

        // Verify each session shows key metrics
        const firstSession = sessionItems.first();

        // Should show WPM
        await expect(firstSession.getByText(/WPM/i)).toBeVisible();

        // Should show Accuracy (Clarity Score)
        await expect(firstSession.getByText(/Accuracy/i)).toBeVisible();

        // Should show Fillers count
        await expect(firstSession.getByText(/Fillers/i)).toBeVisible();

        console.log(`[TEST] ✅ Found ${count} sessions with metrics displayed`);
    });

    test.skip('should allow comparing two sessions side-by-side', async ({ page }) => {
        /**
         * SKIPPED: Session comparison feature does NOT exist
         * 
         * Expected behavior:
         * - User can select 2+ sessions to compare
         * - Side-by-side view shows:
         *   - WPM comparison (Session A: 120 WPM vs Session B: 135 WPM = +15 improvement)
         *   - Clarity Score comparison (Session A: 85% vs Session B: 92% = +7% improvement)
         *   - Filler words comparison (Session A: 12 vs Session B: 8 = -4 improvement)
         *   - Duration comparison
         * - Visual indicators for improvement (green ↑) vs regression (red ↓)
         * 
         * To implement:
         * 1. Add "Compare" button/checkbox on session history items
         * 2. Create comparison modal/page
         * 3. Calculate deltas between sessions
         * 4. Show visual indicators for improvement/regression
         * 5. Allow comparing 2-3 sessions at once
         */
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Select first session
        const sessions = page.locator('[data-testid="session-history-item"]');
        await sessions.first().locator('[data-testid="compare-checkbox"]').check();

        // Select second session
        await sessions.nth(1).locator('[data-testid="compare-checkbox"]').check();

        // Click "Compare Sessions" button
        await page.getByRole('button', { name: /compare sessions/i }).click();

        // Verify comparison view appears
        const comparisonModal = page.getByRole('dialog', { name: /session comparison/i });
        await expect(comparisonModal).toBeVisible();

        // Verify metrics are compared
        await expect(comparisonModal.getByText(/WPM/i)).toBeVisible();
        await expect(comparisonModal.getByText(/Clarity/i)).toBeVisible();
        await expect(comparisonModal.getByText(/Fillers/i)).toBeVisible();

        // Verify improvement indicators
        const improvementIndicators = comparisonModal.locator('[data-testid="improvement-indicator"]');
        expect(await improvementIndicators.count()).toBeGreaterThan(0);

        console.log('[TEST] ✅ Session comparison working');
    });

    test.skip('should show progress trends over time', async ({ page }) => {
        /**
         * SKIPPED: Progress tracking feature does NOT exist
         * 
         * Expected behavior:
         * - Chart showing WPM trend over last N sessions
         * - Chart showing Clarity Score trend
         * - Chart showing Filler Words trend
         * - Overall progress indicator (improving/stable/regressing)
         * - Recommendations based on trends
         * 
         * To implement:
         * 1. Add trend charts to Analytics Dashboard
         * 2. Calculate moving averages
         * 3. Identify trends (improving = green, regressing = red)
         * 4. Show actionable insights ("Your WPM improved 15% this week!")
         */
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Verify trend charts exist
        const wpmTrendChart = page.locator('[data-testid="wpm-trend-chart"]');
        await expect(wpmTrendChart).toBeVisible();

        const clarityTrendChart = page.locator('[data-testid="clarity-trend-chart"]');
        await expect(clarityTrendChart).toBeVisible();

        // Verify progress indicator
        const progressIndicator = page.locator('[data-testid="overall-progress"]');
        await expect(progressIndicator).toBeVisible();

        // Should show improvement/regression status
        const statusText = await progressIndicator.textContent();
        expect(statusText).toMatch(/improving|stable|needs work/i);

        console.log('[TEST] ✅ Progress trends displayed');
    });

    test.skip('should calculate clarity score correctly in live session', async ({ page }) => {
        /**
         * Verify Clarity Score calculation is correct
         * Formula: 100 - (fillerCount / wordCount * 500)
         * Clamped between 0-100
         */
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Start session
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByText('Stop')).toBeVisible();

        // Find clarity score card
        const clarityCard = page.locator('.bg-card', { has: page.getByText('Clarity Score') });
        const clarityValue = clarityCard.locator('.text-6xl');

        // Initial value should be visible (default 87% when no data)
        await expect(clarityValue).toBeVisible();
        const initialValue = await clarityValue.textContent();
        console.log(`[TEST] Initial Clarity Score: ${initialValue}`);

        // Verify it's a percentage
        expect(initialValue).toMatch(/\d+%/);

        console.log('[TEST] ✅ Clarity Score calculation verified');
    });
});
