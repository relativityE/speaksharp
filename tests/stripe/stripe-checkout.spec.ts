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

    test.beforeEach(async ({ page }) => { // beforeEach is correct for page fixture
        console.log('🚨 Running LIVE Stripe checkout test against real Supabase');
        console.log(`📧 Test user: ${testEmail}`);
        // DIAGNOSTIC: Monitor network for 400 errors
        page.on('response', async response => {
            if (response.url().includes('stripe-checkout')) {
                console.log(`[Network] 📡 Stripe Endpoint Status: ${response.status()}`);
                if (response.status() >= 400) {
                    try {
                        const body = await response.json();
                        console.log('[Network] ❌ Error Body:', JSON.stringify(body, null, 2));

                        // Semantic assertions for negative verification (as per Architecture Review)
                        // We expect this specific error because we are running in CI without SITE_URL
                        // This serves as proof that the code is hitting the right path
                        if (body.error) {
                            expect(body.error).toContain('SITE_URL is missing');
                            expect(body.error).toContain('expected in CI');
                        }
                    } catch {
                        console.log('[Network] ❌ Could not parse error body:', await response.text());
                    }
                }
            }
        });
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
        console.log('✅ Sign-in successful, redirect complete');

        // Step 2: Navigate to analytics
        console.log('[Stripe Test] Step 2: Navigating to analytics...');

        // Forward browser console to test output for debugging
        page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

        await page.goto('/analytics');

        // Both empty state and full dashboard have upgrade button with same testid
        // Both now trigger handleUpgrade which calls stripe-checkout Edge Function
        const upgradeButton = page.getByTestId('analytics-dashboard-upgrade-button');

        // Wait for the upgrade button to be visible (works for both states)
        await upgradeButton.waitFor({ state: 'visible', timeout: 30000 });
        console.log('✅ Analytics page loaded, upgrade button visible');

        // Step 3: Click upgrade and capture Edge Function response
        console.log('[Stripe Test] Step 3: Clicking Upgrade to Pro...');

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
