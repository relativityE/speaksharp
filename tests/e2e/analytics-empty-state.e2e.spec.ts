import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Analytics Page - Empty State', () => {
    test('should display empty state when user has no session history', async ({ page }) => {
        // Mock MSW to return empty sessions array
        await page.route('**/rest/v1/sessions*', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
        });

        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForURL('**/analytics');

        // Verify empty state UI is displayed
        const emptyState = page.getByTestId('analytics-empty-state');
        await expect(emptyState).toBeVisible({ timeout: 10000 });

        // Verify empty state messaging
        await expect(page.getByText(/no sessions yet/i)).toBeVisible();

        // Verify call-to-action button
        const ctaButton = page.getByRole('link', { name: /start.*session/i });
        await expect(ctaButton).toBeVisible();

        // Verify CTA links to session page
        await expect(ctaButton).toHaveAttribute('href', '/session');
    });
});
