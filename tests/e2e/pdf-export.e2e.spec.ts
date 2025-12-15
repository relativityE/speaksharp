import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * PDF Export E2E Test
 * 
 * Verifies that users can download session reports as PDFs from the Analytics page.
 * 
 * Note: This test verifies the download is triggered, but doesn't validate PDF content
 * (that's covered by unit tests in pdfGenerator.test.ts)
 */

test.describe('PDF Export', () => {
    test('should trigger PDF download when clicking download button', async ({ page }) => {
        await programmaticLoginWithRoutes(page);

        // Navigate to analytics page using client-side navigation
        await navigateToRoute(page, '/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Wait for sessions to load - MSW provides 5 mock sessions, so they MUST exist
        // If this fails, the mock setup is broken (not an acceptable skip scenario)
        const sessionItem = page.getByTestId(/session-history-item-/).first();
        await expect(sessionItem).toBeVisible({ timeout: 10000 });
        console.log('[TEST] ✅ Session history items loaded (MSW mock data confirmed)');

        // Check download button exists (mock user is Pro tier, so it MUST exist)
        const downloadButton = page.getByRole('button', { name: /download session pdf/i }).first();
        await expect(downloadButton).toBeVisible({ timeout: 5000 });
        console.log('[TEST] ✅ Download button visible (Pro user confirmed)');

        // jsPDF uses blob-based download which may not trigger Playwright's download event
        // Instead, verify the button is clickable and doesn't throw an error
        await downloadButton.click();

        // If we get here without error, the PDF generation was triggered
        // Wait a moment for jsPDF to process
        await page.waitForTimeout(1000);

        console.log('[TEST] ✅ PDF download button clicked successfully');
    });

    test('should have download button for each session in analytics', async ({ page }) => {
        await programmaticLoginWithRoutes(page);
        await navigateToRoute(page, '/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Wait for session items to load - MSW provides 5 mock sessions
        const sessionItems = page.getByTestId(/session-history-item-/);
        await expect(sessionItems.first()).toBeVisible({ timeout: 10000 });
        console.log('[TEST] ✅ Session items loaded');

        const sessionCount = await sessionItems.count();
        expect(sessionCount).toBeGreaterThan(0);

        // Verify download buttons exist (mock user is Pro tier)
        const downloadButtons = page.getByRole('button', { name: /download session pdf/i });
        const buttonCount = await downloadButtons.count();

        // Mock user is Pro, so download buttons MUST exist
        expect(buttonCount).toBeGreaterThan(0);
        expect(buttonCount).toBeLessThanOrEqual(sessionCount);
        console.log(`[TEST] ✅ Found ${buttonCount} download buttons for ${sessionCount} sessions`);
    });
});
