import { test, expect } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { ALPHA_BYPASS_CODE } from '../../frontend/src/config/alpha-bypass';
import { goToPublicRoute, navigateToRoute } from './helpers';

test.describe('Alpha Bypass Code Journey', () => {
    test.beforeEach(async ({ page }) => {
        // 1. Setup global mocks (Playwright-native interceptors)
        await setupE2EMocks(page);
    });

    test('should allow an alpha tester to bypass Stripe via promo code', async ({ page }) => {
        // 1. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');

        // 2. Select Pro Plan
        await page.click('[data-testid="plan-pro-option"]');

        // 3. Fill in credentials
        await page.fill('[data-testid="email-input"]', 'alpha@example.com');
        await page.fill('[data-testid="password-input"]', 'password123');

        // 4. Reveal and enter bypass code
        await page.click('text=Have a bypass code?');
        await page.fill('[data-testid="promo-code-input"]', ALPHA_BYPASS_CODE);

        // 5. Submit signup
        // AuthPage logic for 'sign_up' handles sign-in then apply-promo
        await page.click('[data-testid="sign-up-submit"]');

        // 6. Verify transition to /session (Pro Dashboard)
        await expect(page).toHaveURL(/\/session/);

        // 7. Verify Pro features are visible
        // We can check if "On-Device" mode is available (not disabled)
        await page.click('button:has-text("Native")'); // Open mode selector
        const onDeviceOption = page.locator('role=menuitemradio[name*="On-Device"]');
        await expect(onDeviceOption).not.toHaveAttribute('disabled', '');

        // 8. Navigate to Analytics and verify the Pro status
        await navigateToRoute(page, '/analytics');

        // The merged oval should show Pro Plan Active (or the Free Plan bar should be gone)
        // In my implementation: 
        // {!isSessionView && isPro && (
        //    <div className="w-full flex items-center justify-center bg-secondary text-gray-900 px-6 py-3 rounded-full">
        //        <span className="font-medium">✨ Pro Plan Active</span>
        //    </div>
        // )}
        await expect(page.locator('text=Pro Plan Active')).toBeVisible();
        await expect(page.locator('text=Free Plan')).not.toBeVisible();
    });

    test('should fallback to Stripe if bypass code is invalid', async ({ page }) => {
        await goToPublicRoute(page, '/auth/signup');
        await page.click('[data-testid="plan-pro-option"]');
        await page.fill('[data-testid="email-input"]', 'badalpha@example.com');
        await page.fill('[data-testid="password-input"]', 'password123');

        await page.click('text=Have a bypass code?');
        await page.fill('[data-testid="promo-code-input"]', 'WRONG_CODE');

        await page.click('[data-testid="sign-up-submit"]');

        // Should fallback to standard Pro checkout
        await expect(page).toHaveURL(/checkout.stripe.com/);
    });
});
