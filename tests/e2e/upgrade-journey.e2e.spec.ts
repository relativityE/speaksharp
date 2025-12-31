/**
 * Upgrade Journey E2E Test
 * 
 * Tests the monetization path for Pro user signup.
 */
import { test, expect } from '@playwright/test';
import { goToPublicRoute } from './helpers';
import { setupE2EMocks } from './mock-routes';

test.describe('Upgrade Journey - Monetization Path', () => {
    /**
     * Test: Signup page displays correctly and Pro plan is selectable
     */
    test('should display signup form with plan selection', async ({ page }) => {
        // 1. Setup mocks
        await setupE2EMocks(page);

        // 2. Navigate to signup page
        await goToPublicRoute(page, '/auth/signup');

        // 3. Verify signup form loads
        const authForm = page.getByTestId('auth-form');
        await expect(authForm).toBeVisible({ timeout: 15000 });

        // 4. Verify Pro plan option exists and is selectable
        const proOption = page.getByTestId('plan-pro-option');
        await expect(proOption).toBeVisible();
        await proOption.click();

        // 5. Verify Pro is selected (check for active class)
        await expect(proOption).toHaveClass(/border-primary/);
        console.log('[UPGRADE] ✅ Pro plan selectable');
    });

    /**
     * Test: Form submission with Pro plan triggers Stripe checkout call
     */
    test('should attempt Stripe checkout when submitting with Pro plan', async ({ page }) => {
        let stripeCheckoutCalled = false;

        // 1. Setup BASE mocks first
        await setupE2EMocks(page);

        // 2. Setup SPECIFIC test overrides AFTER (Playwright checks routes in reverse order)
        await page.route('**/functions/v1/stripe-checkout', async (route) => {
            stripeCheckoutCalled = true;
            console.log('[UPGRADE] ✅ Intercepted stripe-checkout call');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    checkoutUrl: 'https://checkout.stripe.com/mock-session'
                })
            });
        });

        // 3. Intercept the Stripe redirect itself
        await page.route('**/checkout.stripe.com/**', async (route) => {
            console.log('[UPGRADE] ✅ Intercepted navigation to Stripe');
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<html><body>Mock Stripe Checkout</body></html>'
            });
        });

        // 4. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');
        await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 15000 });

        // 5. Fill form
        await page.getByTestId('email-input').fill('pro-upgrade-test@example.com');
        await page.getByTestId('password-input').fill('SecurePassword123!');

        // 6. Select Pro plan
        await page.getByTestId('plan-pro-option').click();

        // 7. Submit
        await page.getByTestId('sign-up-submit').click();

        // 8. Wait for the redirect attempt
        await page.waitForTimeout(3000);

        expect(stripeCheckoutCalled).toBe(true);
        console.log('[UPGRADE] ✅ Upgrade journey Stripe trigger verified');
    });
});
