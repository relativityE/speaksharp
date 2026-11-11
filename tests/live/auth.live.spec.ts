import { test, expect } from '@playwright/test';
import { goToPublicRoute } from '../e2e/helpers';
import { TEST_IDS, ROUTES } from '../constants';
import { DEFAULT_AUTH_LANDING, isExpectedAuthLanding } from '../e2e/canaryLanding';
import { requiresReleaseBinding, servedReleaseVerdict } from './helpers/servedReleaseBinding';

// Skip this test if running against a mock backend

test.describe('Real Authentication Flow', () => {
    // No credential-bearing artifacts (review on 978f4722): this signs in a persistent account, so a trace would hold the
    // token response, and a video/screenshot the filled form. The exact-SHA proof workflow promises no such artifact.
    test.use({ trace: 'off', video: 'off', screenshot: 'off' });
    // Verify we are running in the Live environment context
    test.beforeAll(() => {
        if (process.env.VITE_USE_LIVE_DB !== 'true') {
            console.warn('⚠️ Skipping Live Auth test: VITE_USE_LIVE_DB=true is not set.');
            test.skip();
            return;
        }

        const email = process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL;
        const password = process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD;
        if (!email || !password) {
            throw new Error('Spec failed: FREE_TEST_EMAIL/FREE_TEST_PASSWORD are required for Live Auth tests.');
        }
    });

    // Fail CLOSED on missing credentials. Previously these were `string | undefined` and were filled
    // straight into the form, so an unset env produced a confusing empty-field UI failure instead of
    // naming the real cause. Reason only — never the value.
    const requireEnv = (name: string, value: string | undefined): string => {
        if (!value) throw new Error(`missing required credential env: ${name}`);
        return value;
    };
    const testEmail = requireEnv('FREE_TEST_EMAIL|E2E_FREE_EMAIL', process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL);
    const testPassword = requireEnv('FREE_TEST_PASSWORD|E2E_FREE_PASSWORD', process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD);

    // The release under test: EXPECT_RELEASE_SHA (the served release being smoke-tested), distinct from any dispatched
    // source SHA. A deployed target without it fails closed before anything runs.
    const expectRelease = (process.env.EXPECT_RELEASE_SHA ?? '').trim();
    const bindRelease = requiresReleaseBinding(process.env.BASE_URL);

    test('should sign in with real credentials and establish session', async ({ page }) => {
        if (bindRelease) {
            const preflight = servedReleaseVerdict(expectRelease, expectRelease);
            expect(preflight, 'EXPECT_RELEASE_SHA must name the full served release under test').toEqual({ ok: true, release: expectRelease });
        }
        // High-Fidelity AUTH test against real Supabase

        // 1. Navigate to Sign In (public route - uses goToPublicRoute per architecture)
        await goToPublicRoute(page, ROUTES.SIGN_IN);
        await page.waitForSelector(`[data-testid="${TEST_IDS.AUTH_FORM}"]`, { timeout: 15000 });

        // 2. Interact with Real Form
        await page.getByTestId(TEST_IDS.EMAIL_INPUT).fill(testEmail);
        await page.getByTestId(TEST_IDS.PASSWORD_INPUT).fill(testPassword);

        // 3. Submit
        const loginPromise = page.waitForResponse(response =>
            response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
        );
        await page.getByTestId(TEST_IDS.SIGN_IN_SUBMIT).click();

        // 4. Verify Network Request (High Fidelity)
        const response = await loginPromise;
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.access_token).toBeDefined();
        expect(body.user).toBeDefined();

        // 5. Verify the ORDINARY sign-in landing and session state. The maintained landing contract
        // (tests/e2e/canaryLanding.ts) is exactly `/practice` for an ordinary login; `/session` there would be a
        // regression. This spec waited for `/session` and timed out on every build since that contract (run 43026108401).
        await page.waitForURL((url) => isExpectedAuthLanding(url.pathname, DEFAULT_AUTH_LANDING), { timeout: 30_000 });
        expect(new URL(page.url()).pathname).toBe(DEFAULT_AUTH_LANDING);

        // 🚨 HYDRATION GUARD 🚨
        await expect(page.getByTestId('nav-account-avatar')).toBeVisible({ timeout: 15000 });

        // 6. The page this sign-in ran against must name EXACTLY the release under test (fail closed: missing,
        // malformed or mismatched → FAIL). Public, content-free values only.
        const observedRelease = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null);
        test.info().annotations.push({ type: 'observed-release', description: String(observedRelease) });
        console.log(`OBSERVED_RELEASE ${observedRelease}`);
        if (bindRelease) {
            expect(servedReleaseVerdict(expectRelease, observedRelease), 'the signed-in page must serve the release under test')
                .toEqual({ ok: true, release: expectRelease });
        }
    });
});
