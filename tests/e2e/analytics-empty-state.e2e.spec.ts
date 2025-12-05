import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Analytics Page - Empty State', () => {
    test.skip('should display empty state when user has no session history', async ({ page }) => {
        // Capture all browser console logs
        page.on('console', msg => {
            const type = msg.type().toUpperCase();
            console.log(`[BROWSER ${type}]`, msg.text());
        });

        // Set the flag BEFORE login so it's available when the page loads
        console.log('[TEST] Setting __E2E_EMPTY_SESSIONS__ flag');
        await page.goto('/');
        await page.evaluate(() => {
            console.log('[BROWSER] Setting __E2E_EMPTY_SESSIONS__ flag to true');
            (window as Window & { __E2E_EMPTY_SESSIONS__?: boolean }).__E2E_EMPTY_SESSIONS__ = true;
        });

        console.log('[TEST] Performing programmatic login');
        await programmaticLogin(page);

        // Navigate to analytics page
        console.log('[TEST] Navigating to /analytics');
        await page.goto('/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Wait for empty state UI to render (per first reviewer's recommendation)
        console.log('[TEST] Waiting for empty state heading');
        const emptyStateHeading = page.getByRole('heading', { name: /Your Dashboard Awaits!/i });
        await emptyStateHeading.waitFor({ state: 'visible', timeout: 5000 });

        // Verify empty state component is visible
        const emptyState = page.getByTestId('analytics-dashboard-empty-state');
        await expect(emptyState).toBeVisible();

        // Verify empty state messaging
        await expect(page.getByText(/Your Dashboard Awaits!/i)).toBeVisible();
        await expect(page.getByText(/Record your next session to unlock your progress/i)).toBeVisible();

        // Verify call-to-action button
        const ctaButton = page.getByRole('link', { name: /Get Started/i });
        await expect(ctaButton).toBeVisible();

        // Verify CTA links to session page
        await expect(ctaButton).toHaveAttribute('href', '/session');
        console.log('[TEST] ✅ Empty state test passed');
    });
});
