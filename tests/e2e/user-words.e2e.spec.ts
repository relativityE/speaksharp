import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * User Words Lifecycle E2E
 *
 * Behavioral principle: assert actions and outcomes (add→visible, remove→gone),
 * not UI copy text which can change freely.
 */
test.describe('User Words Lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');
    });

    test('should add, detect, and remove a user word with UI feedback', async ({ page }) => {
        const userWord = 'testword';

        // 1. Open user word popover
        const addWordBtn = page.getByTestId('add-custom-word-button');
        await expect(addWordBtn).toBeVisible({ timeout: 10000 });
        await addWordBtn.click();

        // Assert popover opened: input visible is the behavioral signal
        const wordInput = page.getByPlaceholder(/literally|basically/i);
        await expect(wordInput).toBeVisible({ timeout: 5000 });

        // 2. Add the word
        await wordInput.fill(userWord);
        const addButton = page.getByRole('button', { name: /Add/i }).last();
        await expect(addButton).toBeEnabled();
        await addButton.click();

        // Assert popover closed (word submitted)
        await expect(wordInput).not.toBeVisible({ timeout: 10000 });

        // 3. Verify word appears in metrics list
        const wordBadge = page.getByTestId('filler-badge').filter({ hasText: new RegExp(userWord, 'i') });
        await expect(wordBadge).toBeVisible({ timeout: 10000 });

        // 4. Re-open and remove the word
        await addWordBtn.click();
        await page.getByRole('button', { name: new RegExp(`Remove ${userWord}`, 'i') }).click();

        // 5. Assert word is gone from metrics list
        await expect(wordBadge).not.toBeVisible({ timeout: 10000 });
    });
});
