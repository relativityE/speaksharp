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
 * 3. Verifies redirect to Stripe checkout
 * 
 * Prerequisites:
 * 1. Run "Setup Test Users" workflow first with user_type=free
 * 2. Add E2E_FREE_EMAIL and E2E_FREE_PASSWORD as GitHub secrets
 * 3. STRIPE_PRO_PRICE_ID must be set in Supabase Edge Function secrets
 */

import { test, expect } from '@playwright/test';

// Skip this test unless we're in live mode (not using mock.supabase.co)
const isMockSupabase = !process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL.includes('mock.supabase.co');
test.skip(isMockSupabase, 'Skipping Stripe test in mock environment');

test.describe('Stripe Checkout Flow', () => {
    // Use FREE user credentials from GitHub secrets (set by setup-test-users workflow)
    const testEmail = process.env.E2E_FREE_EMAIL || 'e2e-free-user@test.com';
    const testPassword = process.env.E2E_FREE_PASSWORD || 'TestPassword123!';

    test.beforeAll(() => {
        console.log('🚨 Running LIVE Stripe checkout test against real Supabase');
        console.log(`📧 Test user: ${testEmail}`);

        if (!process.env.E2E_FREE_EMAIL) {
            console.warn('⚠️ E2E_FREE_EMAIL not set - using default. Run setup-test-users workflow first!');
        }
    });

    test('should sign in and initiate Stripe checkout', async ({ page }) => {
        // Step 1: Sign in with FREE user
        console.log('[Stripe Test] Step 1: Signing in...');
        await page.goto('/auth/signin');
        await page.waitForSelector('[data-testid="auth-form"]', { timeout: 10000 });

        await page.fill('input[type="email"]', testEmail);
        await page.fill('input[type="password"]', testPassword);
        await page.click('button[type="submit"]');

        // Wait for successful login - redirect to session page
        await page.waitForURL('/session', { timeout: 15000 });
        await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 10000 });
        console.log('✅ Sign-in successful');

        // Step 2: Navigate to analytics page (where the Upgrade banner is)
        console.log('[Stripe Test] Step 2: Navigating to analytics...');
        await page.goto('/analytics');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByTestId('analytics-dashboard-upgrade-button')).toBeVisible({ timeout: 15000 });
        console.log('✅ Navigated to analytics page, upgrade banner visible');

        // Step 3: Click "Upgrade Now" button on the dashboard
        console.log('[Stripe Test] Step 3: Clicking Upgrade Now...');
        const upgradeButton = page.getByRole('button', { name: /upgrade now/i });
        await expect(upgradeButton).toBeVisible({ timeout: 10000 });

        // Listen for Edge Function response
        const responsePromise = page.waitForResponse(
            resp => resp.url().includes('stripe-checkout'),
            { timeout: 15000 }
        );

        await upgradeButton.click();

        // Step 4: Verify Stripe redirect
        console.log('[Stripe Test] Step 4: Verifying Stripe redirect...');

        // Wait for edge function response 
        const response = await responsePromise;

        // Wait for redirect to Stripe checkout (event-driven, no arbitrary timeout)
        try {
            await page.waitForURL(/checkout\.stripe\.com/, { timeout: 10000 });
            console.log('✅ Successfully redirected to Stripe checkout');
            console.log(`📍 Checkout URL: ${page.url()}`);
        } catch {
            // If no redirect, check edge function response for checkout URL
            const responseBody = await response.json().catch(() => null);

            if (responseBody?.checkoutUrl) {
                console.log('✅ Edge function returned checkout URL:', responseBody.checkoutUrl);
                expect(responseBody.checkoutUrl).toContain('checkout.stripe.com');
            } else if (responseBody?.error) {
                console.error('❌ Edge function error:', responseBody.error);
                throw new Error(`Stripe checkout failed: ${responseBody.error}`);
            } else {
                console.error('❌ Unexpected response:', responseBody);
                throw new Error('Stripe checkout failed - no checkout URL returned');
            }
        }

        console.log('✅ Stripe Checkout Test PASSED');
    });
});

