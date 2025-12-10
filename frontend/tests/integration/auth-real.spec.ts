import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * Integration Test for Real Supabase Authentication
 * 
 * This test attempts to perform actual authentication flows (Sign Up, Sign In)
 * to verify the UI interacts correctly with the backend (or mock, depending on env).
 * 
 * Note: This test assumes the environment variables E2E_FREE_EMAIL and E2E_FREE_PASSWORD
 * are set if running against a real backend, or appropriate mocks are in place.
 * 
 * IMPORTANT: This test is intended for RELEASE TESTING against a real backend (Staging/Prod).
 * It validates that the application correctly integrates with the actual Supabase service.
 * It is SKIPPED by default in local/PR workflows to avoid dependency on production secrets.
 */
const isMockSupabase = !process.env.SUPABASE_URL || process.env.SUPABASE_URL.includes('mock.supabase.co');

test.describe('Supabase Integration: Auth Flows', () => {
    // Skip all tests in this describe block when using mock Supabase
    test.skip(isMockSupabase, 'Skipping real Supabase tests - running with mock environment');

    // Test 1: Create a new user (Sign Up)
    test('should allow a new user to sign up', async ({ page }) => {
        const uniqueId = randomUUID().substring(0, 8);
        const email = `e2e-test-${uniqueId}@example.com`;
        const password = 'TestPassword123!';

        console.log(`[E2E] Attempting Sign Up with: ${email}`);

        await page.goto('/auth/signup');

        // Explicitly wait for form to prevent hydration mismatches
        await page.waitForSelector('[data-testid="auth-form"]');

        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);

        // Submit
        await page.click('button[type="submit"]');

        // Verification
        // Expect EITHER a redirect to dashboard (if auto-confirm/login works)
        // OR a success message "Check your email"
        try {
            // Check for success message first (common in Supabase requiring confirmation)
            const successMessage = page.getByText(/check your email/i);
            const dashboard = page.getByTestId('dashboard-heading');

            // Wait for either
            await Promise.race([
                successMessage.waitFor({ state: 'visible', timeout: 10000 }),
                dashboard.waitFor({ state: 'visible', timeout: 10000 })
            ]);

            // If we got here, one of them appeared. Pass.
            console.log('[E2E] Sign Up flow completed successfully (message or redirect)');
        } catch {
            // Clean fail with screenshot
            await page.screenshot({ path: `test-results/signup-fail-${uniqueId}.png` });
            throw new Error('Sign Up failed: Neither success message nor dashboard appeared.');
        }
    });

    // Test 2: Login with existing credentials
    test('should allow an existing user to sign in', async ({ page }) => {
        // These should be loaded from .env.test
        const email = process.env.E2E_FREE_EMAIL || 'test@example.com';
        const password = process.env.E2E_FREE_PASSWORD || 'password';

        if (!process.env.E2E_FREE_EMAIL && !process.env.CI) {
            console.warn('⚠️ E2E_FREE_EMAIL not set, defaulting to test@example.com. Test might fail if user does not exist.');
        }

        console.log(`[E2E] Attempting Sign In with: ${email}`);

        await page.goto('/auth/signin');
        await page.waitForSelector('[data-testid="auth-form"]');

        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);

        await page.click('button[type="submit"]');

        // Verification: Should arrive at dashboard
        await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

        // Optional: Verify "Free Plan" or "Pro Plan" banner exists to confirm data loading
        // This confirms Supabase data fetching worked too
        const banner = page.locator('text=Plan'); // "Free Plan" or "Pro Plan"
        await expect(banner).toBeVisible({ timeout: 10000 }).catch(() => {
            console.warn('Authentication successful, but Plan banner not found (maybe data fetch failed?)');
        });

        console.log('[E2E] Sign In flow completed successfully');
    });

});
