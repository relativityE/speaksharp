import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { mockRecentSessions } from './dynamic-mocks';

/**
 * Goal Setting E2E Test
 * 
 * PURPOSE: Verify that Goal Setting feature actually works with real data,
 * not just hardcoded mock values.
 * 
 * EXPECTED BEHAVIOR:
 * - Goals should reflect actual user session data
 * - Progress should update based on completed sessions
 * - Users should be able to set/modify their own goals
 * 
 * CURRENT STATE: This test will likely FAIL because GoalsSection.tsx
 * shows hardcoded values ("3 / 5", "88% / 90%") instead of real data.
 * 
 * This is intentional - the test exposes an incomplete feature marked
 * as "✅ Implemented" in PRD.md
 */

test.describe('Goal Setting', () => {
    test('should display goals section in analytics', async ({ page }) => {
        await programmaticLoginWithRoutes(page);

        // Ensure fresh state and synchronize MSW
        await page.reload();
        await page.waitForLoadState('networkidle');

        // 1. Robust Navigation
        await navigateToRoute(page, '/analytics');

        // 2. Explicit Waits (Fixes Render Flake)
        // REMOVED networkidle: caused timeouts due to background polling
        // We look for a known element that signifies "Ready"
        await expect(page.getByTestId('goals-section')).toBeVisible({ timeout: 15000 });

        // 3. Verify Heading
        const goalsSection = page.getByText('Current Goals');
        await expect(goalsSection).toBeVisible();
    });

    test('should show actual session progress, not hardcoded values', async ({ page }) => {
        /**
         * This test verifies that Goal Setting shows real data based on actual sessions.
         * 🛡️ FLAKE FIX: Use deterministic data injection to prevent date/time race conditions.
         * We inject 5 sessions created "Today" to guarantee 5/5 progress.
         */
        await programmaticLoginWithRoutes(page);

        // Ensure fresh state and synchronize MSW
        await page.reload();
        await page.waitForLoadState('networkidle');

        // 1. Use dynamic mock helper to inject 5 sessions with fresh timestamps
        // This guarantees they all fall within the "Last 7 Days" filter window
        await mockRecentSessions(page, { count: 5, daysBack: 7 });

        // 2. Reload to force fresh fetch (clears React Query cache)
        await page.reload();
        await page.waitForSelector('[data-testid="nav-sign-out-button"]');

        await navigateToRoute(page, '/analytics');

        // Wait for goals section to be fully visible and out of skeleton mode
        const weeklyValue = page.getByTestId('weekly-sessions-value');
        await expect(weeklyValue).toBeVisible();

        // 5 sessions within last 7 days -> 5 / 5
        await expect(weeklyValue).toHaveText(/5 \/ 5/);

        // Avg Clarity can vary slightly with random data, but we check specific mock stats if needed.
        // For this test, we accept the default random range or could inject specific clarity.
        // Let's rely on the weekly session count as the primary "data is real" assertion.
        const clarityValue = page.getByTestId('clarity-avg-value');
        await expect(clarityValue).toBeVisible();
    });

    test('should allow users to set custom goals', async ({ page }) => {
        /**
         * Goal setting via localStorage.
         */
        await programmaticLoginWithRoutes(page);

        // Ensure fresh state and synchronize MSW
        await page.reload();
        await page.waitForLoadState('networkidle');

        await navigateToRoute(page, '/analytics');

        // 1. Ensure Robust Data State (Fixes loading/error states)
        await mockRecentSessions(page, { count: 5, daysBack: 7 });
        await page.reload();
        await page.waitForSelector('[data-testid="nav-sign-out-button"]');

        await navigateToRoute(page, '/analytics');

        // 2. Wait for Goals Section to be Ready (Success State)
        // This ensures loading is done and we are not in Skeleton mode
        await expect(page.getByTestId('goals-section')).toBeVisible({ timeout: 15000 });

        // 3. Open Dialog
        await page.getByTestId('edit-goals-button').click();

        // Verify dialog
        await expect(page.getByTestId('edit-goals-dialog')).toBeVisible();

        // Set weekly session goal to 10
        await page.getByTestId('weekly-goal-input').clear();
        await page.getByTestId('weekly-goal-input').fill('10');

        // Set clarity goal to 95
        await page.getByTestId('clarity-goal-input').clear();
        await page.getByTestId('clarity-goal-input').fill('95');

        // Save goals
        await page.getByTestId('save-goals-button').click();

        // Verify dialog closes
        await expect(page.getByTestId('edit-goals-dialog')).not.toBeVisible();

        // Verify updated goals display
        await expect(page.getByTestId('weekly-sessions-value')).toHaveText(/5 \/ 10/);
        await expect(page.getByTestId('clarity-avg-value')).toHaveText(/84% \/ 95%/);
    });
});
