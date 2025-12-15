import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from '../e2e/helpers';

/**
 * Debug test to reproduce the soak test dropdown issue.
 * Run with: pnpm exec playwright test tests/debug/dropdown-debug.spec.ts --project=chromium --headed
 */
test.describe('Dropdown Debug - Reproduce Soak Test Issue', () => {
    test('click mode dropdown and select Native', async ({ page }) => {
        // Step 1: Login
        console.log('[DEBUG] Logging in...');
        await programmaticLoginWithRoutes(page);

        // Step 2: Navigate to session page
        console.log('[DEBUG] Navigating to /session...');
        await navigateToRoute(page, '/session');

        // Wait for session page to load
        await page.waitForSelector('[data-testid="session-start-stop-button"]', { timeout: 10000 });
        console.log('[DEBUG] Session page loaded');

        // Step 3: Find the dropdown trigger button
        console.log('[DEBUG] Looking for mode dropdown...');
        const modeButton = page.getByRole('button', { name: /Native|Cloud AI|On-Device/ });
        await expect(modeButton).toBeVisible();
        console.log('[DEBUG] Mode button found');

        // Step 4: Take screenshot BEFORE clicking
        await page.screenshot({ path: 'test-results/debug/before-dropdown-click.png' });
        console.log('[DEBUG] Screenshot saved: before-dropdown-click.png');

        // Step 5: Click the dropdown
        console.log('[DEBUG] Clicking mode button...');
        await modeButton.click();

        // Step 6: Wait and screenshot AFTER clicking
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'test-results/debug/after-dropdown-click.png' });
        console.log('[DEBUG] Screenshot saved: after-dropdown-click.png');

        // Step 7: Try to click "Native" option using the correct selector
        console.log('[DEBUG] Looking for Native option (using menuitemradio role)...');
        const nativeOption = page.getByRole('menuitemradio', { name: 'Native' });

        // Check if it's visible
        const isVisible = await nativeOption.isVisible().catch(() => false);
        console.log(`[DEBUG] Native option visible: ${isVisible}`);

        if (isVisible) {
            console.log('[DEBUG] Clicking Native option...');
            await nativeOption.click();
            console.log('[DEBUG] Native option clicked successfully!');
        } else {
            // Screenshot to see what's happening
            await page.screenshot({ path: 'test-results/debug/native-not-visible.png' });
            console.log('[DEBUG] Native option NOT visible - check screenshot');

            // Try alternative selectors
            const allNativeElements = await page.getByText('Native').all();
            console.log(`[DEBUG] Found ${allNativeElements.length} elements with text "Native"`);

            for (let i = 0; i < allNativeElements.length; i++) {
                const el = allNativeElements[i];
                const box = await el.boundingBox();
                console.log(`[DEBUG] Element ${i}: bounding box = ${JSON.stringify(box)}`);
            }
        }

        // Final screenshot
        await page.screenshot({ path: 'test-results/debug/final-state.png' });
        console.log('[DEBUG] Test completed');
    });
});
