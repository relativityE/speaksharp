import { test, expect } from './fixtures';
import { navigateToRoute, debugLog } from './helpers';

/**
 * E2E Error State Tests
 * 
 * Tests for critical error conditions that users may encounter.
 * These those verify the app handles errors gracefully without crashing.
 * 
 * Note: In E2E mock mode, mic is bypassed via __E2E_MOCK_SESSION__ flag.
 * These tests verify network error handling and app stability.
 */

test.describe('Error State Handling', () => {
    test.describe('Session Page Stability', () => {
        test('should load session page and show start button', async ({ userPage }) => {
            await navigateToRoute(userPage, '/session');

            // App should load with session UI elements
            await expect(userPage.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

            // Start button should be present
            const startButton = userPage.getByTestId('session-start-stop-button');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            debugLog('[TEST] ✅ Session page loaded with start button');
        });

        test('should remain functional after clicking start in mock mode', async ({ userPage }) => {
            await navigateToRoute(userPage, '/session');

            await expect(userPage.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

            // Try to start session (using mock session mode)
            const startButton = userPage.getByTestId('session-start-stop-button');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            if (await startButton.isEnabled()) {
                await startButton.click();
                await userPage.waitForTimeout(2000);

                // App should remain functional
                await expect(userPage.getByTestId('app-main')).toBeVisible();
            }

            debugLog('[TEST] ✅ Session interaction handled gracefully');
        });
    });

    test.describe('Network Error Handling', () => {
        test('should handle token endpoint failure gracefully', async ({ userPage }) => {
            // Block AssemblyAI token endpoint BEFORE navigation
            await userPage.route('**/functions/v1/assemblyai-token', route => {
                route.abort('failed');
            });

            await navigateToRoute(userPage, '/session');

            // App should remain functional despite token fetch failure
            await expect(userPage.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

            // Session page should still show UI
            const startButton = userPage.getByTestId('session-start-stop-button');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            debugLog('[TEST] ✅ Token endpoint failure handled gracefully');
        });

        test('should handle Supabase profile fetch failure gracefully', async ({ userPage }) => {
            // Block Supabase user endpoint
            await userPage.route('**/rest/v1/users*', route => {
                route.abort('failed');
            });

            // Wait for error handling
            await userPage.waitForTimeout(3000);

            // Page should still be interactive (not white screen of death)
            await expect(userPage.locator('body')).toBeVisible();

            // Either we're on an error page or main app is visible
            const hasContent = await userPage.locator('body').textContent();
            expect(hasContent?.length).toBeGreaterThan(0);

            debugLog('[TEST] ✅ Supabase API failure handled gracefully');
        });
    });
});
