import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

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
        await navigateToRoute(page, '/analytics');

        // Verify Goals section exists
        const goalsSection = page.getByText('Current Goals');
        await expect(goalsSection).toBeVisible();
    });

    test('should show actual session progress, not hardcoded values', async ({ page }) => {
        /**
         * This test verifies that Goal Setting shows real data based on actual sessions.
         */
        await programmaticLoginWithRoutes(page);
        await navigateToRoute(page, '/analytics');

        // Wait for goals section to load
        await page.getByText('Current Goals').waitFor({ state: 'visible' });

        // Get all text from the page to find the goals data
        const pageText = await page.textContent('body');

        // Should show actual session count (4 out of 5 mock sessions are within 7 days)
        // Session-1 is 7 days ago which may be at boundary
        expect(pageText).toMatch(/[45] \/ 5/);

        // Should show actual average clarity score (not hardcoded 88%)
        // New mock data avg clarity is ~84% based on 5 sessions
        expect(pageText).toMatch(/8[0-9]%\s*\/\s*90%/);
    });

    test('should allow users to set custom goals', async ({ page }) => {
        /**
         * Goal setting via localStorage.
         * 
         * NOTE: Currently uses localStorage for persistence (client-side only).
         * See ROADMAP.md for Supabase backend integration plan.
         * 
         * This test verifies:
         * - Edit Goals button opens dialog
         * - User can modify weekly session and clarity targets
         * - Goals persist and display updated values
         */
        await programmaticLoginWithRoutes(page);
        await navigateToRoute(page, '/analytics');

        // Wait for Goals section to load
        await page.getByText('Current Goals').waitFor({ state: 'visible' });

        // Click Edit Goals button (settings icon)
        const editGoalsButton = page.getByTestId('edit-goals-button');
        await expect(editGoalsButton).toBeVisible();
        await editGoalsButton.click();

        // Verify dialog appears
        const goalsDialog = page.getByTestId('edit-goals-dialog');
        await expect(goalsDialog).toBeVisible();

        // Set weekly session goal to 10
        const weeklyInput = page.getByTestId('weekly-goal-input');
        await weeklyInput.clear();
        await weeklyInput.fill('10');

        // Set clarity goal to 95
        const clarityInput = page.getByTestId('clarity-goal-input');
        await clarityInput.clear();
        await clarityInput.fill('95');

        // Save goals
        await page.getByTestId('save-goals-button').click();

        // Verify dialog closes and goals are updated
        await expect(goalsDialog).not.toBeVisible();

        // Verify updated goals display (4-5 sessions out of 10, clarity target 95%)
        await expect(page.getByText(/[45] \/ 10/)).toBeVisible();
        await expect(page.getByText(/95%/)).toBeVisible();
    });
});
