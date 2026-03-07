import { test, expect } from '@playwright/test';
import { verifyCredentialsAndInjectSession, navigateToRoute } from '../e2e/helpers';
import { ROUTES } from '../constants';

const TIMESTAMP = Date.now();
const EMAIL = process.env.VISUAL_TEST_EMAIL || `test-accuracy-${TIMESTAMP}@test.com`;
const PASSWORD = process.env.VISUAL_TEST_PASSWORD || `password-${TIMESTAMP}`;
const USER_TYPE = 'pro';

test.describe('STT Accuracy vs Benchmark Live Integration', () => {

    test.beforeAll(async () => {
        const edgeFnUrl = process.env.EDGE_FN_URL;
        const agentSecret = process.env.AGENT_SECRET;

        if (!agentSecret || agentSecret === 'mock_agent_secret') {
            test.skip(true, 'Skipping Live Analytics: AGENT_SECRET is required for isolated user provisioning.');
            return;
        }

        if (!edgeFnUrl) {
            throw new Error('Spec failed: EDGE_FN_URL is required when AGENT_SECRET is present.');
        }

        console.log(`🔄 Provisioning unique user (${EMAIL}) for Accuracy Test...`);

        const response = await fetch(edgeFnUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${agentSecret}`,
                'apikey': `${process.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
                email: EMAIL,
                password: PASSWORD,
                subscription_status: USER_TYPE
            })
        });

        if (!response.ok) {
            const err = await response.text();
            if (!err.includes('already registered')) {
                throw new Error('User Provisioning Failed');
            }
        }
    });

    test('should track engine to DB and render ceiling benchmarks', async ({ page }) => {
        // 1. Login
        await verifyCredentialsAndInjectSession(page, EMAIL, PASSWORD, USER_TYPE);

        // 2. Perform a recording session to trigger DB save with engine field
        await navigateToRoute(page, ROUTES.SESSION, { waitForMocks: false });

        // Select Private Mode
        const modeTrigger = page.getByRole('button', { name: /native|cloud|private/i });
        const currentMode = await modeTrigger.textContent();
        if (!currentMode?.toLowerCase().includes('private')) {
            await modeTrigger.click();
            await page.getByRole('menuitemradio', { name: /private/i }).click();
        }

        // Start Recording
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByTestId('session-status-indicator')).toContainText('Recording', { timeout: 30000 });
        await page.waitForTimeout(5000);

        // Stop Recording and trigger DB Save
        await page.getByTestId('session-start-stop-button').click();
        await page.waitForTimeout(3000);

        // 3. Navigate to Analytics
        await navigateToRoute(page, ROUTES.ANALYTICS, { waitForMocks: false });

        // Find the newly created session in the history table
        const sessionRow = page.getByTestId(/session-history-item-/).first();
        await expect(sessionRow).toBeVisible({ timeout: 10000 });

        // Click into the session detail view
        await sessionRow.click();

        // 4. Verify the Accuracy Vs Benchmark component renders
        await expect(page.getByText('STT Accuracy vs Benchmark')).toBeVisible();

        // Check if the specific session view rendered
        await expect(page.getByText(/Session Accuracy vs/)).toBeVisible();
        await expect(page.getByText(/This session used the/)).toBeVisible();

        // Capture evidence
        await page.screenshot({ path: 'test-results/stt-accuracy-benchmark-evidence.png' });
    });
});
