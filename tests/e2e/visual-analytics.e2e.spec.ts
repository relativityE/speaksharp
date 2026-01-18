/**
 * Visual Analytics E2E Test (Real-User Flow)
 * 
 * This test is designed to run against a DEPLOYED environment (Vercel/Production)
 * to verify the exact flow a real user will experience.
 * 
 * ## Prerequisites (Set these before running)
 * 
 * 1. `VISUAL_TEST_EMAIL` - Email of a pre-created Free user
 * 2. `VISUAL_TEST_PASSWORD` - Password for that user
 * 3. `VISUAL_TEST_PROMO_CODE` - A pre-generated promo code (use `npx tsx scripts/generate-promo.ts`)
 * 4. `VISUAL_TEST_BASE_URL` (optional) - Base URL to test against (defaults to localhost:5173)
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
import { navigateToRoute, goToPublicRoute, attachLiveTranscript } from './helpers';

// Configuration from environment
// Use soak-test credentials for local E2E testing (same as CI)
const EMAIL = process.env.VISUAL_TEST_EMAIL || 'promo-fix-test-1@test.com';
const PASSWORD = process.env.VISUAL_TEST_PASSWORD || 'test-password';
const PROMO_CODE = process.env.VISUAL_TEST_PROMO_CODE;
const BASE_URL = process.env.VISUAL_TEST_BASE_URL || 'http://localhost:5173';

test.use({
    video: 'on',
    permissions: ['microphone'],
    viewport: { width: 1280, height: 720 },
    baseURL: BASE_URL,
});

test.describe('Visual Analytics & Private STT (Real-User Flow)', () => {
    test.setTimeout(60000); // Increased timeout for provisioning

    test.beforeAll(async () => {
        console.log(`📧 Using test user: ${EMAIL}`);
        if (!PROMO_CODE) {
            console.warn('⚠️  VISUAL_TEST_PROMO_CODE not set. Promo step will be skipped.');
        }

        const edgeFnUrl = process.env.EDGE_FN_URL;
        const agentSecret = process.env.AGENT_SECRET;

        if (edgeFnUrl && agentSecret) {
            console.log('🔄 Provisioning user via Edge Function...');
            try {
                const response = await fetch(edgeFnUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        // Note: User's code expects agent_secret in BODY, but let's send header too if standard auth used
                    },
                    body: JSON.stringify({
                        username: EMAIL,
                        password: PASSWORD,
                        agent_secret: agentSecret
                    })
                });

                const text = await response.text();
                // Check success or "already registered"
                if (response.ok) {
                    console.log('✅ User provisioned successfully.');
                } else if (text.includes('already registered')) {
                    console.log('ℹ️ User already exists (assuming valid credentials).');
                } else {
                    console.warn(`⚠️ Provisioning warning (Status ${response.status}): ${text}`);
                }
            } catch (e) {
                console.warn('❌ Failed to connect to Edge Function for provisioning:', e);
            }
        } else {
            console.log('ℹ️ Skipped Edge Function provisioning (missing EDGE_FN_URL or AGENT_SECRET).');
            /**
             * LOCAL DEV: Skip this test if credentials are missing to prevents failing on "Mock" environment.
             * CI: Secrets are provided, so this block is skipped and test runs.
             */
            test.skip(true, 'Skipping Visual Analytics test; missing Edge Function secrets (Local Run).');
        }
    });

    test('Full User Journey: Login -> Promo -> Private STT -> Analytics', async ({ page }) => {
        // Only show errors and warnings (set E2E_DEBUG=true for full logs)
        attachLiveTranscript(page);

        // 1. Login
        await goToPublicRoute(page, '/auth/signin');
        await expect(page.getByTestId('email-input')).toBeVisible({ timeout: 30000 });

        await page.getByTestId('email-input').fill(EMAIL!);
        await page.getByTestId('password-input').fill(PASSWORD!);
        await page.getByTestId('sign-in-submit').click();

        // Wait for redirect to home/session
        await page.waitForURL('/', { timeout: 30000 });
        await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 10000 });

        // 2. Apply Promo Code (if provided)
        if (PROMO_CODE) {
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
        await navigateToRoute(page, '/analytics', { waitForMocks: false });
        await page.waitForTimeout(3000); // Allow data fetch

        const rows = page.getByTestId('session-history-row');
        await expect(rows.first()).toBeVisible({ timeout: 10000 });

        // Capture Evidence
        await page.screenshot({ path: 'test-results/visual-verification-final.png', fullPage: true });

        // Assertions
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThanOrEqual(2);
    });
});

async function runSession(page: Page, mode: 'private' | 'cloud' | 'native', index: number): Promise<void> {
    await navigateToRoute(page, '/session', { waitForMocks: false });
    await page.waitForSelector('[data-testid="live-recording-card"]', { timeout: 15000 });

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
