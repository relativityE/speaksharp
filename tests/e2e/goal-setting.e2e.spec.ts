import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';
import { mockRecentSessions } from './dynamic-mocks';

/**
 * Goal Setting E2E Test
 * 
 * PURPOSE: Verify that Goal Setting feature actually works with real data,
 * not just hardcoded mock values.
 */

test.describe('Goal Setting', () => {
    test('should display goals section in analytics', async ({ userPage }) => {
        // Ensure fresh state and synchronize MSW
        await userPage.reload();
        await userPage.waitForLoadState('networkidle');

        // 1. Robust Navigation
        await navigateToRoute(userPage, '/analytics');

        // 2. Explicit Waits (Fixes Render Flake)
        await expect(userPage.getByTestId('goals-section')).toBeVisible({ timeout: 15000 });

        // 3. Verify Heading
        const goalsSection = userPage.getByText('Current Goals');
        await expect(goalsSection).toBeVisible();
    });

    test('should show actual session progress, not hardcoded values', async ({ userPage }) => {
        // Ensure fresh state and synchronize MSW
        await userPage.reload();
        await userPage.waitForLoadState('networkidle');

        // 1. Use dynamic mock helper to inject 5 sessions with fresh timestamps
        await mockRecentSessions(userPage, { count: 5, daysBack: 7 });

        // 2. Reload to force fresh fetch (clears React Query cache)
        await userPage.reload();
        await userPage.waitForSelector('[data-testid="nav-sign-out-button"]');

        await navigateToRoute(userPage, '/analytics');

        // Wait for goals section to be fully visible and out of skeleton mode
        const weeklyValue = userPage.getByTestId('weekly-sessions-value');
        await expect(weeklyValue).toBeVisible();

        // 5 sessions within last 7 days -> 5 / 5
        await expect(weeklyValue).toHaveText(/5 \/ 5/);

        const clarityValue = userPage.getByTestId('clarity-avg-value');
        await expect(clarityValue).toBeVisible();
    });

    test('should allow users to set custom goals', async ({ userPage }) => {
        // Ensure fresh state and synchronize MSW
        await userPage.reload();
        await userPage.waitForLoadState('networkidle');

        await navigateToRoute(userPage, '/analytics');

        // 1. Ensure Robust Data State (Fixes loading/error states)
        await mockRecentSessions(userPage, { count: 5, daysBack: 7 });
        await userPage.reload();
        await userPage.waitForSelector('[data-testid="nav-sign-out-button"]');

        await navigateToRoute(userPage, '/analytics');

        // 2. Wait for Goals Section to be Ready (Success State)
        await expect(userPage.getByTestId('goals-section')).toBeVisible({ timeout: 15000 });

        // 3. Open Dialog
        await userPage.getByTestId('edit-goals-button').click();

        // Verify dialog
        await expect(userPage.getByTestId('edit-goals-dialog')).toBeVisible();

        // Set weekly session goal to 10
        await userPage.getByTestId('weekly-goal-input').clear();
        await userPage.getByTestId('weekly-goal-input').fill('10');

        // Set clarity goal to 95
        await userPage.getByTestId('clarity-goal-input').clear();
        await userPage.getByTestId('clarity-goal-input').fill('95');

        // Save goals
        await userPage.getByTestId('save-goals-button').click();

        // Wait for success indicator first — proves mutation completed
        await expect(
            userPage.getByTestId('goals-save-success')
        ).toBeVisible({ timeout: 5000 });

        // Verify dialog closes automatically
        await expect(userPage.getByTestId('edit-goals-dialog')).not.toBeVisible();

        // Poll for settlement
        await expect(async () => {
            const weeklyText = await userPage.getByTestId('weekly-sessions-value').innerText();
            const clarityText = await userPage.getByTestId('clarity-avg-value').innerText();

            expect(weeklyText).toContain('10');
            expect(clarityText).toContain('95%');
        }).toPass({ timeout: 10000 });
    });
});
