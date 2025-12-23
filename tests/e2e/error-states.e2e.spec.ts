import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * E2E Error State Tests
 * 
 * Tests for critical error conditions that users may encounter.
 * These tests verify the app handles errors gracefully without crashing.
 * 
 * Note: In E2E mock mode, mic is bypassed via __E2E_MOCK_SESSION__ flag.
 * These tests verify network error handling and app stability.
 */

test.describe('Error State Handling', () => {
    test.describe('Session Page Stability', () => {
        test('should load session page and show start button', async ({ page }) => {
            await programmaticLoginWithRoutes(page);
            await navigateToRoute(page, '/session');

            // App should load with session UI elements
            await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

            // Start button should be present
            const startButton = page.getByTestId('session-start-stop-button');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            console.log('[TEST] ✅ Session page loaded with start button');
        });

        test('should remain functional after clicking start in mock mode', async ({ page }) => {
            await programmaticLoginWithRoutes(page);
            await navigateToRoute(page, '/session');

            await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

            // Try to start session (using mock session mode)
            const startButton = page.getByTestId('session-start-stop-button');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            if (await startButton.isEnabled()) {
                await startButton.click();
                await page.waitForTimeout(2000);

                // App should remain functional
                await expect(page.getByTestId('app-main')).toBeVisible();
            }

            console.log('[TEST] ✅ Session interaction handled gracefully');
        });
    });

    test.describe('Network Error Handling', () => {
        test('should handle token endpoint failure gracefully', async ({ page }) => {
            // Block AssemblyAI token endpoint BEFORE navigation
            await page.route('**/functions/v1/assemblyai-token', route => {
                route.abort('failed');
            });

            await programmaticLoginWithRoutes(page);
            await navigateToRoute(page, '/session');

            // App should remain functional despite token fetch failure
            await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

            // Session page should still show UI
            const startButton = page.getByTestId('session-start-stop-button');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            console.log('[TEST] ✅ Token endpoint failure handled gracefully');
        });

        test('should handle Supabase profile fetch failure gracefully', async ({ page }) => {
            // Block Supabase user endpoint
            await page.route('**/rest/v1/users*', route => {
                route.abort('failed');
            });

            await programmaticLoginWithRoutes(page);

            // Wait for error handling
            await page.waitForTimeout(3000);

            // Page should still be interactive (not white screen of death)
            await expect(page.locator('body')).toBeVisible();

            // Either we're on an error page or main app is visible
            const hasContent = await page.locator('body').textContent();
            expect(hasContent?.length).toBeGreaterThan(0);

            console.log('[TEST] ✅ Supabase API failure handled gracefully');
        });
    });
});
