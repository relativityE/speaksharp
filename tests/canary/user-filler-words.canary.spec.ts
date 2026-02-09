import { test, expect } from '@playwright/test';
import { navigateToRoute, canaryLogin, debugLog } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';

/**
 * 🚨 CANARY USER FILLER WORDS TESTS 🚨
 * 
 * These tests run against REAL STAGING INFRASTRUCTURE.
 * Uses real Supabase and real AssemblyAI Cloud STT.
 */
test.describe('User Filler Words Canary @canary', () => {
    test.beforeAll(() => {
        // Dynamic skip if password is missing (Local Run)
        test.skip(!CANARY_USER.password, 'Skipping Canary test: Missing CANARY_PASSWORD');
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
        await canaryLogin(page, CANARY_USER.email, CANARY_USER.password);

        // 2. Navigate to Session and add custom word
        await navigateToRoute(page, ROUTES.SESSION, { waitForMocks: false });
        const settingsBtn = page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn).toBeVisible({ timeout: 15000 });
        await settingsBtn.click();

        // Updated placeholder and button names for "User Filler Words"
        await page.getByTestId(TEST_IDS.USER_FILLER_WORDS_INPUT).fill('CanaryBoostTest');
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
        debugLog(`[CANARY] 📡 Captured Cloud STT WebSocket: ${wsUrl} `);

        // 7. Verify word_boost (boost_param) is present
        expect(wsUrl).toContain('boost_param');
        const decodedUrl = decodeURIComponent(wsUrl);
        expect(decodedUrl.toLowerCase()).toContain('canaryboosttest');

        debugLog('[CANARY] ✅ User Filler Words verified in Cloud STT request');

        // Cleanup - stop session
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
    });
});
