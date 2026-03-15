import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

test.describe('Session Variations', () => {

    test('Journey 4 & 5: Switch STT Modes', async ({ proPage: page }) => {
        await navigateToRoute(page, '/session');

        // Wait for profile to settle to ensure Pro features (Cloud/Private) are enabled
        await page.waitForFunction(() => (window as any).__e2eProfileLoaded__ === true, { timeout: 30000 });

        // The mode selector is a DropdownMenu button next to "Live Recording"
        const modeButton = page.getByTestId(TEST_IDS.STT_MODE_SELECT);

        await modeButton.waitFor({ state: 'visible', timeout: 5000 });

        // Verify initial mode (should be Native by default)
        await expect(modeButton).toHaveAttribute('data-state', 'native');

        // Open dropdown
        await modeButton.click();

        // Switch to Cloud
        await page.getByTestId(TEST_IDS.STT_MODE_CLOUD).click();
        await expect(modeButton).toHaveAttribute('data-state', 'cloud');

        // Open dropdown again
        await modeButton.click();

        // Switch to Private
        await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).click();
        await expect(modeButton).toHaveAttribute('data-state', 'private');

        // Switch back to Native
        await modeButton.click();
        await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).click();
        await expect(modeButton).toHaveAttribute('data-state', 'native');
    });

    test('Journey 6: User Word Management', async ({ freePage: page }) => {
        await navigateToRoute(page, '/session');

        // User Word management is now in a popover opened by the badge list action
        const addWordBtn = page.getByTestId('add-custom-word-button');
        await expect(addWordBtn).toBeVisible({ timeout: 10000 });
        await addWordBtn.click();

        // Assert popover opened: word input visible is the behavioral signal
        const wordInput = page.getByPlaceholder(/literally|basically/i);
        await expect(wordInput).toBeVisible({ timeout: 5000 });

        // Fill input and add word
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

        // Verify word is removed from metrics list
        await expect(wordBadge).not.toBeVisible({ timeout: 10000 });
    });
});
