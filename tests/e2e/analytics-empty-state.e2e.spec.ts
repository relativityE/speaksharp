import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Analytics Page - Empty State', () => {
    test('should display empty state for new user with no sessions', async ({ page }) => {
        // Step 1: Log in as a new user with NO sessions
        await programmaticLogin(page, { sessions: [] });

        // Step 2: Navigate to analytics page
        await page.goto('/analytics');

        // Step 3: Verify page loaded
        await expect(page).toHaveURL('/analytics');
        const mainHeading = page.getByTestId('dashboard-heading');
        await expect(mainHeading).toBeVisible({ timeout: 10000 });

        // Step 4: Assert empty state is displayed
        const emptyState = page.getByTestId('analytics-dashboard-empty-state');
        await expect(emptyState).toBeVisible();

        // Step 5: Verify empty state message
        await expect(emptyState.getByRole('heading', { name: /Your Dashboard Awaits/i })).toBeVisible();
        await expect(emptyState.getByText(/Record your next session/i)).toBeVisible();

        // Step 6: Verify CTA button exists and works
        const ctaButton = emptyState.getByRole('button', { name: /Start a New Session/i });
        await expect(ctaButton).toBeVisible();
        await expect(ctaButton).toBeEnabled();

        // Step 7: Click CTA and verify navigation
        await ctaButton.click();
        await expect(page).toHaveURL(/\/sessions/);
    });

    test('should not display stat cards when no sessions exist', async ({ page }) => {
        // Step 1: Log in as new user with NO sessions
        await programmaticLogin(page, { sessions: [] });

        // Step 2: Navigate to analytics
        await page.goto('/analytics');

        // Step 3: Verify empty state is shown (not stat cards)
        const emptyState = page.getByTestId('analytics-dashboard-empty-state');
        await expect(emptyState).toBeVisible();

        // Step 4: Verify stat cards are NOT displayed
        const speakingPace = page.getByTestId('speaking-pace');
        const clarityScore = page.getByTestId('clarity-score');

        await expect(speakingPace).not.toBeVisible();
        await expect(clarityScore).not.toBeVisible();
    });

    test('should show Sparkles icon in empty state', async ({ page }) => {
        // Visual verification test
        await programmaticLogin(page, { sessions: [] });
        await page.goto('/analytics');

        const emptyState = page.getByTestId('analytics-dashboard-empty-state');
        await expect(emptyState).toBeVisible();

        // Verify Sparkles SVG icon is present (icon rendered by lucide-react)
        const icon = emptyState.locator('svg').first();
        await expect(icon).toBeVisible();
    });
});
