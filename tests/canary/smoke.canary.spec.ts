import { test, expect, type Locator, type Page } from '@playwright/test';
import { navigateToRoute, debugLog, canaryLogin } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';
import { startTake as startTakeWithAssertions, type TakeAssertions } from './canaryStartTake';
import { canaryTestTimeoutMs, withPhaseDeadline, DEPLOY_WAIT_MS, DEPLOY_POLL_MS } from './canaryBudget';

/**
 * The two-line seam described in `canaryStartTake.ts`: Playwright's own `expect`, handed to the
 * extracted logic so that module stays importable by the unit lane. This adapter is the ONLY part of
 * the start path the unit test cannot reach — the paid canary run is what proves it.
 */
const canaryAssertions: TakeAssertions<Locator> = {
    visible: (x, t) => expect(x).toBeVisible({ timeout: t }),
    enabled: (x, t) => expect(x).toBeEnabled({ timeout: t }),
};
const startTake = (page: Page) => startTakeWithAssertions(page, canaryAssertions);
import {
    classifyCanaryStartResponse,
    classifyCanaryUsageEntitlement,
    type CanaryStartRpcPayload,
} from './canaryRuntimeContract';

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

/*
 * The canary's budgets are DERIVED in `./canaryBudget`, not declared here — see that file for why
 * (#1518 P1: the cold wait, the per-test ceiling and the job ceiling were three unrelated numbers, and
 * the cold path could not physically complete under any of them).
 */

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
    const deadlineAt = started + DEPLOY_WAIT_MS;
    const remainingMs = () => deadlineAt - Date.now();
    let observed: string | undefined;
    /*
     * STRICTLY BOUNDED BY DEPLOY_WAIT_MS, NAVIGATION INCLUDED (PM RETURN finding 1).
     *
     * The elapsed check used to happen only AFTER `page.goto()`, and the goto carried no timeout — so a
     * navigation begun at 3:59 could run on for its own navigation timeout and spend the product
     * allowance this patch exists to protect. Now every goto is given only the time that remains, the
     * poll sleep is clamped to it, and the budget is re-checked before each attempt. A goto that times
     * out because the deadline arrived is reported as DEPLOYMENT NOT LIVE, never as a navigation fault:
     * the distinct diagnostic is the whole point of the gate.
     */
    while (remainingMs() > 0) {
        try {
            await page.goto(base, { waitUntil: 'domcontentloaded', timeout: Math.max(1, remainingMs()) });
            observed = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__);
        } catch (err) {
            if (remainingMs() > 0) throw err;   // a real navigation fault, not the deadline
            break;                              // the ceiling arrived mid-navigation → deployment verdict below
        }
        if (observed && observed === EXPECTED_RELEASE_SHA) {
            await test.info().attach('deployed-release', {
                contentType: 'application/json',
                body: JSON.stringify({ verdict: 'LIVE', expected: EXPECTED_RELEASE_SHA, observed, waitedMs: Date.now() - started }, null, 2),
            });
            debugLog(`[CANARY] deployed release matches ${EXPECTED_RELEASE_SHA} (waited ${Math.round((Date.now() - started) / 1000)}s).`);
            return;
        }
        if (remainingMs() <= 0) break;
        await page.waitForTimeout(Math.max(1, Math.min(DEPLOY_POLL_MS, remainingMs())));
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
        test.skip(!CANARY_USER.password, 'Skipping Canary test: Missing CANARY_LANE_PASSWORD');
    });

    test('should complete a full session cycle on real infrastructure', async ({ page }) => {
        // Capture the SERVER entitlement response (also recorded in the trace's network log) so the
        // journey proves the reusable synthetic account is durably paid and currently allowed to start.
        let usageBody: {
            subscription_status?: string; is_pro?: boolean; can_start?: boolean;
            error?: string;
            trial_active?: boolean; trial_expires_at?: string | null;
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
        // UNCONDITIONAL, and that is the #1518 P1 fix: the product allowance is what the COLD journey
        // needs whether or not a deployment is being awaited. Gating the raise on `deployGateIsArmed()`
        // left every ungated run — local, staging, any run without EXPECTED_RELEASE_SHA — unable to
        // finish a cold take at all, and gated runs with a slow publish no better off. The deployment
        // allowance is ADDED on top only when the poll will actually run.
        test.setTimeout(canaryTestTimeoutMs(deployGateIsArmed()));
        // Each phase runs under its OWN enforced ceiling, so the total above is a real bound rather than
        // an inventory of internal waits — the round-2 correction. A phase that overruns fails as
        // CANARY_PHASE_TIMEOUT:<phase>, naming where the time went instead of a generic test timeout.
        await withPhaseDeadline('deploy_gate', () => assertDeployedReleaseIsLive(page));

        // 1. Real Login (modeled after soak test)
        await withPhaseDeadline('login', () => canaryLogin(page, CANARY_USER.email, CANARY_USER.password));

        // 2. Navigate to Session Page (use client-side navigation to preserve state)
        await withPhaseDeadline('navigate_session', () => navigateToRoute(page, ROUTES.SESSION));

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
        await withPhaseDeadline('pre_start_checks', async () => {
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
                lane: CANARY_USER.lane,
                trial_active: u.trial_active,
                trial_expires_at: u.trial_expires_at,
            }, null, 2),
        });

        // The primary lane proves a real active 30-day trial; the secondary lane proves paid continuity.
        // CI never grants, resets, or extends either account's commercial state.
        const usageOutcome = classifyCanaryUsageEntitlement(u, CANARY_USER.lane);
        if ('category' in usageOutcome) {
            throw new Error(`CANARY_ENTITLEMENT_DENIED:${usageOutcome.category}`);
        }

        // Private is the only customer engine for both the trial and paid-continuation lanes.
        if (CANARY_USER.lane === 'paid-continuation') {
            await expect(page.getByTestId(TEST_IDS.PRO_BADGE)).toBeVisible({ timeout: 15000 });
        } else {
            await expect(page.getByTestId(TEST_IDS.PRO_BADGE)).toHaveCount(0);
        }
        await expect(page.getByTestId('mic-download').or(page.getByTestId('mic-start')).first()).toBeVisible();
        });

        // 3-4. Start the take with its ONE control (on-device model; $0). See startTake().
        // `start_take` owns the cold authoritative RPC, so its ceiling is the helper's own total: the
        // press plus the two control waits plus the 150s RPC, unchanged.
        debugLog('[CANARY] Confirming Private STT and starting the take...');
        const { authoritativeStart, path: startPath } = await withPhaseDeadline('start_take', () => startTake(page));
        await test.info().attach('start-path', {
            contentType: 'application/json',
            body: JSON.stringify({ path: startPath }),
        });
        debugLog(`[CANARY] Take started on the ${startPath} path.`);

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
        await withPhaseDeadline('recording_checks', async () => {
        await expect(page.locator('html[data-runtime-state="RECORDING"][data-stt-resolved-mode="private"]'))
            .toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]'))
            .toBeVisible({ timeout: 10000 });
        await expect(page.locator('body[data-stt-policy="private"]')).toBeVisible();
        await expect(
            page.locator('[data-testid="live-session-header"][data-engine="private"][data-recording="true"]'),
        ).toBeVisible({ timeout: 10000 });
        });
        debugLog('[CANARY] Confirmed runtime=RECORDING, during-state, and exact Private engine authority.');

        // 5. Record for 5 seconds
        debugLog('[CANARY] Recording for 5 seconds...');
        await withPhaseDeadline('recording_dwell', () => page.waitForTimeout(5000));

        // 6. Stop Session — the during-state RecorderBar exposes `recorder-stop`.
        // One phase covers stop through settle: the stop-control wait, the end-state race, and the
        // analytics reload with its sessions-response validation — the waits the earlier enumeration
        // left out entirely (PM RETURN finding 2).
        debugLog('[CANARY] Stopping session...');
        await withPhaseDeadline('stop_and_settle', async () => {
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
        });

        debugLog('[CANARY] ✅ Smoke test passed. System is operational.');
    });
});
