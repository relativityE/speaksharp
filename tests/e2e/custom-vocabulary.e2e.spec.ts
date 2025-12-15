import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

test.describe('Custom Vocabulary - Debugging with console logs', () => {
    test('should allow adding and removing custom words', async ({ page }) => {
        // Capture browser console logs
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            if (text.includes('[MSW') || text.includes('[useCustomVocabulary]') || text.includes('[RQ')) {
                console.log(`[BROWSER ${type.toUpperCase()}]`, text);
            }
        });

        await programmaticLoginWithRoutes(page);
        console.log('[TEST DEBUG] Login complete, navigating to /session');
        await navigateToRoute(page, '/session');
        console.log('[TEST DEBUG] Navigated to /session');

        // Open settings sheet
        console.log('[TEST DEBUG] Clicking settings button');
        const settingsBtn = page.getByTestId('session-settings-button');
        await expect(settingsBtn).toBeVisible();
        await settingsBtn.click({ force: true });

        // Wait for Sheet to open
        console.log('[TEST DEBUG] Waiting for Session Settings sheet');
        await expect(page.getByText('Session Settings')).toBeVisible();

        // Check if Custom Vocabulary section is visible
        console.log('[TEST DEBUG] Waiting for Custom Vocabulary title');
        await expect(page.getByText('Custom Vocabulary')).toBeVisible();

        // Add a new word
        console.log('[TEST DEBUG] Adding new word');
        const input = page.getByPlaceholder('e.g., SpeakSharp, AI-powered');
        await expect(input).toBeVisible();
        console.log('[TEST DEBUG] Filling input with "Antigravity"');
        await input.fill('Antigravity');

        // Wait for React to update button state
        await page.waitForTimeout(500);

        console.log('[TEST DEBUG] Looking for Add button with aria-label');
        const addButton = page.getByRole('button', { name: /add word/i });
        await expect(addButton).toBeVisible();

        // Check if button is enabled
        const isDisabled = await addButton.isDisabled();
        console.log('[TEST DEBUG] Add button disabled?', isDisabled);

        if (isDisabled) {
            const inputValue = await input.inputValue();
            console.log('[TEST DEBUG] Input value:', inputValue);
            throw new Error(`Button is disabled! Input value: "${inputValue}"`);
        }

        console.log('[TEST DEBUG] Add button found and enabled, clicking');
        await addButton.click();

        // Wait a moment for mutation to complete
        await page.waitForTimeout(1000);

        // Wait for the word to appear (stored as lowercase)
        console.log('[TEST DEBUG] Waiting for word to appear in list');
        await expect(page.getByText('antigravity')).toBeVisible({ timeout: 10000 });
        console.log('[TEST DEBUG] ✅ Word appeared successfully!');

        // Remove the word - use case-insensitive matching
        console.log('[TEST DEBUG] Removing word');
        const removeBtn = page.getByRole('button', { name: /remove antigravity/i });
        await expect(removeBtn).toBeVisible({ timeout: 5000 });
        await removeBtn.click();

        // Verify word is removed
        console.log('[TEST DEBUG] Verifying word is removed');
        await expect(page.getByText('antigravity')).not.toBeVisible({ timeout: 5000 });
    });
});
