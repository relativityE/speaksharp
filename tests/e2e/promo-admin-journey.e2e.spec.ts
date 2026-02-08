import { test, expect } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { goToPublicRoute, navigateToRoute } from './helpers';

/**
 * Promo Admin Journey E2E Test
 * 
 * This test validates the promo code UI flow using MOCKED backend responses.
 * For real backend testing, use manual verification:
 *   1. pnpm generate-promo → get code
 *   2. Use code in app signup → verify Pro access
 */
test.describe('Promo Admin Journey', () => {

    test.beforeEach(async ({ page }) => {
        await setupE2EMocks(page);
    });

    test('should allow a promo user to bypass Stripe via promo code', async ({ page }) => {
        // 1. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');

        // Wait for page to be ready
        await page.waitForSelector('[data-testid="email-input"]', { timeout: 10000 });

        // 2. Select Pro Plan (with explicit timeout to fail fast if not found)
        await page.click('[data-testid="plan-pro-option"]', { timeout: 10000 });

        // 3. Fill in credentials
        const uniqueEmail = `alpha.${Date.now()}@example.com`;
        await page.fill('[data-testid="email-input"]', uniqueEmail);
        await page.fill('[data-testid="password-input"]', 'password123');

        // 4. Reveal and enter bypass code (uses mock handler accepting MOCK-PROMO-123)
        await page.click('text=🎁 Have a promo code? Click here!');
        await page.fill('[data-testid="promo-code-input"]', 'MOCK-PROMO-123');

        // 5. Submit signup
        await page.click('[data-testid="sign-up-submit"]');

        // 6. Verify transition to /session (Pro Dashboard)
        await expect(page).toHaveURL(/\/session/, { timeout: 15000 });

        // 7. Verify Pro features are visible
        await page.click('button:has-text("Native")');
        const privateOption = page.locator('role=menuitemradio', { hasText: 'Private' });
        await expect(privateOption).not.toHaveAttribute('aria-disabled', 'true');

        // 8. Navigate to Analytics and verify the Pro status
        await navigateToRoute(page, '/analytics', { waitForMocks: false });
        await expect(page.locator('text=Pro Plan Active')).toBeVisible();
        await expect(page.locator('text=Free Plan')).not.toBeVisible();
    });

    test('should fallback to Stripe if bypass code is invalid', async ({ page }) => {
        await goToPublicRoute(page, '/auth/signup');
        await page.waitForSelector('[data-testid="email-input"]', { timeout: 10000 });
        await page.click('[data-testid="plan-pro-option"]', { timeout: 10000 });
        await page.fill('[data-testid="email-input"]', `badpromo.${Date.now()}@example.com`);
        await page.fill('[data-testid="password-input"]', 'password123');

        await page.click('text=🎁 Have a promo code? Click here!', { timeout: 10000 });
        await page.fill('[data-testid="promo-code-input"]', 'WRONG_CODE');

        await page.click('[data-testid="sign-up-submit"]', { timeout: 10000 });

        // Should redirect to session (since login succeeded) but show error toast
        await page.waitForURL(/\/session/, { timeout: 15000 });
        await expect(page.getByText(/promo failed/i)).toBeVisible({ timeout: 10000 });
    });
});
