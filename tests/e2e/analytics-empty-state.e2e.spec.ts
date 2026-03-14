import { test, expect } from './fixtures';
import { navigateToRoute, debugLog } from './helpers';

test.describe('Analytics Page - Empty State', () => {
    test('should display empty state when user has no session history', async ({ emptyUserPage }) => {
        // Ensure fresh state and synchronize MSW
        await emptyUserPage.reload();
        await emptyUserPage.waitForLoadState('networkidle');

        // Navigate to analytics page using client-side navigation (NOT page.goto!)
        await navigateToRoute(emptyUserPage, '/analytics');
        await emptyUserPage.waitForSelector('[data-testid="app-main"]');

        // Wait for empty state UI to render
        const emptyStateHeading = emptyUserPage.getByRole('heading', { name: /Your Dashboard Awaits!/i });
        await emptyStateHeading.waitFor({ state: 'visible', timeout: 10000 });

        // Verify empty state component is visible
        const emptyState = emptyUserPage.getByTestId('analytics-dashboard-empty-state');
        await expect(emptyState).toBeVisible();

        // Verify empty state messaging
        await expect(emptyUserPage.getByText(/Your Dashboard Awaits!/i)).toBeVisible();
        await expect(emptyUserPage.getByText(/Record your next session to unlock your progress/i)).toBeVisible();

        // Verify call-to-action button
        const ctaButton = emptyUserPage.getByRole('link', { name: /Get Started/i });
        await expect(ctaButton).toBeVisible();

        // Verify CTA links to session page
        await expect(ctaButton).toHaveAttribute('href', '/session');

        debugLog('[TEST] ✅ Empty state test passed');
    });
});
