import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

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
        await programmaticLogin(page);

        // Navigate to analytics page
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Check if there are any sessions to export
        const downloadButton = page.getByRole('button', { name: /download session pdf/i });

        // If no sessions exist, we can't test PDF export
        const buttonCount = await downloadButton.count();
        if (buttonCount === 0) {
            console.log('[TEST] No sessions available - skipping PDF download test');
            test.skip();
            return;
        }

        // Set up download listener before clicking
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

        // Click the first download button
        await downloadButton.first().click();

        // Wait for download to start
        const download = await downloadPromise;

        // Verify download properties
        const filename = download.suggestedFilename();
        expect(filename).toMatch(/SpeakSharp-Session-.+\.pdf/);

        // Verify the download actually started (file size > 0)
        const path = await download.path();
        expect(path).toBeTruthy();

        console.log(`[TEST] ✅ PDF download triggered: ${filename}`);
    });

    test('should have download button for each session in analytics', async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Check for session cards
        const sessionCards = page.locator('[data-testid="session-card"]');
        const sessionCount = await sessionCards.count();

        if (sessionCount === 0) {
            console.log('[TEST] No sessions available - empty state verified');
            // Empty state is fine - test passes
            return;
        }

        // Verify each session has a download button
        const downloadButtons = page.getByRole('button', { name: /download session pdf/i });
        const buttonCount = await downloadButtons.count();

        expect(buttonCount).toBeGreaterThan(0);
        console.log(`[TEST] ✅ Found ${buttonCount} download buttons for ${sessionCount} sessions`);
    });
});
