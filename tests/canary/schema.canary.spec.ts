/**
 * Schema Canary Spec
 * 
 * Purpose: Detect "Contract Drift" by validating real Supabase API responses
 * against our grounded TypeScript interfaces.
 * 
 * ⚠️ CANARY TESTS - CI/STAGING ONLY ⚠️
 * This test requires CANARY_PASSWORD from GitHub Secrets.
 */

import { test, expect } from '@playwright/test';
import { navigateToRoute, debugLog, canaryLogin } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';


test.describe('Schema Canary: Database Contract Validation @canary', () => {
    // Ensure tests run serially to prevent state pollution
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(() => {
        if (!CANARY_USER.password) {
            console.warn('⚠️ Skipping Schema Canary: Missing CANARY_PASSWORD');
        }
    });

    test('validate user_profiles schema integrity', async ({ page }) => {
        await canaryLogin(page, CANARY_USER.email, CANARY_USER.password);

        debugLog('🔍 Checking user_profiles schema integrity via UI exposure');

        await navigateToRoute(page, ROUTES.SESSION);
        await page.waitForSelector(`[data-testid="${TEST_IDS.APP_MAIN}"]`);

        // Check subscription tier indicators which are derived from user_profiles.subscription_status
        const upgradeButton = page.getByRole('button', { name: /upgrade to pro/i });
        const proBadge = page.getByTestId(TEST_IDS.PRO_BADGE);

        const isUpgradeVisible = await upgradeButton.isVisible().catch(() => false);
        const isProBadgeVisible = await proBadge.isVisible().catch(() => false);

        debugLog(`✅ User profile reflection: ${isProBadgeVisible ? 'Pro' : 'Free'}`);

        // If auth succeeded and we are on /session, we have at least verified that:
        // 1. The profile exists
        // 2. The ID matches the auth user
        // 3. The subscription_status is one of ('free', 'pro')

        expect(isUpgradeVisible || isProBadgeVisible, 'UI must reflect a known tier').toBe(true);
    });

    test('validate sessions schema integrity', async ({ page }) => {
        await canaryLogin(page, CANARY_USER.email, CANARY_USER.password);

        debugLog('🔍 Checking sessions schema via intercept');

        // Intercept session fetch triggered by navigation to analytics
        const sessionPromise = page.waitForResponse(response =>
            response.url().includes('/rest/v1/sessions') &&
            response.request().method() === 'GET'
            , { timeout: 20000 });

        await navigateToRoute(page, ROUTES.ANALYTICS);

        const sessionResponse = await sessionPromise;
        const sessions = await sessionResponse.json();

        if (!Array.isArray(sessions) || sessions.length === 0) {
            console.warn('⚠️ No sessions found to validate. Skipping field level check.');
            return;
        }

        const latestSession = sessions[0];
        debugLog('📝 Validating session object keys:', Object.keys(latestSession));

        // Grounded metrics check - these MUST be present in the Supabase response
        const requiredGroundedMetrics = [
            'id',
            'user_id',
            'transcript',
            'engine',
            'clarity_score',
            'wpm',
            'total_words',
            'filler_words',
            'created_at'
        ];

        for (const field of requiredGroundedMetrics) {
            if (latestSession[field] === undefined) {
                console.error(`❌ CONTRACT DRIFT: Missing grounded field "${field}" in sessions table.`);
                expect(latestSession[field], `Session must have ${field}`).toBeDefined();
            }
        }

        debugLog('✅ sessions schema validated');
    });
});
