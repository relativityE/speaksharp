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

import { test, expect } from '@playwright/test';

// Skip this test unless we're in live mode (not using mock.supabase.co)
const isMockSupabase = !process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL.includes('mock.supabase.co');
test.skip(isMockSupabase, 'Skipping Stripe test in mock environment');

test.describe('Stripe Checkout Flow', () => {
    const testEmail = process.env.E2E_FREE_EMAIL || 'e2e-free-user@test.com';
    const testPassword = process.env.E2E_FREE_PASSWORD || 'TestPassword123!';

    test.beforeAll(() => {
        console.log('🚨 Running LIVE Stripe checkout test against real Supabase');
        console.log(`📧 Test user: ${testEmail}`);
    });

    test('should sign in and verify Stripe checkout Edge Function', async ({ page }) => {
        // Step 1: Sign in
        console.log('[Stripe Test] Step 1: Signing in...');
        await page.goto('/auth/signin');
        await page.getByTestId('auth-form').waitFor();

        await page.fill('input[type="email"]', testEmail);
        await page.fill('input[type="password"]', testPassword);
        await page.click('button[type="submit"]');

        await page.waitForURL('/session');
        await page.waitForURL('/session');
        console.log('✅ Sign-in successful, redirect complete');

        // Step 2: Navigate to analytics
        console.log('[Stripe Test] Step 2: Navigating to analytics...');

        // Forward browser console to test output for debugging
        page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

        await page.goto('/analytics');

        // Diagnostic: Check what's rendering
        const hasSpinner = await page.locator('.animate-spin').isVisible();
        const hasDashboard = await page.getByTestId('analytics-dashboard').isVisible();
        console.log(`[Stripe Test] Page state: spinner=${hasSpinner}, dashboard=${hasDashboard}`);

        // Wait for loading to complete (spinner disappears)
        if (hasSpinner) {
            console.log('[Stripe Test] ⏳ Waiting for loading spinner to disappear...');
            await page.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 30000 });
            console.log('[Stripe Test] ✅ Loading complete');
        }

        await expect(page.getByTestId('analytics-dashboard-upgrade-button')).toBeVisible();
        console.log('✅ Analytics page loaded, upgrade banner visible');

        // Step 3: Click upgrade and capture Edge Function response
        console.log('[Stripe Test] Step 3: Clicking Upgrade Now...');
        const upgradeButton = page.getByRole('button', { name: /upgrade now/i });

        // Set up response listener BEFORE clicking
        const responsePromise = page.waitForResponse(
            resp => resp.url().includes('stripe-checkout')
        );

        await upgradeButton.click();

        // Step 4: Verify Edge Function response
        console.log('[Stripe Test] Step 4: Verifying Edge Function response...');
        const response = await responsePromise;
        const responseBody = await response.json();

        // Assert the Edge Function returned a valid Stripe checkout URL
        expect(response.status()).toBe(200);
        expect(responseBody.checkoutUrl).toBeDefined();
        expect(responseBody.checkoutUrl).toContain('checkout.stripe.com');

        console.log('✅ Edge function returned valid checkout URL:', responseBody.checkoutUrl);
        console.log('✅ Stripe Checkout Test PASSED');
    });
});
