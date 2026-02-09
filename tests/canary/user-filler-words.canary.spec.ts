import { test, expect } from '@playwright/test';
import { navigateToRoute, canaryLogin } from '../e2e/helpers';
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
        // Use console.warn to ensure logs appear in CI stdout (debugLog is suppressed without E2E_DEBUG)
        const logStep = (step: string) => console.warn(`[${new Date().toISOString()}] [CANARY-STEP] ${step}`);

        test.setTimeout(130000); // Keeping high timeout for debugging, but logging will reveal actual times

        // 1. Real Login
        logStep('Starting Login');
        await canaryLogin(page, CANARY_USER.email, CANARY_USER.password);
        logStep('Login Complete');

        // 2. Navigate to Session
        logStep('Navigating to Session');
        await navigateToRoute(page, ROUTES.SESSION, { waitForMocks: false });
        logStep('Session Page Loaded');

        const settingsBtn = page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn).toBeVisible({ timeout: 15000 });
        await settingsBtn.click();
        logStep('Opened Settings');

        // Add word
        logStep('Adding CanaryBoostTest word');
        await page.getByTestId(TEST_IDS.USER_FILLER_WORDS_INPUT).fill('CanaryBoostTest');

        // Robustness: Wait for the valid network response
        const addWordPromise = page.waitForResponse(response =>
            response.url().includes('/user_filler_words') &&
            response.status() === 201
        );

        await page.getByRole('button', { name: /add word/i }).click();
        await addWordPromise;

        // Optimization: Badge should appear immediately after 201 response
        await expect(page.getByTestId('filler-word-badge').filter({ hasText: /canaryboosttest/i })).toBeVisible({ timeout: 3000 });
        logStep('Word Added & Verified');

        // Close settings
        await page.keyboard.press('Escape');
        await expect(page.getByText('Session Settings')).toBeHidden();
        logStep('Closed Settings');

        // 3. Select Cloud Mode
        logStep('Selecting Cloud Mode');
        const modeSelector = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
        await modeSelector.click();
        await page.getByTestId(TEST_IDS.STT_MODE_CLOUD).click();

        // DEFENSIVE WAIT: Verify mode actually changed
        await expect(modeSelector).toHaveText(/Cloud/i, { timeout: 5000 });
        logStep('Cloud Mode Selected & Verified');

        // 4. Set up WebSocket listener
        logStep('Setting up WebSocket Listener');
        const wsPromise = page.waitForEvent('websocket', {
            predicate: ws => {
                const url = ws.url();
                logStep(`WebSocket Connection Detected: ${url}`);
                return url.includes('streaming.assemblyai.com');
            },
            timeout: 120000
        });
        logStep('WebSocket Listener Ready');

        // 5. Start Session
        logStep('Clicking Start Session');
        const startStopBtn = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        await startStopBtn.click();

        // DEFENSIVE WAIT: Verify recording actually started (Button changes to STOP)
        await expect(startStopBtn).toHaveText(/Stop/i, { timeout: 10000 });
        logStep('Start Session Clicked & Recording Verified');

        // 6. Verify WebSocket
        const ws = await wsPromise;
        logStep('WebSocket Promise Resolved');
        const wsUrl = ws.url();
        console.warn(`[CANARY] 📡 Captured Cloud STT WebSocket: ${wsUrl} `);

        expect(wsUrl).toContain('boost_param');
        const decodedUrl = decodeURIComponent(wsUrl);
        expect(decodedUrl.toLowerCase()).toContain('canaryboosttest');

        logStep('Stopping Session');
        await startStopBtn.click();
        logStep('Test Complete');
    });
});
