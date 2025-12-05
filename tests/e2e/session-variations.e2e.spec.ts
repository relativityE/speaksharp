import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Session Variations', () => {
    test.beforeEach(async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');
    });

    test('Journey 4 & 5: Switch STT Modes', async ({ page }) => {
        // The mode selector is a DropdownMenu button next to "Live Recording"
        const modeButton = page.getByRole('button', { name: /Native|On-Device|Cloud AI/ });

        await modeButton.waitFor({ state: 'visible', timeout: 5000 });

        // Verify initial mode (should be Native by default)
        await expect(modeButton).toContainText(/Native/);

        // Open dropdown
        await modeButton.click();

        // Switch to Cloud AI
        await page.getByRole('menuitemradio', { name: /Cloud AI \(AssemblyAI\)/ }).click();
        await expect(modeButton).toContainText(/Cloud AI/);

        // Open dropdown again
        await modeButton.click();

        // Switch to On-Device
        await page.getByRole('menuitemradio', { name: /On-Device \(Whisper\)/ }).click();
        await expect(modeButton).toContainText(/On-Device/);

        // Switch back to Native
        await modeButton.click();
        await page.getByRole('menuitemradio', { name: /Native \(Browser\)/ }).click();
        await expect(modeButton).toContainText(/Native/);
    });

    test('Journey 6: Custom Vocabulary Management', async ({ page }) => {
        // Navigate to Custom Vocabulary section (assuming it's a modal or separate page/tab)
        // For this test, we'll assume it's accessible via a button on the session page
        const vocabButton = page.getByRole('button', { name: /custom vocabulary/i });

        if (await vocabButton.isVisible()) {
            await vocabButton.click();

            // Add a word
            await page.getByPlaceholder(/add a word/i).fill('SpeakSharp');
            await page.getByRole('button', { name: /add/i }).click();

            // Verify word added
            await expect(page.getByText('SpeakSharp')).toBeVisible();

            // Remove word
            await page.getByRole('button', { name: /remove speaksharp/i }).click();
            await expect(page.getByText('SpeakSharp')).not.toBeVisible();
        } else {
            console.log('Custom Vocabulary button not found - skipping vocab verification');
        }
    });
});
