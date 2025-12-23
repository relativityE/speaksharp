/**
 * Schema Canary Spec
 * 
 * Purpose: Detect "Contract Drift" by validating real Supabase API responses
 * against our grounded TypeScript interfaces.
 * 
 * This test runs in "Real Mode" or "Mock Mode" but is most useful in Real Mode.
 * It uses soft-fail logging to identify discrepancies without blocking if needed.
 */

import { test, expect } from '@playwright/test';

// Use live DB if available, otherwise fallback to mock for basic structure check
const isLive = !!process.env.VITE_USE_LIVE_DB;
const email = process.env.E2E_PRO_EMAIL || 'test@test.com';
const password = process.env.E2E_PRO_PASSWORD || 'password123';

test.describe('Schema Canary: Database Contract Validation', () => {

    test.beforeEach(async ({ page }) => {
        if (isLive) {
            const { liveLogin } = await import('../../tests/e2e/helpers');
            await liveLogin(page, email, password);
        } else {
            const { programmaticLoginWithRoutes } = await import('../../tests/e2e/helpers');
            await programmaticLoginWithRoutes(page);
        }
    });

    test('validate user_profiles schema integrity', async ({ page }) => {
        console.log(`🔍 Checking user_profiles schema (Live: ${isLive})`);

        // Re-navigate or trigger refresh to ensure we catch the request in this test body
        const profilePromise = page.waitForResponse(response =>
            response.url().includes('/rest/v1/user_profiles') &&
            response.request().method() === 'GET'
        );

        const [profileResponse] = await Promise.all([
            profilePromise,
            page.reload()
        ]);

        const data = await profileResponse.json();
        const profile = Array.isArray(data) ? data[0] : data;

        expect(profile, 'Profile data should be an object').toBeDefined();

        // Grounded fields must exist
        expect(profile.id, 'Profile must have id').toBeDefined();
        expect(profile.subscription_status, 'Profile must have subscription_status').toBeDefined();
        expect(profile.usage_seconds, 'Profile must have usage_seconds').toBeDefined();

        // PHANTOM CHECK: These should NOT be present (Leanness Audit)
        const phantoms = ['full_name', 'avatar_url'];
        for (const phantom of phantoms) {
            if (profile[phantom] !== undefined) {
                console.warn(`⚠️ LEAK DETECTED: Phantom field "${phantom}" found in user_profiles response.`);
            }
        }

        console.log('✅ user_profiles schema validated');
    });

    test('validate sessions schema integrity', async ({ page }) => {
        console.log(`🔍 Checking sessions schema (Live: ${isLive})`);

        // Intercept session fetch triggered by navigation to analytics
        const sessionPromise = page.waitForResponse(response =>
            response.url().includes('/rest/v1/sessions') &&
            response.request().method() === 'GET'
        );

        const { navigateToRoute } = await import('../../tests/e2e/helpers');
        await navigateToRoute(page, '/analytics');

        const sessionResponse = await sessionPromise;
        const sessions = await sessionResponse.json();

        if (!Array.isArray(sessions) || sessions.length === 0) {
            console.warn('⚠️ No sessions found to validate. Skipping field level check.');
            return;
        }

        const latestSession = sessions[0];
        console.log('📝 Validating session object keys:', Object.keys(latestSession));

        // Grounded metrics check
        const requiredGroundedMetrics = [
            'transcript',
            'engine',
            'clarity_score',
            'wpm',
            'total_words',
            'filler_words'
        ];

        for (const field of requiredGroundedMetrics) {
            if (latestSession[field] === undefined) {
                // Using soft assertion or custom error
                console.error(`❌ CONTRACT DRIFT: Missing grounded field "${field}" in sessions table.`);
                // We'll still fail the test but the log is explicit
                expect(latestSession[field], `Session must have ${field}`).toBeDefined();
            }
        }

        console.log('✅ sessions schema validated');
    });
});
