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

        // 4. Verify session is recording by checking button changed to Stop
        await expect(startButton.getByText('Stop')).toBeVisible();

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
        await page.getByTestId('add-custom-word-button').click();

        const input = page.getByPlaceholder(/literally/i);
        const word = 'word11';

        // 4. Verify adding a word
        await input.fill(word);
        await page.getByRole('button', { name: /add/i }).last().click();

        // Wait for popover to close
        await expect(page.getByText('User Filler Words')).not.toBeVisible({ timeout: 10000 });

        // Verify in metrics list
        await expect(page.getByTestId('filler-badge').filter({ hasText: new RegExp(word, 'i') })).toBeVisible({ timeout: 10000 });
    });
});
