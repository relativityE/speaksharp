import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers';

test.describe('Analytics Page - Empty State', () => {
    test('should display empty state when user has no session history', async ({ page }) => {
        // Set the flag using addInitScript to ensure it's available before any code runs
        await page.addInitScript(() => {
            Object.assign(window, { __E2E_EMPTY_SESSIONS__: true });
        });

        await programmaticLoginWithRoutes(page);

        // Ensure fresh state and synchronize MSW
        await page.reload();
        await page.waitForLoadState('networkidle');

        // Navigate to analytics page using client-side navigation (NOT page.goto!)
        await navigateToRoute(page, '/analytics');
        await page.waitForSelector('[data-testid="app-main"]');

        // Wait for empty state UI to render
        const emptyStateHeading = page.getByRole('heading', { name: /Your Dashboard Awaits!/i });
        await emptyStateHeading.waitFor({ state: 'visible', timeout: 10000 });

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
        debugLog('[TEST] ✅ Empty state test passed');
    });
});
