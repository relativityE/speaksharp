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
import {
    awaitStopTerminal,
    classifyStopOutcome,
    startOwnerId,
    verifySavedReadback,
    type CompletionEvidence,
} from './canaryStopSaveOracle';

/** CO006: the save wait and the two readback waits fit inside the 120 s stop_and_settle ceiling (45 + 30 + 30). */
const STOP_SAVE_WAIT_MS = 45_000;
const STOP_READBACK_WAIT_MS = 30_000;

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
        // Each product phase runs under its OWN enforced ceiling, so the total above is a real bound
        // rather than an inventory of internal waits. A phase that overruns fails as
        // CANARY_PHASE_TIMEOUT:<phase>, naming where the time went instead of a generic test timeout.
        //
        // The deploy poll is deliberately NOT wrapped (Codex, exact head 90a1eceb8). It already bounds
        // itself to DEPLOY_WAIT_MS, navigation included; racing it against a second timer of the SAME
        // budget let that outer timer fire first and swallow the DEPLOYMENT NOT LIVE verdict and its
        // `deployed-release` evidence — the very diagnostic the gate exists to emit. Its verdict path is
        // paid for by DEPLOY_VERDICT_SLACK_MS in the outer budget instead.
        await assertDeployedReleaseIsLive(page);

        // 1. Real Login (modeled after soak test)
        await withPhaseDeadline('login', () => canaryLogin(page, CANARY_USER.email, CANARY_USER.password));

        // 2. Navigate to Session Page (use client-side navigation to preserve state)
        await withPhaseDeadline('navigate_session', () => navigateToRoute(page, ROUTES.SESSION));

        // 🔹 ENTITLEMENT + AFFORDANCE CHECK (post-#1047, replaces the stale tier-affordance selectors).
        // The old check asserted PRIVATE_SAMPLE_SETUP_BUTTON / "Private sample: up to 5 minutes" — both
        // removed/relocated by #1047/#1094, which is why the canary failed (#1100). We now read the live
        // server entitlement and assert the affordance that MATCHES that account state.
        await withPhaseDeadline('pre_start_checks', async () => {
        // 🔹 SCHEMA CHECK: User Profile — the shipped recorder control is `mic-download` (one-time model
        // gate) or `mic-start` (ready), never the retired `session-start-stop-button`. Inside this phase
        // since #1518 round 3: it was a 15s wait sitting between two phases with no budget of its own.
        await expect(page.getByTestId('mic-download').or(page.getByTestId('mic-start')).first()).toBeVisible({ timeout: 15000 });
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
        //
        // The phase now includes AWAITING the authoritative RPC, not just pressing. Before #1518 round 3
        // `start_take` ended at the click, and the 150s cold RPC wait — the longest wait in the whole
        // journey — ran outside every phase.
        const { startPath, startResponse, startPayload } = await withPhaseDeadline('start_take', async () => {
            const { authoritativeStart, path } = await startTake(page);
            const response = await authoritativeStart;
            let payload: CanaryStartRpcPayload | null = null;
            try { payload = await response.json() as CanaryStartRpcPayload; } catch { /* classified below */ }
            return { startPath: path, startResponse: response, startPayload: payload };
        });
        await test.info().attach('start-path', {
            contentType: 'application/json',
            body: JSON.stringify({ path: startPath }),
        });
        debugLog(`[CANARY] Take started on the ${startPath} path.`);

        // Fail on the authoritative start denial BEFORE waiting on any secondary UI selector. The
        // category is strictly sanitized so traces/logs identify private_sample_used (etc.) without
        // reflecting arbitrary database text.
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

        // 7. CO006: the take passes only on evidence bound to THIS take. The save listener is registered
        // BEFORE Stop, so a fast save cannot be missed; a locator timeout never ends the wait (it used to
        // turn into null and "finish" the race); no-speech is its own non-save outcome; and the readback
        // checks the exact started session by id and owner, never `sessions[0]`.
        const completion = page.waitForResponse(
            (res) => /\/rest\/v1\/rpc\/complete_session_v2(\?|$)/.test(res.url()) && res.request().method() === 'POST',
            { timeout: STOP_SAVE_WAIT_MS },
        ).then(async (res): Promise<CompletionEvidence> => {
            let requestSessionId: string | null = null;
            try { requestSessionId = (res.request().postDataJSON() as { p_session_id?: unknown })?.p_session_id as string ?? null; } catch { /* unreadable → unbound */ }
            let body: unknown = null;
            try { body = await res.json(); } catch { /* classified as not saved */ }
            return { requestSessionId: typeof requestSessionId === 'string' ? requestSessionId : null, status: res.status(), body };
        });
        const noSpeech = page.getByText('No speech was detected').waitFor({ timeout: STOP_SAVE_WAIT_MS }).then(() => undefined);
        const dialog = page.locator('div[role="alertdialog"]').waitFor({ timeout: STOP_SAVE_WAIT_MS }).then(() => undefined);
        await stopButton.click();

        const observation = await awaitStopTerminal({ completion, noSpeech, dialog }, STOP_SAVE_WAIT_MS);
        const outcome = classifyStopOutcome(startOutcome.sessionId, observation);
        await test.info().attach('stop-save-outcome', {
            contentType: 'application/json',
            body: JSON.stringify({ outcome, unrelatedDialog: observation.unrelatedDialog }, null, 2),
        });
        expect(outcome.kind, `CANARY_STOP_${outcome.kind === 'unresolved' ? outcome.reason : outcome.kind}`).toBe('saved');

        // 8. Durable readback of the exact take, twice: once on arrival and once after a full reload.
        const ownerId = startOwnerId(startPayload?.new_session);
        for (const pass of ['arrival', 'reload'] as const) {
            const read = page.waitForResponse(
                (res) => res.url().includes('/rest/v1/sessions') && res.url().includes(startOutcome.sessionId)
                    && res.request().method() === 'GET' && res.status() === 200,
                { timeout: STOP_READBACK_WAIT_MS },
            );
            if (pass === 'arrival') await navigateToRoute(page, ROUTES.analyticsWithSession(startOutcome.sessionId));
            else await page.reload();
            const verdict = verifySavedReadback(startOutcome.sessionId, ownerId, await (await read).json());
            expect(verdict, `CANARY_READBACK_${pass}`).toEqual({ ok: true });
        }
        debugLog('[CANARY] ✅ Saved take read back by id and owner, before and after reload');
        });

        debugLog('[CANARY] ✅ Smoke test passed. System is operational.');
    });
});
