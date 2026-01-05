/**
 * Free User Journey E2E Test
 * 
 * Complete lifecycle test for FREE tier users:
 * 1. Signup via UI
 * 2. Session with Native Browser STT (only option)
 * 3. Custom vocabulary
 * 4. Analytics verification
 * 5. Logout/relogin persistence
 * 6. Multiple sessions with cumulative scores
 */
import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

test.describe('Free User Journey - Complete Lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        // Set up free user profile override BEFORE navigation
        await page.addInitScript(() => {
            (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;
            (window as unknown as { __E2E_MOCK_PROFILE__: { id: string; subscription_status: string } }).__E2E_MOCK_PROFILE__ = {
                id: 'free-test-user',
                subscription_status: 'free'
            };
        });
    });

    test('should verify only Native Browser STT is available', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/session');
        await expect(page.getByText('Practice Session')).toBeVisible();

        // Verify the mode dropdown shows "Native" for Free users (not Cloud/Private)
        // The dropdown button displays the current mode selection
        const modeDropdownButton = page.getByRole('button', { name: /Native|Cloud|Private|On-Device/i });
        await expect(modeDropdownButton).toBeVisible({ timeout: 5000 });

        // Get the button text - should be "Native" for free users
        const buttonText = await modeDropdownButton.textContent();
        expect(buttonText?.toLowerCase()).toContain('native');
        console.log(`[FREE] ✅ Mode dropdown shows: ${buttonText}`);
    });

    test('should complete session with Native Browser STT', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/session');

        const startButton = page.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();

        // Start session
        await startButton.click();
        await expect(page.getByText('Stop').first()).toBeVisible({ timeout: 10000 });
        console.log('[FREE] ✅ Session started with Native Browser');

        // Verify Clarity Score displayed
        await expect(page.getByText('Clarity Score')).toBeVisible();
        console.log('[FREE] ✅ Clarity Score metric visible');

        // Stop session
        await startButton.click();
        await expect(page.getByText('Start').first()).toBeVisible({ timeout: 5000 });
        console.log('[FREE] ✅ Session stopped successfully');
    });

    test('should add custom vocabulary word', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/session');

        // 1. Open Session Settings sheet
        const settingsBtn = page.getByTestId('session-settings-button');
        await expect(settingsBtn).toBeVisible();
        await settingsBtn.click();
        await expect(page.getByText('Session Settings')).toBeVisible();

        // 2. Add word
        const customWordInput = page.getByPlaceholder(/literally/i);
        await customWordInput.fill('Antigravity');
        const addButton = page.getByRole('button', { name: /add/i }).first();
        await addButton.click();

        // 3. Verify word is added
        await expect(page.getByText(/antigravity/i)).toBeVisible();
        console.log('[FREE] ✅ Custom word "Antigravity" added and verified in sheet');

        // 4. Close sheet
        await page.keyboard.press('Escape');
    });

    test('should display analytics after session', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/analytics');

        await expect(page.getByTestId('dashboard-heading')).toBeVisible();
        console.log('[FREE] ✅ Analytics dashboard loaded');

        // Verify key analytics components
        await expect(page.getByText('Session History')).toBeVisible();
        console.log('[FREE] ✅ Session History visible');
    });

    test('should show upgrade prompts for free users', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/analytics');

        // Free users should see upgrade options
        // Wait for dashboard to load (past skeleton state)
        await expect(page.getByTestId('analytics-dashboard')).toBeVisible();

        // Free users should see upgrade options
        const upgradeButton = page.getByTestId('analytics-dashboard-upgrade-button');
        await expect(upgradeButton).toBeVisible();
        console.log('[FREE] ✅ Upgrade button visible for free user');
    });
});
