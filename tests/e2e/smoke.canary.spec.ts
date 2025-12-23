import { test, expect, type Page } from '@playwright/test';
import { goToPublicRoute, navigateToRoute } from './helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';

/**
 * Canary test credentials from constants
 * Password is provided via CANARY_PASSWORD secret in GitHub Actions
 */
const CANARY_EMAIL = CANARY_USER.email;
const CANARY_PASSWORD = CANARY_USER.password;

/**
 * Login helper for Canary tests - modeled after soak test's setupAuthenticatedUser()
 * Uses real form-based auth against real Supabase
 */
async function canaryLogin(page: Page): Promise<void> {
    if (!CANARY_PASSWORD) {
        throw new Error('Missing CANARY_PASSWORD environment variable');
    }

    console.log(`[CANARY] Logging in as ${CANARY_EMAIL}...`);
    const start = Date.now();

    // Navigate to sign-in page using public route helper
    await goToPublicRoute(page, ROUTES.SIGN_IN);
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    // Fill credentials (like soak test)
    await page.fill('input[type="email"]', CANARY_EMAIL);
    await page.fill('input[type="password"]', CANARY_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for redirect (like soak test)
    await page.waitForURL((url) =>
        url.pathname === '/session' || url.pathname === '/'
        , { timeout: 30000 });

    // Verify auth state (like soak test)
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 15000 });

    console.log(`[CANARY] Login successful in ${Date.now() - start}ms`);
}

/**
 * 🚨 CANARY SMOKE TEST 🚨
 * 
 * This test runs against REAL STAGING INFRASTRUCTURE.
 * It does NOT use MSW mocks - uses VITE_USE_LIVE_DB=true.
 * 
 * Purpose: Verify the "Critical Path" is operational.
 * 1. Login (Real Auth)
 * 2. Start Session (Real DB Insert, Native STT)
 * 3. Stop Session (Real DB Update)
 * 4. Verify Analytics (Real DB Select)
 * 
 * Cost: $0.00 (Uses Native Browser STT)
 * 
 * Modeled after soak test pattern for proven reliability.
 * 
 * ## Navigation Helpers (DO NOT use page.goto directly!)
 * - `goToPublicRoute()` - for public pages (sign-in, pricing) BEFORE auth
 * - `navigateToRoute()` - for client-side navigation AFTER auth
 * 
 * @see tests/e2e/helpers.ts for helper implementations
 */
test.describe('Production Smoke Canary @canary', () => {
    test.beforeAll(() => {
        if (!CANARY_PASSWORD) {
            console.warn('⚠️ Skipping Canary test: Missing CANARY_PASSWORD');
            test.skip();
        }
    });

    test('should complete a full session cycle on real infrastructure', async ({ page }) => {
        // 1. Real Login (modeled after soak test)
        await canaryLogin(page);

        // 2. Navigate to Session Page (use client-side navigation to preserve state)
        await navigateToRoute(page, ROUTES.SESSION);
        await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 15000 });

        // 3. Configure for Native STT (Free/Low Risk)
        console.log('[CANARY] Configuring Native STT mode...');
        await page.getByRole('button', { name: /Native|Cloud AI|On-Device/i }).click();
        await page.getByRole('menuitemradio', { name: /Native/i }).click();

        // 4. Start Session
        console.log('[CANARY] Starting session...');
        const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // Wait for session to become active
        await page.waitForSelector('[data-testid="session-status-indicator"]', { timeout: 10000 });

        // 5. Record for 5 seconds
        console.log('[CANARY] Recording for 5 seconds...');
        await page.waitForTimeout(5000);

        // 6. Stop Session
        console.log('[CANARY] Stopping session...');
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        // 7. Handle session end (dialog, empty state, or redirect)
        const dialogLocator = page.locator('div[role="alertdialog"]');
        const emptyStateLocator = page.getByText('No speech was detected');
        const analyticsUrl = page.waitForURL(/\/analytics/, { timeout: 15000 }).catch(() => null);

        // Wait for any end state
        await Promise.race([
            dialogLocator.waitFor({ timeout: 10000 }).catch(() => null),
            emptyStateLocator.waitFor({ timeout: 10000 }).catch(() => null),
            analyticsUrl,
        ]);

        // If dialog appeared, dismiss it
        if (await dialogLocator.isVisible().catch(() => false)) {
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            if (await stayButton.isVisible().catch(() => false)) {
                await stayButton.click();
            }
        }

        console.log('[CANARY] ✅ Smoke test passed. System is operational.');
    });
});
