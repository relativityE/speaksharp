import { test, expect, type Page } from '@playwright/test';
import { navigateToRoute, debugLog, canaryLogin } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';
import { classifyCanaryStartResponse, type CanaryStartRpcPayload } from './canaryRuntimeContract';

/**
 * #1106 — deploy-race gate. The canary is triggered on push to main, but Vercel's deploy is async, so a
 * run can begin ~90s after merge and exercise the PREVIOUS production build (this is exactly what made the
 * #1105 auto-canary fail on a build that never contained the new affordance). This gate makes the canary
 * WAIT until the deployed release (`window.__APP_RELEASE__`) equals the SHA that triggered the run, and —
 * critically — fails a not-yet-live deployment with a DISTINCT "deployment not live" diagnostic that can
 * never be confused with a product-assertion failure. It records expected vs observed SHA as evidence.
 *
 * Scoped: only enforces against the real production host with a known EXPECTED_RELEASE_SHA. A local run,
 * or any run without the env (BASE_URL not prod / SHA unset), skips the gate so it can never block dev.
 */
const EXPECTED_RELEASE_SHA = process.env.EXPECTED_RELEASE_SHA?.trim();
const PROD_HOST = 'speaksharp-public.vercel.app';
const DEPLOY_WAIT_MS = 4 * 60_000; // Vercel post-merge publish budget
const DEPLOY_POLL_MS = 15_000;
/**
 * Headroom for the product smoke that runs AFTER the gate. `playwright.canary.config.ts` sets a 60s
 * per-test timeout, which is ample for the product path alone but would abort the deploy poll long before
 * DEPLOY_WAIT_MS elapsed — Playwright would kill the test with a GENERIC timeout and the distinct
 * `DEPLOYMENT NOT LIVE` error and `deployed-release` attachment would never be produced, defeating the
 * whole point of the gate. So when (and only when) the gate is armed, the test timeout is raised to cover
 * the poll budget PLUS this product budget. The workflow job timeout is raised to match.
 */
const PRODUCT_SMOKE_BUDGET_MS = 2 * 60_000;

function deployGateIsArmed(): boolean {
    return Boolean(EXPECTED_RELEASE_SHA) && (process.env.BASE_URL ?? '').includes(PROD_HOST);
}

async function assertDeployedReleaseIsLive(page: Page) {
    const base = process.env.BASE_URL ?? '';
    if (!deployGateIsArmed()) {
        debugLog(`[CANARY] deploy-race gate SKIPPED (expected SHA ${EXPECTED_RELEASE_SHA ? 'set' : 'unset'}; base="${base}").`);
        return;
    }
    const started = Date.now();
    let observed: string | undefined;
    // Poll the deployed release marker, reloading each cycle, until it matches or the budget elapses.
    // (Date.now() is fine in a Playwright spec — this is a test, not a resumable workflow script.)
    for (;;) {
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        observed = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__);
        if (observed && observed === EXPECTED_RELEASE_SHA) {
            await test.info().attach('deployed-release', {
                contentType: 'application/json',
                body: JSON.stringify({ verdict: 'LIVE', expected: EXPECTED_RELEASE_SHA, observed, waitedMs: Date.now() - started }, null, 2),
            });
            debugLog(`[CANARY] deployed release matches ${EXPECTED_RELEASE_SHA} (waited ${Math.round((Date.now() - started) / 1000)}s).`);
            return;
        }
        if (Date.now() - started > DEPLOY_WAIT_MS) break;
        await page.waitForTimeout(DEPLOY_POLL_MS);
    }
    await test.info().attach('deployed-release', {
        contentType: 'application/json',
        body: JSON.stringify({ verdict: 'DEPLOYMENT_NOT_LIVE', expected: EXPECTED_RELEASE_SHA, observed: observed ?? null, waitedMs: Date.now() - started }, null, 2),
    });
    throw new Error(
        `DEPLOYMENT NOT LIVE — deploy race, NOT a product regression. Production is serving ` +
        `__APP_RELEASE__=${observed ?? 'undefined'} but this run expects ${EXPECTED_RELEASE_SHA} after ` +
        `${Math.round((Date.now() - started) / 1000)}s. The product assertions were NOT run because the ` +
        `new build is not deployed yet. Re-run the canary once Vercel finishes publishing this SHA.`,
    );
}

/**
 * #1184: Private is the ONLY engine — there is no selector and no Native/Cloud choice. This helper
 * confirms the static Private indicator and makes the recorder ready to start. On a fresh production
 * browser the on-device model is not cached, so the mic first acts as the "Set up Private" download
 * control; we click it to trigger the on-device download (no paid STT API — still $0) and wait until it
 * becomes a ready Start control. If the model is already cached, the mic is already a ready Start control.
 */
async function ensurePrivateReady(page: Page) {
    // #1184 Private-only: there is no engine selector anymore. The shipped session page (MicCard, via
    // SessionOverhaulView) renders the recorder control as `mic-download` while the on-device Private model
    // still needs its one-time download, then `mic-start` once ready (disabled while the download runs,
    // enabled when the model is loaded). On a cold canary browser the model is not cached.
    const downloadBtn = page.getByTestId('mic-download');
    const startBtn = page.getByTestId('mic-start');
    // The recorder control is present in one of its two states before we ready it.
    await expect(downloadBtn.or(startBtn).first()).toBeVisible({ timeout: 15000 });
    if (await downloadBtn.count() > 0) {
        // Trigger the on-device model download; no network transcription is performed.
        await downloadBtn.first().click();
    }
    // Once the model is loaded, the control is `mic-start` and enabled. The download can take a while on a
    // cold machine, so allow a generous budget.
    await expect(startBtn).toBeEnabled({ timeout: 120000 });
}


/**
 * 🚨 CANARY SMOKE TEST 🚨
 * 
 * This test runs against REAL STAGING INFRASTRUCTURE.
 * It does NOT use MSW mocks - uses VITE_USE_LIVE_DB=true.
 * 
 * Purpose: Verify the "Critical Path" is operational.
 * 1. Login (Real Auth)
 * 2. Start Session (Real DB Insert, on-device Private STT)
 * 3. Stop Session (Real DB Update)
 * 4. Verify Analytics (Real DB Select)
 * 
 * Recording cost: $0.00 (uses on-device Private STT)
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
        // journey proves the reusable synthetic account is durably paid and currently allowed to start.
        let usageBody: {
            subscription_status?: string; is_pro?: boolean; can_start?: boolean;
            error?: string;
            private_sample_available?: boolean; private_sample_seconds_remaining?: number;
            private_sample_limit_seconds?: number;
        } | null = null;
        page.on('response', async (r) => {
            if (r.url().includes('check-usage-limit') && r.status() === 200) {
                try { usageBody = await r.json(); } catch { /* ignore non-JSON */ }
            }
        });

        // 0. #1106 DEPLOY-RACE GATE — confirm the deployed build is the one this run expects BEFORE any
        // product assertion, so a not-yet-live deployment fails distinctly as "deployment not live" rather
        // than misreporting a stale build as a product regression.
        //
        // The config's 60s per-test timeout would abort the poll (and its diagnostic) long before the
        // budget elapsed, so extend the timeout — ONLY when the gate is armed, leaving every other run
        // (local, non-prod) on the strict default.
        if (deployGateIsArmed()) {
            test.setTimeout(DEPLOY_WAIT_MS + PRODUCT_SMOKE_BUDGET_MS);
        }
        await assertDeployedReleaseIsLive(page);

        // 1. Real Login (modeled after soak test)
        await canaryLogin(page, CANARY_USER.email, CANARY_USER.password);

        // 2. Navigate to Session Page (use client-side navigation to preserve state)
        await navigateToRoute(page, ROUTES.SESSION, { waitForMocks: false });

        // 🔹 SCHEMA CHECK: User Profile
        // Verify that the profile loaded correctly and reflects the subscription status
        // This implicitly validates the 'user_profiles' table schema. The shipped recorder control is
        // `mic-download` (one-time model gate) or `mic-start` (ready) — never the retired
        // `session-start-stop-button` from the removed LiveRecordingCard.
        await expect(page.getByTestId('mic-download').or(page.getByTestId('mic-start')).first()).toBeVisible({ timeout: 15000 });

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

        // The reusable production canary is an isolated, Stripe-bound paid synthetic account. CI must
        // never reset a one-shot sample or extend a customer-style trial to keep this journey green.
        expect(u.subscription_status, 'CANARY_ENTITLEMENT_NOT_PAID:subscription_status').toBe('pro');
        expect(u.is_pro, 'CANARY_ENTITLEMENT_NOT_PAID:is_pro').toBe(true);
        expect(u.can_start, `CANARY_ENTITLEMENT_DENIED:${u.error ?? 'can_start_false'}`).toBe(true);

        // #1184: Private is the only engine surfaced to this paid canary. There is no Browser/Cloud choice
        // or trial nudge; `can_start` must be confirmed by the server before recording begins.
        if (u.is_pro) {
            await expect(page.getByTestId(TEST_IDS.PRO_BADGE)).toBeVisible({ timeout: 15000 });
        }
        await expect(page.getByTestId('private-trial-nudge')).toHaveCount(0);
        await expect(page.getByTestId('mic-download').or(page.getByTestId('mic-start')).first()).toBeVisible();

        // 3. Confirm the Private engine surface and make the recorder ready (on-device model; $0).
        debugLog('[CANARY] Confirming Private STT and readying the recorder...');
        await ensurePrivateReady(page);

        // 4. Start Session — the readied recorder control is `mic-start`.
        debugLog('[CANARY] Starting session...');
        const startButton = page.getByTestId('mic-start');
        await expect(startButton).toBeEnabled();
        const authoritativeStart = page.waitForResponse((response) =>
            response.request().method() === 'POST'
            && response.url().includes('/rest/v1/rpc/create_session_and_update_usage'),
        { timeout: 20000 });
        await startButton.click();

        // Fail on the authoritative start denial BEFORE waiting on any secondary UI selector. The
        // category is strictly sanitized so traces/logs identify private_sample_used (etc.) without
        // reflecting arbitrary database text.
        const startResponse = await authoritativeStart;
        let startPayload: CanaryStartRpcPayload | null = null;
        try { startPayload = await startResponse.json() as CanaryStartRpcPayload; } catch { /* classified below */ }
        const startOutcome = classifyCanaryStartResponse(startResponse.status(), startPayload);
        await test.info().attach('authoritative-recording-start', {
            contentType: 'application/json',
            body: JSON.stringify(startOutcome, null, 2),
        });
        expect(startOutcome.ok, `CANARY_START_DENIED:${startOutcome.ok ? 'none' : startOutcome.category}`).toBe(true);

        // Prove the current runtime + during-state seams AND exact Private authority. The ambient header
        // remains a corroborating assertion, never the sole proof; Browser/Cloud/Native cannot satisfy
        // these exact attributes.
        await expect(page.locator('html[data-runtime-state="RECORDING"][data-stt-resolved-mode="private"]'))
            .toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]'))
            .toBeVisible({ timeout: 10000 });
        await expect(page.locator('body[data-stt-policy="private"]')).toBeVisible();
        await expect(
            page.locator('[data-testid="live-session-header"][data-engine="private"][data-recording="true"]'),
        ).toBeVisible({ timeout: 10000 });
        debugLog('[CANARY] Confirmed runtime=RECORDING, during-state, and exact Private engine authority.');

        // 5. Record for 5 seconds
        debugLog('[CANARY] Recording for 5 seconds...');
        await page.waitForTimeout(5000);

        // 6. Stop Session — the during-state RecorderBar exposes `recorder-stop`.
        debugLog('[CANARY] Stopping session...');
        const stopButton = page.getByTestId('recorder-stop');
        await expect(stopButton).toBeVisible();
        await stopButton.click();

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
