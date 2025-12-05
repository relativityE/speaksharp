import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

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
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Verify Goals section exists
        const goalsSection = page.getByText('Current Goals');
        await expect(goalsSection).toBeVisible();

        console.log('[TEST] ✅ Goals section is visible');
    });

    test('should show actual session progress, not hardcoded values', async ({ page }) => {
        /**
         * This test verifies that Goal Setting shows real data based on actual sessions.
         */
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Wait for goals section to load
        await page.getByText('Current Goals').waitFor({ state: 'visible' });

        // Get all text from the page to find the goals data
        const pageText = await page.textContent('body');

        console.log('[TEST] Checking page for goal values...');

        // Should show "2 / 5" for the 2 mock sessions (both within last 7 days)
        expect(pageText).toContain('2 / 5');

        // Should show actual average clarity score (not hardcoded 88%)
        expect(pageText).toMatch(/9[012]%\s*\/\s*90%/);

        console.log('[TEST] ✅ Goals show real data, not hardcoded values');
    });

    test.skip('should allow users to set custom goals', async ({ page }) => {
        /**
         * SKIPPED: Goal setting functionality not implemented yet.
         * 
         * Expected behavior:
         * - User can click "Set Goals" or "Edit Goals" button
         * - Modal/form appears to set weekly session target
         * - User can set clarity score target
         * - Goals are saved and persist across sessions
         * 
         * Once implemented, unskip and verify this flow.
         */
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Look for "Set Goals" or "Edit Goals" button
        const setGoalsButton = page.getByRole('button', { name: /set goals|edit goals/i });
        await expect(setGoalsButton).toBeVisible();

        await setGoalsButton.click();

        // Verify modal/form appears
        const goalsForm = page.getByRole('dialog');
        await expect(goalsForm).toBeVisible();

        // Set weekly session goal
        const weeklySessionInput = page.getByLabel(/weekly sessions/i);
        await weeklySessionInput.fill('10');

        // Set clarity score goal
        const clarityGoalInput = page.getByLabel(/clarity.*goal/i);
        await clarityGoalInput.fill('95');

        // Save goals
        await page.getByRole('button', { name: /save|update/i }).click();

        // Verify goals are saved
        await expect(page.getByText(/10/)).toBeVisible();
        await expect(page.getByText(/95%/)).toBeVisible();

        console.log('[TEST] ✅ Custom goals saved successfully');
    });
});
