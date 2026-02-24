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
        await page.getByRole('menuitemradio', { name: /Cloud/ }).click();
        await expect(modeButton).toContainText(/Cloud/);

        // Open dropdown again
        await modeButton.click();

        // Switch to Private
        await page.getByRole('menuitemradio', { name: /Private/ }).click();
        await expect(modeButton).toContainText(/Private/);

        // Switch back to Native
        await modeButton.click();
        await page.getByRole('menuitemradio', { name: /Native/ }).click();
        await expect(modeButton).toContainText(/Native/);
    });

    test('Journey 6: User Word Management', async ({ page }) => {
        // User Word management is now in a popover opened by the badge list action
        const addWordBtn = page.getByTestId('add-custom-word-button');
        await expect(addWordBtn).toBeVisible({ timeout: 10000 });
        await addWordBtn.click();

        // Assert popover opened: word input visible is the behavioral signal (not title text)
        const wordInput = page.getByPlaceholder(/literally|basically/i);
        await expect(wordInput).toBeVisible({ timeout: 5000 });

        // Fill input and add word (note: mutation lowercases all words)
        const word = 'testword';
        await wordInput.fill(word);

        const addButton = page.getByRole('button', { name: /Add/i }).last();
        await expect(addButton).toBeEnabled();
        await addButton.click();

        // Assert popover closed: word input no longer visible
        await expect(wordInput).not.toBeVisible({ timeout: 10000 });

        // Verify word is in metrics list
        const wordBadge = page.getByTestId('filler-badge').filter({ hasText: new RegExp(word, 'i') });
        await expect(wordBadge).toBeVisible({ timeout: 10000 });

        // Re-open to remove
        await addWordBtn.click();

        // Remove the word using the specialized remove button
        await page.getByRole('button', { name: new RegExp(`Remove ${word}`, 'i') }).click();

        // Verify word is removed from metrics list (might take a moment for state to ripple)
        await expect(wordBadge).not.toBeVisible({ timeout: 10000 });
    });
});
