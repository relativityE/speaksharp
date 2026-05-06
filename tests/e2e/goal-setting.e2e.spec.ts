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
        await navigateToRoute(userPage, '/analytics');

        await expect(userPage.getByTestId('goals-section')).toBeVisible({ timeout: 15000 });

        const goalsSection = userPage.getByText('Current Goals');
        await expect(goalsSection).toBeVisible();
    });

    test('should show actual session progress, not hardcoded values', async ({ userPage }) => {
        await mockRecentSessions(userPage, { count: 5, daysBack: 7 });

        await navigateToRoute(userPage, '/analytics');

        const weeklyValue = userPage.getByTestId('weekly-sessions-value');
        await expect(weeklyValue).toBeVisible();

        await expect(weeklyValue).toHaveText(/5 \/ 5/);

        const clarityValue = userPage.getByTestId('clarity-avg-value');
        await expect(clarityValue).toBeVisible();
    });

    test('should allow users to set custom goals', async ({ userPage }) => {
        await mockRecentSessions(userPage, { count: 5, daysBack: 7 });

        await navigateToRoute(userPage, '/analytics');

        await expect(userPage.getByTestId('goals-section')).toBeVisible({ timeout: 15000 });

        await userPage.getByTestId('edit-goals-button').click();

        await expect(userPage.getByTestId('edit-goals-dialog')).toBeVisible();

        await userPage.getByTestId('weekly-goal-input').clear();
        await userPage.getByTestId('weekly-goal-input').fill('10');

        await userPage.getByTestId('clarity-goal-input').clear();
        await userPage.getByTestId('clarity-goal-input').fill('95');

        await userPage.getByTestId('save-goals-button').click();

        await expect(
            userPage.getByTestId('goals-save-success')
        ).toBeVisible({ timeout: 5000 });

        await expect(userPage.getByTestId('edit-goals-dialog')).not.toBeVisible();

        await expect(async () => {
            const weeklyText = await userPage.getByTestId('weekly-sessions-value').innerText();
            const clarityText = await userPage.getByTestId('clarity-avg-value').innerText();

            expect(weeklyText).toContain('10');
            expect(clarityText).toContain('95%');
        }).toPass({ timeout: 10000 });
    });
});
