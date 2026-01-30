import { test, expect, type Page } from '@playwright/test';
import { goToPublicRoute, navigateToRoute, debugLog } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';

/**
 * ⚠️ CANARY TESTS - CI/STAGING ONLY ⚠️
 * 
 * These tests require CANARY_PASSWORD from GitHub Secrets.
 * DO NOT attempt to run locally - they will always fail without the secret.
 * 
 * Purpose: Validate against REAL production Supabase + AssemblyAI
 * Runs in: GitHub Actions (automated on PR/merge)
 * 
 * For local testing, use:
 * - Mock E2E: `pnpm test:e2e` (tests/e2e/user-filler-words.e2e.spec.ts)
 * - Integration: `pnpm test` (frontend/tests/integration/)
 * - Unit: `pnpm test` (frontend/src tests)
 */

/**
 * Canary test credentials from constants
 * Password is provided via CANARY_PASSWORD secret in GitHub Actions
 */
const CANARY_EMAIL = CANARY_USER.email;
const CANARY_PASSWORD = CANARY_USER.password;

/**
 * Login helper for Canary tests - uses real form-based auth against real Supabase
 */
async function canaryLogin(page: Page): Promise<void> {
    if (!CANARY_PASSWORD) {
        test.skip(true, 'Missing CANARY_PASSWORD environment variable - skipping filler words canary');
        return;
    }

    debugLog(`[CANARY] Logging in as ${CANARY_EMAIL}...`);
    const start = Date.now();

    await goToPublicRoute(page, ROUTES.SIGN_IN);

    // Wait for React hydration and auth loading state to complete
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="email-input"]', { timeout: 30000 });

    await page.getByTestId('email-input').fill(CANARY_EMAIL);
    await page.getByTestId('password-input').fill(CANARY_PASSWORD);
    await page.getByTestId('sign-in-submit').click();

    await page.waitForURL((url) =>
        url.pathname === '/session' || url.pathname === '/'
        , { timeout: 30000 });

    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 15000 });

    debugLog(`[CANARY] Login successful in ${Date.now() - start}ms`);
}

/**
 * 🚨 CANARY USER FILLER WORDS TESTS 🚨
 * 
 * These tests run against REAL STAGING INFRASTRUCTURE.
 * Uses real Supabase and real AssemblyAI Cloud STT.
 */
test.describe('User Filler Words Canary @canary', () => {
    test.beforeAll(() => {
        if (!CANARY_PASSWORD) {
            console.warn('⚠️ Skipping Canary test: Missing CANARY_PASSWORD');
        }
    });

    // UI tests for adding/removing words are covered in tests/e2e/user-filler-words.e2e.spec.ts (Mocks)
    // This file focuses on High Fidelity integration with real Cloud STT.

    /**
     * HIGH-FIDELITY TEST: Verify custom words are passed to Cloud STT.
     * 
     * Tests that custom vocabulary is correctly sent to AssemblyAI via word_boost param.
     */
    test('should pass custom words to Cloud STT engine (High Fidelity)', async ({ page }) => {
        // 1. Real Login
        await canaryLogin(page);

        // 2. Navigate to Session and add custom word
        await navigateToRoute(page, ROUTES.SESSION);
        const settingsBtn = page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn).toBeVisible({ timeout: 15000 });
        await settingsBtn.click();

        // Updated placeholder and button names for "User Filler Words"
        await page.getByPlaceholder('e.g., literally, basic').fill('CanaryBoostTest');
        await page.getByRole('button', { name: /add word/i }).click();
        await expect(page.getByText(/canaryboosttest/i)).toBeVisible();

        // Close settings sheet
        await page.keyboard.press('Escape');
        await expect(page.getByText('Session Settings')).toBeHidden();

        // 3. Select Cloud Mode
        debugLog('[CANARY] Selecting Cloud STT mode...');
        await page.getByRole('button', { name: /Native|Cloud AI|Private|On-Device/i }).click();
        await page.getByRole('menuitemradio', { name: /Cloud/i }).click();

        // 4. Set up WebSocket listener BEFORE starting session
        const wsPromise = page.waitForEvent('websocket', ws => {
            const url = ws.url();
            return url.includes('streaming.assemblyai.com');
        });

        // 5. Start Session
        debugLog('[CANARY] Starting Cloud STT session...');
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        // 6. Verify WebSocket was opened to AssemblyAI
        const ws = await wsPromise;
        const wsUrl = ws.url();
        debugLog(`[CANARY] 📡 Captured Cloud STT WebSocket: ${wsUrl}`);

        // 7. Verify word_boost (boost_param) is present
        expect(wsUrl).toContain('boost_param');
        const decodedUrl = decodeURIComponent(wsUrl);
        expect(decodedUrl.toLowerCase()).toContain('canaryboosttest');

        debugLog('[CANARY] ✅ User Filler Words verified in Cloud STT request');

        // Cleanup - stop session
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
    });
});
