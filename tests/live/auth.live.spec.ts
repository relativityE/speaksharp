import { test, expect } from '@playwright/test';
import { goToPublicRoute } from '../e2e/helpers';
import { TEST_IDS, ROUTES } from '../constants';

// Skip this test if running against a mock backend

test.describe('Real Authentication Flow', () => {
    // Verify we are running in the Live environment context
    test.beforeAll(() => {
        if (process.env.VITE_USE_LIVE_DB !== 'true') {
            console.warn('⚠️ Skipping Live Auth test: VITE_USE_LIVE_DB=true is not set.');
            test.skip();
            return;
        }

        const email = process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL;
        const password = process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD;
        if (!email || !password) {
            throw new Error('Spec failed: FREE_TEST_EMAIL/FREE_TEST_PASSWORD are required for Live Auth tests.');
        }
    });

    // Fail CLOSED on missing credentials. Previously these were `string | undefined` and were filled
    // straight into the form, so an unset env produced a confusing empty-field UI failure instead of
    // naming the real cause. Reason only — never the value.
    const requireEnv = (name: string, value: string | undefined): string => {
        if (!value) throw new Error(`missing required credential env: ${name}`);
        return value;
    };
    const testEmail = requireEnv('FREE_TEST_EMAIL|E2E_FREE_EMAIL', process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL);
    const testPassword = requireEnv('FREE_TEST_PASSWORD|E2E_FREE_PASSWORD', process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD);

    test('should sign in with real credentials and establish session', async ({ page }) => {
        // High-Fidelity AUTH test against real Supabase

        // 1. Navigate to Sign In (public route - uses goToPublicRoute per architecture)
        await goToPublicRoute(page, ROUTES.SIGN_IN);
        await page.waitForSelector(`[data-testid="${TEST_IDS.AUTH_FORM}"]`, { timeout: 15000 });

        // 2. Interact with Real Form
        await page.getByTestId(TEST_IDS.EMAIL_INPUT).fill(testEmail);
        await page.getByTestId(TEST_IDS.PASSWORD_INPUT).fill(testPassword);

        // 3. Submit
        const loginPromise = page.waitForResponse(response =>
            response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
        );
        await page.getByTestId(TEST_IDS.SIGN_IN_SUBMIT).click();

        // 4. Verify Network Request (High Fidelity)
        const response = await loginPromise;
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.access_token).toBeDefined();
        expect(body.user).toBeDefined();

        // 5. Verify Redirect and Session State
        await page.waitForURL(ROUTES.SESSION);

        // 🚨 HYDRATION GUARD 🚨
        await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible({ timeout: 15000 });
    });
});
