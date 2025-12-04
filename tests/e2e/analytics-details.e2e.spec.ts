import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Analytics Details', () => {
    test.beforeEach(async ({ page }) => {
        await programmaticLogin(page);
    });

    test('Journey 8: Session Detail View', async ({ page }) => {
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Check if there are sessions (mocked data usually has some)
        const sessionLink = page.locator('a[href^="/analytics/"]').first();

        if (await sessionLink.isVisible()) {
            await sessionLink.click();

            // Verify URL pattern
            await expect(page).toHaveURL(/\/analytics\/[a-zA-Z0-9-]+/);

            // Verify page title or header
            await expect(page.getByText(/session analysis/i)).toBeVisible();

            // Verify metrics presence
            await expect(page.getByText(/clarity score/i)).toBeVisible();
            await expect(page.getByText(/speaking rate/i)).toBeVisible();
        } else {
            console.log('No sessions found in analytics list - skipping detail view verification');
        }
    });

    test('Journey 8.3: Invalid Session ID', async ({ page }) => {
        await page.goto('/analytics/invalid-session-id');

        // Verify error message or redirect
        // Assuming it shows a "Session not found" message or redirects to analytics
        const errorMsg = page.getByText(/session not found/i);
        const dashboardLink = page.getByRole('link', { name: /back to dashboard/i });

        if (await errorMsg.isVisible()) {
            await expect(errorMsg).toBeVisible();
            if (await dashboardLink.isVisible()) {
                await dashboardLink.click();
                await expect(page).toHaveURL('/analytics');
            }
        } else {
            // If it redirects automatically
            await expect(page).toHaveURL('/analytics');
        }
    });
});
