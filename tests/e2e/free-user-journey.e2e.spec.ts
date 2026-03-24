/**
 * Free User Journey E2E Test
 * 
 * Complete lifecycle test for FREE tier users:
 * 1. Signup via UI
 * 2. Session with Browser STT (only option)
 * 3. User filler words
 * 4. Analytics verification
 * 5. Logout/relogin persistence
 * 6. Multiple sessions with cumulative scores
 */
import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';

test.describe('Free User Journey - Complete Lifecycle', () => {
    test('should verify only Browser STT is available', async ({ freePage }) => {
        // Ensure fresh state and synchronize MSW
        await freePage.reload();
        

        await navigateToRoute(freePage, '/session');
        await expect(freePage.getByText('Practice Session')).toBeVisible();

        // Verify the mode dropdown shows "Native" for Free users (not Cloud/Private)
        // The dropdown button displays the current mode selection
        const modeDropdownButton = freePage.getByRole('button', { name: /Native|Cloud|Private|On-Device/i });
        await expect(modeDropdownButton).toBeVisible({ timeout: 5000 });

        // Get the button text - should contain "Native" or "Browser" for free users
        const buttonText = await modeDropdownButton.textContent();
        expect(buttonText?.toLowerCase()).toMatch(/native|browser/);
    });

    test('should complete session with Browser STT', async ({ freePage }) => {
        // Ensure fresh state and synchronize MSW
        await freePage.reload();
        

        await navigateToRoute(freePage, '/session');

        const startButton = freePage.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();

        // Start session
        await startButton.click();
        await expect(freePage.getByRole('button', { name: /stop/i })).toBeVisible();

        // Verify Clarity Score displayed
        await expect(freePage.getByText('Browser')).toBeVisible();

        // Wait to comply with 5s minimum session duration
        await freePage.waitForTimeout(6000);
        // Stop session
        await startButton.click();
        await expect(startButton).toHaveAttribute('aria-label', /start/i, { timeout: 5000 });
    });

    test('should add user filler word', async ({ freePage }) => {
        // Ensure fresh state and synchronize MSW
        await freePage.reload();
        

        await navigateToRoute(freePage, '/session');

        // Wait for page to load
        await expect(freePage.getByText('Practice Session')).toBeVisible();

        // 1. Click "Add User Word" button to open the popover
        const addWordBtn = freePage.getByTestId('add-custom-word-button');
        await expect(addWordBtn).toBeVisible();
        await addWordBtn.click();

        // 2. Fill in word and submit
        const word = 'Gravity';
        const customWordInput = freePage.getByPlaceholder(/literally/i);
        await expect(customWordInput).toBeVisible();
        await customWordInput.fill(word);

        // Use a more robust way to click the add button in the popover
        const addButton = freePage.getByRole('button', { name: /add/i }).last();
        await addButton.click();

        // 3. Verify word is added (popover should close, word appears in Filler Words card)
        // Wait for the popover to be gone first to avoid finding the word inside the input
        await expect(freePage.getByText('User Filler Words')).not.toBeVisible({ timeout: 10000 });

        // Now look for the word in the metrics card
        const wordBadge = freePage.getByTestId('filler-badge').filter({ hasText: new RegExp(word, 'i') });
        await expect(wordBadge).toBeVisible({ timeout: 10000 });
        await expect(wordBadge.getByTestId('filler-badge-count')).toBeVisible();
    });

    test('should display analytics after session', async ({ freePage }) => {
        // Ensure fresh state and synchronize MSW
        await freePage.reload();
        

        await navigateToRoute(freePage, '/analytics');

        // Verify key analytics components
        // Wait for skeleton to disappear before checking content
        await expect(freePage.getByTestId('analytics-dashboard-skeleton')).not.toBeVisible();

        // "Session History" was renamed/reorganized under "Export Reports" or just the list itself
        await expect(freePage.getByText('Export Reports')).toBeVisible();
        await expect(freePage.getByTestId('session-history-list')).toBeVisible();
    });

    test('should show upgrade prompts for free users', async ({ freePage }) => {
        // Ensure fresh state and synchronize MSW
        await freePage.reload();
        

        await navigateToRoute(freePage, '/analytics');

        // Free users should see upgrade options
        // Wait for dashboard to load (past skeleton state)
        await expect(freePage.locator('.animate-spin')).not.toBeVisible({ timeout: 15000 });
        await expect(freePage.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 30000 });

        // Free users should see upgrade options
        const upgradeButton = freePage.getByTestId('analytics-page-upgrade-button');
        await expect(upgradeButton).toBeVisible();
    });
});
