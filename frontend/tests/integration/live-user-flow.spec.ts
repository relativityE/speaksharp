/**
 * Live User Flow Test
 * 
 * This test runs ONLY in "Real Mode" against the live Supabase instance.
 * It is skipped by default in local/mock environments.
 * 
 * Trigger: Manually via GitHub Actions workflow "Dev Integration (Real Supabase)"
 */

import { test, expect } from '@playwright/test';

// Skip this test unless we're in live mode
test.skip(!process.env.VITE_USE_LIVE_DB, 'Skipping live test in local/mock environment');

test.describe('Live User Flow', () => {
    const email = process.env.E2E_PRO_EMAIL;
    const password = process.env.E2E_PRO_PASSWORD;

    test.beforeAll(() => {
        console.log('🚨 Running LIVE integration test against real Supabase');
        console.log(`📧 Test user: ${email}`);

        if (!email || !password) {
            throw new Error('E2E_PRO_EMAIL and E2E_PRO_PASSWORD must be set for live tests');
        }
    });

    test('should allow existing user to sign in and access dashboard', async ({ page }) => {
        // Navigate to sign-in page
        await page.goto('/sign-in');
        await page.waitForLoadState('domcontentloaded');

        // Fill credentials
        await page.getByTestId('email-input').fill(email!);
        await page.getByTestId('password-input').fill(password!);

        // Submit
        await page.getByTestId('sign-in-button').click();

        // Wait for successful login - redirect to home
        await page.waitForURL('/', { timeout: 15000 });

        // Verify we're authenticated
        await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 10000 });

        console.log('✅ Sign-in successful');

        // Navigate to session page
        await page.goto('/session');
        await expect(page.getByTestId('session-start-stop-button')).toBeVisible({ timeout: 10000 });
        console.log('✅ Session page accessible');

        // Navigate to analytics page
        await page.goto('/analytics');
        await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 10000 });
        console.log('✅ Analytics page accessible');
    });

    test('should display user profile data from real database', async ({ page }) => {
        // Sign in first
        await page.goto('/sign-in');
        await page.getByTestId('email-input').fill(email!);
        await page.getByTestId('password-input').fill(password!);
        await page.getByTestId('sign-in-button').click();
        await page.waitForURL('/', { timeout: 15000 });

        // Navigate to analytics to verify profile loads
        await page.goto('/analytics');

        // Wait for dashboard to load (proves profile fetch worked)
        await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 15000 });

        // Check for Pro badge if user is pro
        const proBadge = page.locator('[data-testid="pro-badge"], :text("Pro")');
        const hasPro = await proBadge.count() > 0;

        if (hasPro) {
            console.log('✅ Pro subscription verified');
        } else {
            console.log('ℹ️ User is on Free plan');
        }
    });
});
