import { test, expect } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { goToPublicRoute, navigateToRoute } from './helpers';

/**
 * Bypass Code Journey E2E Test
 * 
 * This test validates the promo code UI flow using MOCKED backend responses.
 * For real backend testing, use manual verification:
 *   1. pnpm generate-promo → get code
 *   2. Use code in app signup → verify Pro access
 */
test.describe('Bypass Code Journey', () => {

    test.beforeEach(async ({ page }) => {
        await setupE2EMocks(page);
    });

    test('should allow a promo user to bypass Stripe via promo code', async ({ page }) => {
        // 1. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');

        // 2. Select Pro Plan
        await page.click('[data-testid="plan-pro-option"]');

        // 3. Fill in credentials
        const uniqueEmail = `alpha.${Date.now()}@example.com`;
        await page.fill('[data-testid="email-input"]', uniqueEmail);
        await page.fill('[data-testid="password-input"]', 'password123');

        // 4. Reveal and enter bypass code (uses mock handler accepting MOCK-PROMO-123)
        await page.click('text=Have a one-time \'pro\' user promo code?');
        await page.fill('[data-testid="promo-code-input"]', 'MOCK-PROMO-123');

        // 5. Submit signup
        await page.click('[data-testid="sign-up-submit"]');

        // 6. Verify transition to /session (Pro Dashboard)
        await expect(page).toHaveURL(/\/session/, { timeout: 15000 });

        // 7. Verify Pro features are visible
        await page.click('button:has-text("Native")');
        const privateOption = page.locator('role=menuitemradio[name*="Private"]');
        await expect(privateOption).not.toHaveAttribute('disabled', '');

        // 8. Navigate to Analytics and verify the Pro status
        await navigateToRoute(page, '/analytics');
        await expect(page.locator('text=Pro Plan Active')).toBeVisible();
        await expect(page.locator('text=Free Plan')).not.toBeVisible();
    });

    test('should fallback to Stripe if bypass code is invalid', async ({ page }) => {
        await goToPublicRoute(page, '/auth/signup');
        await page.click('[data-testid="plan-pro-option"]');
        await page.fill('[data-testid="email-input"]', `badpromo.${Date.now()}@example.com`);
        await page.fill('[data-testid="password-input"]', 'password123');

        await page.click('text=Have a one-time \'pro\' user promo code?');
        await page.fill('[data-testid="promo-code-input"]', 'WRONG_CODE');

        await page.click('[data-testid="sign-up-submit"]');

        // Should fallback to standard Pro checkout
        await expect(page).toHaveURL(/checkout.stripe.com/);
    });
});
