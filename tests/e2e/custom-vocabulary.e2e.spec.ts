import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Custom Vocabulary', () => {
    test('should allow adding and removing custom words', async ({ page }) => {
        // MSW handlers in handlers.ts now handle all network requests
        await programmaticLogin(page);
        console.log('[TEST DEBUG] Login complete, navigating to /session');
        await page.goto('/session');
        await page.waitForURL('**/session');
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
        await input.fill('Antigravity');
        await page.getByRole('button', { name: /plus/i }).click();

        // Wait for the word to appear
        console.log('[TEST DEBUG] Waiting for word to appear in list');
        await expect(page.getByText('Antigravity')).toBeVisible();

        // Remove the word
        console.log('[TEST DEBUG] Removing word');
        const removeBtn = page.locator('button[aria-label="Remove Antigravity"]');
        await expect(removeBtn).toBeVisible();
        await removeBtn.click();

        // Verify word is removed
        console.log('[TEST DEBUG] Verifying word removal');
        await expect(page.getByText('Antigravity')).toBeHidden();
    });
});
