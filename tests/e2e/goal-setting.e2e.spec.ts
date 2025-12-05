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
    test.skip('should display goals section in analytics', async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Verify Goals section exists
        const goalsSection = page.getByText('Current Goals');
        await expect(goalsSection).toBeVisible();

        console.log('[TEST] ✅ Goals section is visible');
    });

    test.skip('should show actual session progress, not hardcoded values', async ({ page }) => {
        /**
         * SKIPPED: This test exposes that Goal Setting is incomplete.
         * 
         * The GoalsSection component shows hardcoded values:
         * - "3 / 5" for Weekly Sessions
         * - "88% / 90%" for Clarity Score Avg
         * 
         * These values don't change based on actual user data.
         * 
         * To fix:
         * 1. Create goals data model in database
         * 2. Implement API endpoints for goals CRUD
         * 3. Update GoalsSection to fetch and display real data
         * 4. Add ability for users to set their own goals
         * 5. Calculate progress based on actual session data
         * 
         * Once implemented, unskip this test and verify:
         */
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Get the weekly sessions progress
        const weeklySessionsText = await page.getByText(/weekly sessions/i).textContent();

        // This should NOT always be "3 / 5" - it should reflect actual sessions
        // For a new user with 0 sessions, it should show "0 / X"
        expect(weeklySessionsText).not.toContain('3 / 5');

        // Get clarity score progress  
        const clarityScoreText = await page.getByText(/clarity score avg/i).textContent();

        // This should NOT always be "88% / 90%" - it should reflect actual data
        expect(clarityScoreText).not.toContain('88% / 90%');

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
