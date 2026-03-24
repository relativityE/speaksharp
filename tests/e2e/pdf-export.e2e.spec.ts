import { test, expect } from './fixtures';
import { navigateToRoute, debugLog } from './helpers';

/**
 * PDF Export E2E Test
 * 
 * Verifies that users can download session reports as PDFs from the Analytics page.
 */

test.describe('PDF Export', () => {
    test('should trigger PDF download and verify filename', async ({ proPage }) => {
        // Ensure fresh state and synchronize MSW
        await proPage.reload();
        

        await navigateToRoute(proPage, '/analytics');
        
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });

        // Ensure download button is visible (Pro user)
        const downloadButton = proPage.getByTestId(/^download-pdf-btn-(?!mobile)/).first();
        await expect(downloadButton).toBeVisible();

        // Setup download listener BEFORE clicking
        const downloadPromise = proPage.waitForEvent('download');

        await downloadButton.click();
        const download = await downloadPromise;

        // Verify Filename logic
        const filename = download.suggestedFilename();
        debugLog(`[TEST] 📥 Downloaded filename: ${filename}`);

        expect(filename).toMatch(/^session_\d{8}_.*\.pdf$/);
        expect(filename).not.toMatch(/^[a-z0-9-]{36}$/i); // Should NOT be a GUID

        // Save to filesystem
        const savePath = `test-results/downloads/${filename}`;
        await download.saveAs(savePath);
        debugLog(`[TEST] ✅ Saved PDF to: ${savePath}`);

        // Optional: Verify file size > 0
        const fs = await import('fs');
        const stats = fs.statSync(savePath);
        expect(stats.size).toBeGreaterThan(0);
    });

    test('should download valid PDF file (E2E scope)', async ({ proPage }) => {
        // Ensure fresh state and synchronize MSW
        await proPage.reload();
        

        await navigateToRoute(proPage, '/analytics');
        
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });

        const downloadButton = proPage.getByTestId(/^download-pdf-btn-(?!mobile)/).first();
        await expect(downloadButton).toBeVisible();

        const downloadPromise = proPage.waitForEvent('download');
        await downloadButton.click();
        const download = await downloadPromise;

        // Save PDF to disk
        const filename = download.suggestedFilename();
        const savePath = `test-results/downloads/${filename}`;
        await download.saveAs(savePath);

        // E2E SCOPE: Verify file is valid PDF
        const fs = await import('fs');
        const pdfBuffer = fs.readFileSync(savePath);

        // 1. Valid PDF header
        expect(pdfBuffer.subarray(0, 5).toString()).toBe('%PDF-');
        debugLog('[TEST] ✅ PDF Header verified: %PDF-');

        // 2. Non-trivial content
        expect(pdfBuffer.length).toBeGreaterThan(1000);
        debugLog(`[TEST] ✅ PDF Size verified: ${pdfBuffer.length} bytes`);
    });

    test('should have download button for each session in analytics', async ({ proPage }) => {
        // Ensure fresh state and synchronize MSW
        await proPage.reload();
        

        await navigateToRoute(proPage, '/analytics');
        
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });

        // Wait for session items to load - MSW provides 5 mock sessions
        const sessionItems = proPage.getByTestId(/session-history-item-/);
        await expect(sessionItems.first()).toBeVisible({ timeout: 10000 });
        debugLog('[TEST] ✅ Session items loaded');

        const sessionCount = await sessionItems.count();
        expect(sessionCount).toBeGreaterThan(0);

        // Verify download buttons exist (mock user is Pro tier)
        const downloadButtons = proPage.getByTestId(/^download-pdf-btn-(?!mobile)/);
        const buttonCount = await downloadButtons.count();

        // Mock user is Pro, so download buttons MUST exist
        expect(buttonCount).toBeGreaterThan(0);
        expect(buttonCount).toBeLessThanOrEqual(sessionCount);
        debugLog(`[TEST] ✅ Found ${buttonCount} download buttons for ${sessionCount} sessions`);
    });
});
