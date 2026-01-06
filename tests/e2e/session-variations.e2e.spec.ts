import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

test.describe('Session Variations', () => {
    test.beforeEach(async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');
    });

    test('Journey 4 & 5: Switch STT Modes', async ({ page }) => {
        // The mode selector is a DropdownMenu button next to "Live Recording"
        const modeButton = page.getByRole('button', { name: /Native|Private|Cloud/ });

        await modeButton.waitFor({ state: 'visible', timeout: 5000 });

        // Verify initial mode (should be Native by default)
        await expect(modeButton).toContainText(/Native/);

        // Open dropdown
        await modeButton.click();

        // Switch to Cloud
        await page.getByRole('menuitemradio', { name: /Cloud \(AssemblyAI\)/ }).click();
        await expect(modeButton).toContainText(/Cloud/);

        // Open dropdown again
        await modeButton.click();

        // Switch to Private
        await page.getByRole('menuitemradio', { name: /Private \(Whisper\)/ }).click();
        await expect(modeButton).toContainText(/Private/);

        // Switch back to Native
        await modeButton.click();
        await page.getByRole('menuitemradio', { name: /Native \(Browser\)/ }).click();
        await expect(modeButton).toContainText(/Native/);
    });

    test('Journey 6: Custom Vocabulary Management', async ({ page }) => {
        // Custom Vocabulary is inside the settings sheet
        const settingsButton = page.getByTestId('session-settings-button');
        await expect(settingsButton).toBeVisible({ timeout: 10000 });
        await settingsButton.click();

        // Wait for sheet animation to complete
        await expect(page.getByRole('heading', { name: 'Session Settings' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('heading', { name: /Custom Vocabulary|User Filler Words/i })).toBeVisible();

        // Fill input and add word (note: mutation lowercases all words)
        const wordInput = page.getByPlaceholder(/literally|basically/i);
        await expect(wordInput).toBeVisible({ timeout: 5000 });
        await wordInput.fill('TestWord');

        const addButton = page.getByRole('button', { name: /Add/i });
        await expect(addButton).toBeEnabled();
        await addButton.click();

        // Wait for word to appear - it will be lowercased to 'testword'
        await expect(page.getByText('testword', { exact: true })).toBeVisible({ timeout: 10000 });

        // Remove the word
        await page.getByRole('button', { name: /Remove testword/i }).click();

        // Verify word is removed
        await expect(page.getByText('testword', { exact: true })).not.toBeVisible({ timeout: 5000 });
    });
});
