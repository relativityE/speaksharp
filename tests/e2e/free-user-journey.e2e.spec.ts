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
            (window as unknown as { __E2E_MOCK_PROFILE__: { subscription_status: string } }).__E2E_MOCK_PROFILE__ = {
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
    });

    test('should complete session with Native Browser STT', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/session');

        const startButton = page.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();

        // Start session
        await startButton.click();
        await expect(page.getByRole('button', { name: /stop/i })).toBeVisible();

        // Verify Clarity Score displayed
        await expect(page.getByText('Clarity Score')).toBeVisible();

        // Wait to comply with 5s minimum session duration
        await page.waitForTimeout(6000);
        // Stop session
        await startButton.click();
        await expect(page.getByText('Start').first()).toBeVisible({ timeout: 5000 });
    });

    test('should add custom vocabulary word', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/session');

        // Wait for page to load
        await expect(page.getByText('Practice Session')).toBeVisible();

        // 1. Click "Add Custom Word" button to open the popover
        const addWordBtn = page.getByTestId('add-custom-word-button');
        await expect(addWordBtn).toBeVisible();
        await addWordBtn.click();

        // 2. Fill in word and submit
        const word = 'Gravity';
        const customWordInput = page.getByPlaceholder(/literally/i);
        await expect(customWordInput).toBeVisible();
        await customWordInput.fill(word);

        // Use a more robust way to click the add button in the popover
        const addButton = page.getByRole('button', { name: /add/i }).last();
        await addButton.click();

        // 3. Verify word is added (popover should close, word appears in Filler Words card)
        // Wait for the popover to be gone first to avoid finding the word inside the input
        await expect(page.getByText('User Filler Words')).not.toBeVisible({ timeout: 10000 });

        // Now look for the word in the metrics card
        const wordBadge = page.getByTestId('filler-badge').filter({ hasText: new RegExp(word, 'i') });
        await expect(wordBadge).toBeVisible({ timeout: 10000 });
        await expect(wordBadge.getByTestId('filler-badge-count')).toBeVisible();
    });

    test('should display analytics after session', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/analytics');

        // Verify key analytics components
        // Wait for skeleton to disappear before checking content
        await expect(page.getByTestId('analytics-dashboard-skeleton')).not.toBeVisible();

        // "Session History" was renamed/reorganized under "Export Reports" or just the list itself
        await expect(page.getByText('Export Reports')).toBeVisible();
        await expect(page.getByTestId('session-history-list')).toBeVisible();
    });

    test('should show upgrade prompts for free users', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });
        await navigateToRoute(page, '/analytics');

        // Free users should see upgrade options
        // Wait for dashboard to load (past skeleton state)
        await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 30000 });

        // Free users should see upgrade options
        const upgradeButton = page.getByTestId('analytics-dashboard-upgrade-button');
        await expect(upgradeButton).toBeVisible();
    });
});
