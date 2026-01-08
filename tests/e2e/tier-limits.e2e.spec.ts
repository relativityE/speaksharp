import { test, expect } from '@playwright/test';
import {
    programmaticLoginWithRoutes,
    navigateToRoute
} from './helpers';
import { registerEdgeFunctionMock } from './mock-routes';

test.describe('Tier Limits Enforcement (Alpha Launch)', () => {

    test('Free user is blocked when daily limit is exhausted', async ({ page }) => {
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Override usage limit mock to return can_start: false
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: false,
            remaining_seconds: 0,
            limit_seconds: 3600,
            used_seconds: 3600,
            subscription_status: 'free'
        });

        // 3. Go to session page and reload to ensure mock is seen
        await navigateToRoute(page, '/session');
        await page.reload();

        // 4. Verify start button is NOT present and limit screen is shown
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).not.toBeVisible();

        // Check for "Daily Limit Reached" heading
        await expect(page.getByRole('heading', { name: /Daily Limit Reached/i })).toBeVisible();
    });

    test('Daily limit auto-stops an active session', async ({ page }) => {
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Override usage limit mock with low time remaining (5s)
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: true,
            remaining_seconds: 5,
            limit_seconds: 3600,
            used_seconds: 3595,
            subscription_status: 'free'
        });

        // 3. Go to session page and reload to ensure mock is seen
        await navigateToRoute(page, '/session');
        await page.reload();

        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // 4. Verify session is recording
        await expect(page.getByText(/Recording in progress/i)).toBeVisible();

        // 5. Wait for auto-stop (should trigger at 5s)
        await expect(page.getByRole('heading', { name: /Daily Limit Reached/i })).toBeVisible({ timeout: 25000 });

        // Verify start button is gone
        await expect(page.getByTestId('session-start-stop-button')).not.toBeVisible();
    });

    test('Free users can add up to 100 filler words', async ({ page }) => {
        // 1. Setup
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Go to session page
        await navigateToRoute(page, '/session');

        // 3. Open settings
        await page.getByTestId('session-settings-button').click();

        const input = page.getByPlaceholder(/literally/i);
        const addButton = page.getByRole('button', { name: /add word/i });

        // 4. Verify adding a word
        await input.fill('word11');
        await addButton.click();

        await expect(page.getByText('word11')).toBeVisible();
        await expect(page.getByText(/Word added/i)).toBeVisible();
    });
});
