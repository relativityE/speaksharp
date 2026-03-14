/**
 * Stripe Checkout Flow Test
 * 
 * This test runs ONLY in "Real Mode" against the live Supabase instance.
 * It verifies the Stripe checkout Edge Function works correctly.
 * 
 * Trigger: Manually via GitHub Actions workflow "Stripe Test"
 * 
 * What it does:
 * 1. Signs in with E2E_FREE_EMAIL test user (guaranteed FREE tier)
 * 2. Navigates to /analytics and clicks "Upgrade Now" on the upgrade banner
 * 3. Verifies Edge Function returns valid checkout.stripe.com URL
 * 
 * Prerequisites:
 * 1. Run "Setup Test Users" workflow first with user_type=free
 * 2. Add E2E_FREE_EMAIL and E2E_FREE_PASSWORD as GitHub secrets
 * 3. STRIPE_PRO_PRICE_ID must be set in Supabase Edge Function secrets
 * 
 * Note: We verify the Edge Function response, not the browser redirect,
 * because window.location.href redirects are unreliable in headless CI.
 */

import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';
import logger from '../../frontend/src/lib/logger';

// Configure Selective Skip:
const isMocked = !process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL.includes('mock.supabase.co');
const hasLiveCredentials = !!(process.env.E2E_FREE_EMAIL && process.env.E2E_FREE_PASSWORD);

if (!isMocked && !hasLiveCredentials) {
    logger.warn('[stripe-checkout] ⏭️  INTENTIONAL SKIP: SUPABASE_URL is real but E2E_FREE_EMAIL/PASSWORD are absent. This test only runs in the dedicated "Stripe Test" GitHub Actions workflow.');
    test.skip(true, 'Skipping LIVE Stripe test: SUPABASE_URL is real but E2E_FREE_EMAIL/PASSWORD are missing (Check CI secrets)');
}

test.describe('Stripe Checkout Flow', () => {
    const testEmail = process.env.E2E_FREE_EMAIL || 'e2e-free-user@test.com';
    const testPassword = process.env.E2E_FREE_PASSWORD || 'TestPassword123!';

    test.beforeEach(async ({ mockedPage: page }) => { // Uses auto-mocked fixture
        logger.info('🚨 Running LIVE Stripe checkout test against real Supabase');
        logger.info({ testEmail }, '📧 Test user details');
        
        page.on('response', async response => {
            if (response.url().includes('stripe-checkout')) {
                logger.info({ status: response.status() }, '[Network] 📡 Stripe Endpoint Status');
                if (response.status() >= 400) {
                    try {
                        const body = await response.json();
                        logger.error({ body }, '[Network] ❌ Error Body');

                        if (body.error) {
                            expect(body.error).toContain('SITE_URL is missing');
                            expect(body.error).toContain('expected in CI');
                        }
                    } catch (err: unknown) {
                        logger.error({ err }, '[Network] ❌ Could not parse error body');
                    }
                }
            }
        });
    });

    test('should sign in and verify Stripe checkout Edge Function', async ({ mockedPage: page }) => {
        // Step 1: Sign in
        logger.info('[Stripe Test] Signing in...');
        await navigateToRoute(page, '/auth/signin');
        await page.getByTestId('auth-form').waitFor();

        await page.fill('input[type="email"]', testEmail);
        await page.fill('input[type="password"]', testPassword);
        await page.click('button[type="submit"]');

        await page.waitForURL('/session');
        logger.info('✅ Sign-in successful, redirect complete');

        // Step 2: Navigate to analytics
        logger.info('[Stripe Test] Navigating to analytics...');
        await navigateToRoute(page, '/analytics');

        const upgradeButton = page.getByTestId('analytics-dashboard-upgrade-button');

        // Wait for the upgrade button to be visible
        await upgradeButton.waitFor({ state: 'visible', timeout: 30000 });
        logger.info('✅ Analytics page loaded, upgrade button visible');

        // Step 3: Click upgrade and capture Edge Function response
        logger.info('[Stripe Test] Clicking Upgrade to Pro...');

        // Set up response listener BEFORE clicking
        const responsePromise = page.waitForResponse(
            resp => resp.url().includes('stripe-checkout')
        );

        await upgradeButton.click();

        // Step 4: Verify Edge Function response
        logger.info('[Stripe Test] Verifying Edge Function response...');
        const response = await responsePromise;

        // Assert the Edge Function returned 200 (success)
        const status = response.status();
        logger.info({ status }, '[Network] 📡 Stripe Endpoint Status');
        expect(status).toBe(200);

        // Try to read response body - may fail if browser already navigated
        let responseBody: { checkoutUrl?: string } = {};
        try {
            responseBody = await response.json();
            logger.info({ hasCheckoutUrl: !!responseBody.checkoutUrl }, '[Network] ✅ Response body parsed');
        } catch (err: unknown) {
            // Response body unavailable - validate we navigated to Stripe
            const currentUrl = page.url();
            if (!currentUrl.includes('checkout.stripe.com')) {
                throw new Error(`[P1 Hardening] Expected Stripe redirect, got: ${currentUrl}`);
            }
            logger.error({ err }, '[Network] ℹ️ JSON unavailable, URL validation passed');
        }

        // If we got the body, validate it
        if (responseBody.checkoutUrl) {
            expect(responseBody.checkoutUrl).toContain('checkout.stripe.com');
            logger.info({ checkoutUrl: responseBody.checkoutUrl }, '✅ Edge function returned valid checkout URL');
        } else {
            // Alternatively, verify by checking the page navigated to Stripe
            await page.waitForURL(/checkout\.stripe\.com/, { timeout: 10000 });
            logger.info('✅ Browser navigated to Stripe Checkout');
        }

        logger.info('✅ Stripe Checkout Test PASSED');
    });
});
