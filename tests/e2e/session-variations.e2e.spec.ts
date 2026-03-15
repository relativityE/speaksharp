import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';

test.describe('Session Variations', () => {

    test('Journey 4 & 5: Switch STT Modes', async ({ proPage: page }) => {
        await navigateToRoute(page, '/session');

        // The mode selector is a DropdownMenu button next to "Live Recording"
        const modeButton = page.getByTestId('stt-mode-select');

        await modeButton.waitFor({ state: 'visible', timeout: 5000 });

        // Verify initial mode (should be Native by default)
        await expect(modeButton).toHaveAttribute('data-state', 'native');

        // Open dropdown
        await modeButton.click();
        await expect(page.getByTestId('stt-mode-cloud').first()).toBeVisible();

        // Switch to Cloud
        await page.getByTestId('stt-mode-cloud').first().click();
        await expect(modeButton).toHaveAttribute('data-state', 'cloud');

        // Open dropdown again
        await modeButton.click();
        await expect(page.getByTestId('stt-mode-private').first()).toBeVisible();

        // Switch to Private
        await page.getByTestId('stt-mode-private').first().click();
        await expect(modeButton).toHaveAttribute('data-state', 'private');

        // Switch back to Native
        await modeButton.click();
        await expect(page.getByTestId('stt-mode-native').first()).toBeVisible();
        await page.getByTestId('stt-mode-native').first().click();
        await expect(modeButton).toHaveAttribute('data-state', 'native');
    });

    test('Journey 6: User Word Management', async ({ proPage: page }) => {
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
