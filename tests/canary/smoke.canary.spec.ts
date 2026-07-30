import { test, expect, type Page } from '@playwright/test';
import { navigateToRoute, debugLog, canaryLogin } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';

async function selectNativeMode(page: Page) {
    const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);

    if (await modeSelect.isVisible()) {
        if ((await modeSelect.getAttribute('data-state')) !== 'native') {
            await modeSelect.evaluate((el: HTMLElement) => {
                el.scrollIntoView({ block: 'center', inline: 'center' });
                el.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    pointerType: 'mouse',
                    button: 0,
                }));
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
            });

            const nativeByTestId = page.getByTestId(TEST_IDS.STT_MODE_NATIVE);
            const nativeByRole = page.getByRole('menuitemradio', { name: /Native/i });
            const nativeOption = (await nativeByTestId.isVisible({ timeout: 3000 }).catch(() => false))
                ? nativeByTestId
                : nativeByRole;

            await nativeOption.click({ timeout: 5000 });
        }

        await expect(modeSelect).toHaveAttribute('data-state', 'native', { timeout: 5000 });
        await expect(page.locator('body')).toHaveAttribute('data-stt-policy', 'native', { timeout: 5000 });
        return;
    }

    // High-fidelity fallback for legacy UI.
    await page.getByRole('button', { name: /Native|Cloud AI|Private|On-Device/i }).click();
    await page.getByRole('menuitemradio', { name: /Native/i }).click();
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
        // Dynamic skip if password is missing (Local Run)
        test.skip(!CANARY_USER.password, 'Skipping Canary test: Missing CANARY_PASSWORD');
    });

    test('should complete a full session cycle on real infrastructure', async ({ page }) => {
        // Capture the SERVER entitlement response (also recorded in the trace's network log) so the
        // affordance assertion below matches the account's ACTUAL state — post-#1047 there is no fixed
        // tier badge; a Free account's affordance depends on its live Private-sample state.
        let usageBody: {
            subscription_status?: string; is_pro?: boolean; can_start?: boolean;
            private_sample_available?: boolean; private_sample_seconds_remaining?: number;
            private_sample_limit_seconds?: number;
        } | null = null;
        page.on('response', async (r) => {
            if (r.url().includes('check-usage-limit') && r.status() === 200) {
                try { usageBody = await r.json(); } catch { /* ignore non-JSON */ }
            }
        });

        // 1. Real Login (modeled after soak test)
        await canaryLogin(page, CANARY_USER.email, CANARY_USER.password);

        // 2. Navigate to Session Page (use client-side navigation to preserve state)
        await navigateToRoute(page, ROUTES.SESSION, { waitForMocks: false });

        // 🔹 SCHEMA CHECK: User Profile
        // Verify that the profile loaded correctly and reflects the subscription status
        // This implicitly validates the 'user_profiles' table schema
        await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 15000 });

        // 🔹 ENTITLEMENT + AFFORDANCE CHECK (post-#1047, replaces the stale tier-affordance selectors).
        // The old check asserted PRIVATE_SAMPLE_SETUP_BUTTON / "Private sample: up to 5 minutes" — both
        // removed/relocated by #1047/#1094, which is why the canary failed (#1100). We now read the live
        // server entitlement and assert the affordance that MATCHES that account state.
        await expect.poll(() => usageBody, {
            message: 'check-usage-limit response never arrived',
            timeout: 15000,
            intervals: [500, 1000, 2000, 3000],
        }).not.toBeNull();
        const u = usageBody as NonNullable<typeof usageBody>;
        // Attach the entitlement fields to the report/trace as first-class evidence (non-PII).
        await test.info().attach('check-usage-limit-entitlement', {
            contentType: 'application/json',
            body: JSON.stringify({
                subscription_status: u.subscription_status, is_pro: u.is_pro, can_start: u.can_start,
                private_sample_available: u.private_sample_available,
                private_sample_seconds_remaining: u.private_sample_seconds_remaining,
                private_sample_limit_seconds: u.private_sample_limit_seconds,
            }, null, 2),
        });

        const nudge = page.getByTestId('private-trial-nudge');
        const remaining = u.private_sample_seconds_remaining ?? 0;
        if (u.is_pro) {
            // Pro → the Pro badge; the Free→Private trial nudge must NOT appear.
            await expect(page.getByTestId(TEST_IDS.PRO_BADGE)).toBeVisible({ timeout: 15000 });
            await expect(nudge).toHaveCount(0);
        } else if (u.private_sample_available && remaining > 0) {
            // Free with an AVAILABLE sample → the idle Browser session offers the Private trial nudge.
            await expect(nudge).toBeVisible({ timeout: 15000 });
            await expect(nudge).toContainText(/Private/i);
        } else {
            // Free with an EXHAUSTED / unavailable sample → NO trial nudge, and the session is still
            // functional on Browser (the truthful "no fallback surprise" state). `can_start` stays true
            // because Browser transcription is always available to a Free account.
            await expect(nudge).toHaveCount(0);
            expect(u.can_start, 'Free Browser recording must remain available when the sample is exhausted').toBe(true);
            await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeEnabled();
        }

        // 3. Configure for Native STT (Free/Low Risk)
        debugLog('[CANARY] Configuring Native STT mode...');
        await selectNativeMode(page);

        // 4. Start Session
        debugLog('[CANARY] Starting session...');
        const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // Wait for session to become active
        await page.waitForSelector('[data-testid="session-status-indicator"]', { timeout: 10000 });

        // 5. Record for 5 seconds
        debugLog('[CANARY] Recording for 5 seconds...');
        await page.waitForTimeout(5000);

        // 6. Stop Session
        debugLog('[CANARY] Stopping session...');
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

        // If we reached analytics, perform SCHEMA CHECK on Sessions
        if (page.url().includes('/analytics')) {
            debugLog('[CANARY] 🔍 Validating Sessions Schema...');
            // Intercept the next list fetch to validate fields
            const sessionResponsePromise = page.waitForResponse(res =>
                res.url().includes('/rest/v1/sessions') && res.status() === 200
            );

            // Force a reload or wait for data
            await page.reload();
            const response = await sessionResponsePromise;
            const sessions = await response.json();

            if (Array.isArray(sessions) && sessions.length > 0) {
                const latestSession = sessions[0];
                const requiredFields = ['id', 'user_id', 'total_words', 'duration', 'created_at', 'engine'];
                for (const field of requiredFields) {
                    expect(latestSession[field], `Schema Valid: Session missing ${field}`).toBeDefined();
                }
                debugLog('[CANARY] ✅ Sessions Schema Valid');
            }
        }

        // If dialog appeared, dismiss it
        if (await dialogLocator.isVisible().catch(() => false)) {
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            if (await stayButton.isVisible().catch(() => false)) {
                await stayButton.click();
            }
        }

        debugLog('[CANARY] ✅ Smoke test passed. System is operational.');
    });
});
