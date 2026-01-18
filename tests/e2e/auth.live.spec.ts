import { test, expect } from '@playwright/test';
import { goToPublicRoute } from './helpers';

// Skip this test if running against a mock backend

test.describe('Real Authentication Flow', () => {
    // Verify we are running in the Live environment context
    test.beforeAll(() => {
        if (process.env.VITE_USE_LIVE_DB !== 'true') {
            throw new Error('Spec failed: VITE_USE_LIVE_DB=true is required for Live Auth tests.');
        }

        const email = process.env.E2E_FREE_EMAIL;
        const password = process.env.E2E_FREE_PASSWORD;
        if (!email || !password) {
            throw new Error('Spec failed: E2E_FREE_EMAIL and E2E_FREE_PASSWORD are required for Live Auth tests.');
        }
    });

    const testEmail = process.env.E2E_FREE_EMAIL || 'e2e-free-user@test.com';
    const testPassword = process.env.E2E_FREE_PASSWORD || 'TestPassword123!';

    test('should sign in with real credentials and establish session', async ({ page }) => {
        // High-Fidelity AUTH test against real Supabase

        // 1. Navigate to Sign In (public route - uses goToPublicRoute per architecture)
        await goToPublicRoute(page, '/auth/signin');
        await expect(page.getByTestId('auth-form')).toBeVisible();

        // 2. Interact with Real Form
        await page.fill('input[type="email"]', testEmail);
        await page.fill('input[type="password"]', testPassword);

        // 3. Submit
        const loginPromise = page.waitForResponse(response =>
            response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
        );
        await page.click('button[type="submit"]');

        // 4. Verify Network Request (High Fidelity)
        const response = await loginPromise;
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.access_token).toBeDefined();
        expect(body.user).toBeDefined();

        // 5. Verify Redirect and Session State
        await page.waitForURL('/session');
        await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
    });
});
