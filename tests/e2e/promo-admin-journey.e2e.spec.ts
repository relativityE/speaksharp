import { test, expect } from './fixtures';
import { goToPublicRoute, navigateToRoute } from './helpers';

/**
 * Promo Admin Journey E2E Test
 * 
 * This test validates the promo code UI flow using MOCKED backend responses.
 */
test.describe('Promo Admin Journey', () => {

    test('should allow a promo user to bypass Stripe via promo code', async ({ mockedPage: page }) => {
        // 1. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');

        // Wait for page to be ready
        await page.waitForSelector('[data-testid="email-input"]', { timeout: 10000 });

        // 2. Select Pro Plan
        await page.click('[data-testid="plan-pro-option"]', { timeout: 10000 });

        // 3. Fill in credentials
        const uniqueEmail = `alpha.${Date.now()}@example.com`;
        await page.fill('[data-testid="email-input"]', uniqueEmail);
        await page.fill('[data-testid="password-input"]', 'password123');

        // 4. Reveal and enter bypass code
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

    test('shows inline error when promo fails with no valid credentials (validation phase)', async ({ mockedPage: page }) => {
        // 1. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');
        await page.waitForSelector('[data-testid="email-input"]');

        // 2. Reveal and enter invalid promo BUT NO credentials
        await page.click('text=🎁 Have a promo code? Click here!');
        await page.fill('[data-testid="promo-code-input"]', 'INVALID-PROMO');
        
        // 3. Submit
        await page.click('[data-testid="sign-up-submit"]');

        // 4. Verify RED BOLD inline error
        const inlineError = page.locator('[data-testid="signup-inline-error"]');
        await expect(inlineError).toBeVisible();
        await expect(inlineError).toHaveClass(/text-red-600/);
        await expect(inlineError).toHaveClass(/font-bold/);
        
        // 5. Ensure NO redirect happens
        await expect(page).not.toHaveURL(/\/session/);
    });

    test('redirects as free user when promo fails but credentials are valid', async ({ mockedPage: page }) => {
        // 1. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');
        await page.waitForSelector('[data-testid="email-input"]');

        // 2. Select Pro
        await page.click('[data-testid="plan-pro-option"]');

        // 3. Fill in VALID credentials
        await page.fill('[data-testid="email-input"]', `valid.${Date.now()}@example.com`);
        await page.fill('[data-testid="password-input"]', 'password123');

        // 4. Fill in INVALID promo
        await page.click('text=🎁 Have a promo code? Click here!');
        await page.fill('[data-testid="promo-code-input"]', 'INVALID-PROMO');
        
        // 5. Submit
        await page.click('[data-testid="sign-up-submit"]');

        // 6. Verify transition to /session
        await expect(page).toHaveURL(/\/session/, { timeout: 15000 });

        // 7. Verify EXACT toast message from spec
        await expect(page.getByText("Promo code invalid. You've been signed up as a free user.")).toBeVisible();
    });
});
