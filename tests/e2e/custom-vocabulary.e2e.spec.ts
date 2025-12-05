import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe.skip('Custom Vocabulary', () => {
    test('should allow adding and removing custom words', async ({ page }) => {
        // Mock vocabulary API calls
        await page.route('**/rest/v1/custom_vocabulary*', async (route) => {
            const method = route.request().method();

            if (method === 'GET') {
                // Initial empty list
                await route.fulfill({ json: [] });
            } else if (method === 'POST') {
                // Add word
                const postData = route.request().postDataJSON();
                await route.fulfill({
                    json: [{ id: 'mock-vocab-id', word: postData.word, user_id: 'test-user-123' }]
                });
            } else if (method === 'DELETE') {
                // Remove word
                await route.fulfill({ status: 204 });
            }
        });

        // Mock User Profile as PRO to ensure Custom Vocabulary is accessible
        await page.route('**/rest/v1/user_profiles*', async (route) => {
            await route.fulfill({
                json: [{
                    id: 'test-user-123',
                    user_id: 'test-user-123',
                    full_name: 'Test User',
                    subscription_status: 'pro', // FORCE PRO STATUS
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }]
            });
        });

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

        // Wait for Sheet to open (check for Sheet Title first)
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
        await page.getByRole('button', { name: /plus/i }).click(); // Assuming plus icon button

        // Verify word appears in list (optimistic update or re-fetch)
        // Note: Since we mocked the POST to return the word, the UI should update
        // We might need to wait for the mocked GET if the component refetches

        // For this test, we'll assume the component updates local state or refetches. 
        // If it refetches, we need to update the GET mock.
        // Let's update the GET mock to return the new word for subsequent calls
        console.log('[TEST DEBUG] Updating mock for GET request');
        await page.unroute('**/rest/v1/custom_vocabulary*');
        await page.route('**/rest/v1/custom_vocabulary*', async (route) => {
            const method = route.request().method();
            if (method === 'GET') {
                await route.fulfill({ json: [{ id: 'mock-vocab-id', word: 'Antigravity', user_id: 'test-user-123' }] });
            } else if (method === 'DELETE') {
                await route.fulfill({ status: 204 });
            }
        });

        // Wait for the word to appear
        console.log('[TEST DEBUG] Waiting for word to appear in list');
        await expect(page.getByText('Antigravity')).toBeVisible();

        // Remove the word
        console.log('[TEST DEBUG] Removing word');
        // Use a more specific selector for the remove button to avoid ambiguity
        const removeBtn = page.locator('button[aria-label="Remove Antigravity"]');
        await expect(removeBtn).toBeVisible();
        await removeBtn.click();

        // Verify word is removed
        console.log('[TEST DEBUG] Verifying word removal');
        await expect(page.getByText('Antigravity')).toBeHidden();
    });
});
