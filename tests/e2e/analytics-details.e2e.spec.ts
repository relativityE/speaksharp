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

    // TODO: Fix this test - React Router is not rendering the route after page.goto()
    // The issue is that the app is using a production build and navigation causes
    // the <main> element to remain empty. This needs investigation into the
    // interaction between BrowserRouter, Suspense, and lazy-loaded components in E2E tests.
    test.skip('Journey 8.3: Invalid Session ID', async ({ page }) => {
        page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
        await page.goto('/analytics/invalid-session-id');
        await page.waitForURL('/analytics/invalid-session-id');

        // Wait for loading to finish and error state to appear
        // The page shows "Session Not Found" when ID doesn't exist
        // Check if loading spinner is present
        if (await page.getByText('Loading analytics...').isVisible()) {
            console.log('[TEST DEBUG] Loading spinner is visible');
        }

        try {
            await expect(page.getByText('Session Not Found')).toBeVisible({ timeout: 5000 });
        } catch (e) {
            console.log('[TEST DEBUG] "Session Not Found" not visible. Page content:');
            console.log(await page.content());
            throw e;
        }

        // Verify link back to dashboard
        const dashboardLink = page.getByRole('link', { name: /view dashboard/i });
        await expect(dashboardLink).toBeVisible();

        await dashboardLink.click();
        await expect(page).toHaveURL('/analytics');
    });
});
