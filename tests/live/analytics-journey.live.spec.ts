/**
 * Visual Analytics E2E Test (Real-User Flow)
 * 
 * This test is designed to run against a DEPLOYED environment (Vercel/Production)
 * to verify the exact flow a real user will experience.
 * 
 * ## Prerequisites (Set these before running)
 * 
 * 1. `VISUAL_TEST_EMAIL` - (Optional) Email for the test user. Defaults to a timestamped email.
 * 2. `VISUAL_TEST_PASSWORD` - (Optional) Password for that user. Defaults to a timestamped password.
 * 3. `VISUAL_TEST_USER_TYPE` - (Optional) 'pro' (default) or 'free'. Determines user tier.
 * 4. `VISUAL_TEST_PROMO_CODE` - (Required if USER_TYPE='free') A promo code to unlock Pro features.
 * 5. `VISUAL_TEST_BASE_URL` - (Optional) Base URL to test against (defaults to localhost:5173)
 * 
 * ## How to Run
 * 
 * ```bash
 * VISUAL_TEST_EMAIL=user@example.com \
 * VISUAL_TEST_PASSWORD=your-password \
 * VISUAL_TEST_PROMO_CODE=ABC123 \
 * VISUAL_TEST_BASE_URL=https://speaksharp.vercel.app \
 * npx playwright test tests/e2e/visual-analytics.e2e.spec.ts --project=chromium
 * ```
 */

import { test, expect, Page } from '@playwright/test';
import { navigateToRoute, attachLiveTranscript, verifyCredentialsAndInjectSession } from '../e2e/helpers';
import { TEST_IDS, ROUTES } from '../constants';

// Configuration from environment
// Use soak-test credentials for local E2E testing (same as CI)
// Generate a unique email for each run to ensure fresh provisioning
const TIMESTAMP = Date.now();
const EMAIL = process.env.VISUAL_TEST_EMAIL || `test-user-${TIMESTAMP}@test.com`;
const PASSWORD = process.env.VISUAL_TEST_PASSWORD || `password-${TIMESTAMP}`;
const USER_TYPE = (process.env.VISUAL_TEST_USER_TYPE || 'pro') as 'free' | 'pro';
// TODO: Implement dynamic promo generation for the Free path (requires a new Edge Function or script)
const PROMO_CODE = process.env.VISUAL_TEST_PROMO_CODE; // Only used if USER_TYPE === 'free'
const BASE_URL = process.env.VISUAL_TEST_BASE_URL || 'http://localhost:5173';

test.use({
    video: 'on',
    permissions: ['microphone'],
    viewport: { width: 1280, height: 720 },
    baseURL: BASE_URL,
});

test.describe('Visual Analytics & Private STT (Real-User Flow)', () => {
    test.setTimeout(60000); // Increased timeout for provisioning

    // Dynamic User State
    const testEmail = EMAIL;
    const testPassword = PASSWORD;

    test.beforeAll(async () => {
        const edgeFnUrl = process.env.EDGE_FN_URL;
        const agentSecret = process.env.AGENT_SECRET;

        // Strict Skip: If secrets are missing locally, we cannot run this high-fidelity test.
        if (!agentSecret || agentSecret === 'mock_agent_secret') {
            test.skip(true, 'Skipping Live Analytics: AGENT_SECRET is required for isolated user provisioning.');
            return;
        }

        if (!edgeFnUrl) {
            throw new Error('Spec failed: EDGE_FN_URL is required when AGENT_SECRET is present.');
        }

        console.log(`🔄 Provisioning unique user (${testEmail}) via Edge Function...`);

        // Resilience: Retry provisioning up to 3 times to handle Edge Function cold starts/500s
        let provisionSuccess = false;
        for (let i = 0; i < 3; i++) {
            try {
                const response = await fetch(edgeFnUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${agentSecret}`,
                        'apikey': `${process.env.VITE_SUPABASE_ANON_KEY}`
                    },
                    body: JSON.stringify({
                        email: testEmail,
                        password: testPassword,
                        subscription_status: USER_TYPE
                    })
                });

                const text = await response.text();
                if (response.ok) {
                    console.log(`✅ User provisioned successfully (Attempt ${i + 1}).`);
                    provisionSuccess = true;
                    break;
                } else if (text.includes('already registered')) {
                    console.log('ℹ️ User already exists (assuming valid credentials).');
                    provisionSuccess = true;
                    break;
                } else {
                    console.warn(`⚠️ Provisioning warning (Attempt ${i + 1}, Status ${response.status}): ${text}`);
                    if (response.status >= 500) await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Backoff
                }
            } catch (e) {
                console.warn(`⚠️ Failed to connect to Edge Function (Attempt ${i + 1}): ${e}`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!provisionSuccess) {
            console.error('❌ Provisioning failed after 3 attempts. Aborting test.');
            // Fail the test early rather than timing out later
            throw new Error('User Provisioning Failed');
        }
    });

    test('Full User Journey: Login -> Promo -> Private STT -> Analytics', async ({ page }) => {
        // Only show errors and warnings (set E2E_DEBUG=true for full logs)
        attachLiveTranscript(page);

        // 1. Login (API-based verification & Session Injection)
        await verifyCredentialsAndInjectSession(page, testEmail, testPassword, USER_TYPE);

        // Ensure we are on the main app page
        await expect(page.getByTestId(TEST_IDS.APP_MAIN)).toBeVisible({ timeout: 10000 });


        // 2. Apply Promo Code (only for Free users)
        if (USER_TYPE === 'free' && PROMO_CODE) {
            await navigateToRoute(page, '/', { waitForMocks: false });
            const promoInput = page.getByPlaceholder('Enter promo code');
            const applyBtn = page.getByRole('button', { name: 'Apply' });

            if (await promoInput.isVisible({ timeout: 5000 })) {
                await promoInput.fill(PROMO_CODE);
                await applyBtn.click();
                await expect(page.getByText(/Promo code applied/i)).toBeVisible({ timeout: 10000 });
            }
        }

        // 3. Run Private STT Session
        await runSession(page, 'private', 1);

        // 4. Run Cloud STT Session
        await runSession(page, 'cloud', 2);

        // 5. Verify Analytics
        await navigateToRoute(page, ROUTES.ANALYTICS, { waitForMocks: false });
        await page.waitForTimeout(3000); // Allow data fetch

        const rows = page.getByTestId(new RegExp(`^${TEST_IDS.SESSION_HISTORY_ITEM}`));
        await expect(rows.first()).toBeVisible({ timeout: 10000 });

        // Capture Evidence
        await page.screenshot({ path: 'test-results/visual-verification-final.png', fullPage: true });

        // Assertions
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThanOrEqual(2);
    });
});

async function runSession(page: Page, mode: 'private' | 'cloud' | 'native', index: number): Promise<void> {
    await navigateToRoute(page, ROUTES.SESSION, { waitForMocks: false });
    await page.waitForSelector(`[data-testid="${TEST_IDS.APP_MAIN}"]`, { timeout: 15000 });

    // Select Mode
    const modeTrigger = page.getByRole('button', { name: /native|cloud|private/i });
    const currentMode = await modeTrigger.textContent();
    if (!currentMode?.toLowerCase().includes(mode)) {
        await modeTrigger.click();
        await page.getByRole('menuitemradio', { name: new RegExp(mode, 'i') }).click();
    }

    // Start Recording
    await page.getByTestId('session-start-stop-button').click();

    // Handle Private Model Loading
    if (mode === 'private') {
        await expect(page.getByTestId('session-status-indicator')).toContainText('Recording', { timeout: 30000 });
    } else {
        await expect(page.getByTestId('session-status-indicator')).toContainText('Recording', { timeout: 30000 });
    }

    // Evidence Screenshot
    await page.screenshot({ path: `test-results/session-${index}-${mode}-recording.png` });

    // Record for 5 seconds
    await page.waitForTimeout(5000);

    // Stop Recording
    await page.getByTestId('session-start-stop-button').click();

    // Wait for save
    await page.waitForTimeout(2000);
}
