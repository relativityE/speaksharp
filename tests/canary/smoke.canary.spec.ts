import { readFileSync } from 'node:fs';
import { test, expect, type Page, type Worker } from '@playwright/test';
import { navigateToRoute, debugLog, canaryLogin } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';
import {
    classifyCanaryStartResponse,
    classifyCanaryUsageEntitlement,
    canaryPathContainsEncodedAudio,
    canaryQueryContainsEncodedAudio,
    judgeCanaryEgress,
    judgeDurableSession,
    judgeSessionAttributionAuthority,
    sanitizeCanaryPayloadUrl,
    verdictCategory,
    verdictUrl,
    type CanaryStartRpcPayload,
    type ChannelObservation,
    type EgressObservation,
} from './canaryRuntimeContract';
import { candidateFromPersistedTuple } from '../live/helpers/practiceLoopJourney';
import { PAYLOAD_TRIPWIRE } from '../../scripts/human-test/payloadTripwire.mjs';
import { auditPayloads, BLOCKING_PAYLOAD_CATEGORIES } from '../../scripts/human-test/observer.mjs';

type CanaryPayloadRecord = {
    t: number | null;
    transport: string;
    url: string;
    method: string;
    kind: string;
    mime: string | null;
    bytes: number | null;
    runtimeState: string | null;
    context: 'main' | 'worker';
};

function sanitizePayloadRecord(raw: unknown, context: 'main' | 'worker', appUrl: string): CanaryPayloadRecord {
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const url = sanitizeCanaryPayloadUrl(record.url, appUrl);
    return {
        t: typeof record.t === 'number' ? record.t : null,
        transport: typeof record.transport === 'string' ? record.transport : 'unknown',
        url,
        method: typeof record.method === 'string' ? record.method : 'UNKNOWN',
        kind: typeof record.kind === 'string' ? record.kind : 'unknown',
        mime: typeof record.mime === 'string' ? record.mime : null,
        bytes: typeof record.bytes === 'number' ? record.bytes : null,
        runtimeState: typeof record.runtimeState === 'string' ? record.runtimeState : null,
        context,
    };
}

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
        test.skip(!CANARY_USER.password, 'Skipping Canary test: Missing CANARY_LANE_PASSWORD');
    });

    test('should complete a full session cycle on real infrastructure', async ({ page }) => {
        // #1258 — install the repository's payload tripwire before ANY app code. Main-document payload
        // metadata is streamed to the test because the successful save navigates away and destroys that
        // document. The callback immediately strips query strings and retains metadata only — never a
        // transcript, audio body, or raw URL. Workers are installed and drained separately below.
        const payloadRecords: CanaryPayloadRecord[] = [];
        const channelObservations: ChannelObservation[] = [];
        let recordingStartedAt: number | null = null;
        let lateWorkerCount = 0;
        await page.exposeBinding('__SS_TRIPWIRE_EMIT__', (_source, raw: unknown) => {
            const source = (raw as { __ssSource?: unknown } | null)?.__ssSource === 'worker' ? 'worker' : 'main';
            payloadRecords.push(sanitizePayloadRecord(raw, source, page.url()));
        });
        await page.exposeBinding('__SS_TRIPWIRE_CHANNEL_EMIT__', (_source, raw: unknown) => {
            const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
            const rawUrl = typeof record.url === 'string' ? record.url : '';
            try {
                const parsed = new URL(rawUrl, page.url());
                channelObservations.push({
                    redacted: sanitizeCanaryPayloadUrl(rawUrl, page.url()),
                    origin: parsed.origin,
                    kind: 'eventsource',
                    // No EventSource route is part of the supported take contract.
                    routeAllowed: false,
                });
            }
            catch {
                channelObservations.push({
                    redacted: '<unparseable>', origin: '', kind: 'eventsource', routeAllowed: false,
                });
            }
        });
        await page.addInitScript({ content: PAYLOAD_TRIPWIRE });

        const workerInstallations = new Map<Worker, Promise<boolean>>();
        const installWorker = (worker: Worker) => {
            if (workerInstallations.has(worker)) return;
            if (recordingStartedAt !== null) lateWorkerCount += 1;
            workerInstallations.set(worker, worker.evaluate(PAYLOAD_TRIPWIRE)
                .then(() => worker.evaluate<boolean>(
                    'globalThis.__SS_TRIPWIRE_READY_PROMISE__.then(() => globalThis.__SS_TRIPWIRE_RELAY_READY__ === true)',
                ))
                .catch(() => false));
        };
        page.on('worker', installWorker);

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
        await navigateToRoute(page, ROUTES.SESSION);

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

        // 3. Confirm the Private engine surface and make the recorder ready (on-device model; $0).
        debugLog('[CANARY] Confirming Private STT and readying the recorder...');
        await ensurePrivateReady(page);

        // The worker holding PCM must already be instrumented BEFORE recording. A worker first created
        // after Start creates an unobserved interval and fails the proof even if installation later wins.
        page.workers().forEach(installWorker);
        const installedBeforeStart = await Promise.all(workerInstallations.values());
        expect(workerInstallations.size, 'CANARY_PAYLOAD_OBSERVER_MISSING: no Private-STT worker').toBeGreaterThan(0);
        expect(installedBeforeStart.every(Boolean), 'CANARY_PAYLOAD_OBSERVER_MISSING: worker install failed').toBe(true);
        await expect.poll(() => page.evaluate(() => ({
            tripwire: Array.isArray((globalThis as unknown as { __SS_TRIPWIRE__?: unknown }).__SS_TRIPWIRE__),
            binding: typeof (globalThis as unknown as { __SS_TRIPWIRE_EMIT__?: unknown }).__SS_TRIPWIRE_EMIT__ === 'function',
        })), { message: 'CANARY_PAYLOAD_OBSERVER_MISSING: main tripwire/binding', timeout: 5000 })
            .toEqual({ tripwire: true, binding: true });

        // #1258 — OBSERVE EVERY REQUEST AND CHANNEL THE TAKE OPENS. Installed before Start so the
        // recording window is fully covered. Recording only; the verdict is judged after the take.
        //
        // REDACT AT CAPTURE. The browser necessarily holds the full URL — that is not ours to change.
        // What is ours is never STORING or ATTACHING path/query content: either can carry a transcript.
        const redact = (u: string): {
            redacted: string;
            origin: string;
            hasQuery: boolean;
            queryContainsEncodedAudio: boolean;
            pathContainsEncodedAudio: boolean;
        } => {
            try {
                const p = new URL(u, page.url());
                return {
                    redacted: sanitizeCanaryPayloadUrl(u, page.url()),
                    origin: p.origin,
                    hasQuery: p.search.length > 0,
                    queryContainsEncodedAudio: canaryQueryContainsEncodedAudio(u, page.url()),
                    pathContainsEncodedAudio: canaryPathContainsEncodedAudio(u, page.url()),
                };
            }
            catch {
                return {
                    redacted: '<unparseable>', origin: '', hasQuery: false,
                    queryContainsEncodedAudio: false, pathContainsEncodedAudio: false,
                };
            }
        };
        const egressObservations: EgressObservation[] = [];
        const appOriginDuringTake = new URL(page.url()).origin;
        const configuredSupabaseUrlDuringTake = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
        expect(configuredSupabaseUrlDuringTake, 'CANARY_CONFIG_INVALID: Supabase URL required before observation')
            .toBeTruthy();
        const supabaseOriginDuringTake = new URL(configuredSupabaseUrlDuringTake as string).origin;
        const telemetryOriginsDuringTake = new Set([
            process.env.VITE_POSTHOG_HOST,
            process.env.SENTRY_DSN,
        ].filter((value): value is string => Boolean(value)).map((value) => new URL(value).origin));
        const allowedSupabaseRoutes = new Set([
            'POST /rest/v1/rpc/create_session_and_update_usage',
            'PATCH /rest/v1/sessions',
            'POST /functions/v1/attest-session-engine',
            'POST /functions/v1/get-ai-suggestions',
        ]);
        const requestContract = (rawUrl: string, method: string, contentType: string | undefined) => {
            try {
                const parsed = new URL(rawUrl, page.url());
                const route = `${method} ${parsed.pathname}`;
                const routeAllowed = parsed.origin === supabaseOriginDuringTake
                    ? allowedSupabaseRoutes.has(route)
                    : telemetryOriginsDuringTake.has(parsed.origin)
                        ? method === 'POST' && (/^\/e\/?$/.test(parsed.pathname)
                            || /^\/batch\/?$/.test(parsed.pathname)
                            || /^\/api\/\d+\/envelope\/?$/.test(parsed.pathname))
                        : parsed.origin === appOriginDuringTake
                            && (method === 'GET' || method === 'HEAD')
                            && parsed.pathname === '/session';
                const normalizedType = (contentType ?? '').split(';', 1)[0].trim().toLowerCase();
                const bodyClassAllowed = method === 'GET' || method === 'HEAD'
                    || ['application/json', 'text/plain', 'application/x-www-form-urlencoded'].includes(normalizedType);
                return { routeAllowed, bodyClassAllowed };
            } catch {
                return { routeAllowed: false, bodyClassAllowed: false };
            }
        };
        let createSessionRpcCount = 0;
        page.on('request', (request) => {
            const {
                redacted, origin, hasQuery, queryContainsEncodedAudio, pathContainsEncodedAudio,
            } = redact(request.url());
            if (request.method() === 'POST'
                && request.url().includes('/rest/v1/rpc/create_session_and_update_usage')) {
                createSessionRpcCount += 1;
            }
            // `postDataBuffer()` sees binary and multipart bodies; `postData()` returns null for both,
            // so an audio upload as multipart would have recorded as bodyless. `null` here means the
            // state could not be determined and the judge treats that as prohibited.
            let bodyBytes: number | null = null;
            try { bodyBytes = request.postDataBuffer()?.byteLength ?? 0; } catch { bodyBytes = null; }
            const { routeAllowed, bodyClassAllowed } = requestContract(
                request.url(), request.method(), request.headers()['content-type'],
            );
            egressObservations.push({
                redacted, origin, bodyBytes, resourceType: request.resourceType(), hasQuery,
                queryContainsEncodedAudio, pathContainsEncodedAudio, routeAllowed, bodyClassAllowed,
            });
        });
        page.on('websocket', (ws) => {
            const { redacted, origin } = redact(ws.url());
            let routeAllowed = false;
            try {
                const parsed = new URL(ws.url());
                routeAllowed = parsed.origin === supabaseOriginDuringTake.replace(/^https/, 'wss')
                    && parsed.pathname === '/realtime/v1/websocket';
            } catch { /* fail closed */ }
            channelObservations.push({ redacted, origin, kind: 'websocket', routeAllowed });
        });

        // 4. Start Session — the readied recorder control is `mic-start`.
        debugLog('[CANARY] Starting session...');
        const startButton = page.getByTestId('mic-start');
        await expect(startButton).toBeEnabled();
        const authoritativeStart = page.waitForResponse((response) =>
            response.request().method() === 'POST'
            && response.url().includes('/rest/v1/rpc/create_session_and_update_usage'),
        { timeout: 20000 });
        recordingStartedAt = Date.now();
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
        expect(startOutcome.ok, `CANARY_START_DENIED:${verdictCategory(startOutcome)}`).toBe(true);

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

        // 7. #1258 — THIS TAKE'S OWN EVIDENCE, UNCONDITIONALLY.
        //
        // What this replaces: a `Promise.race` of three end states where two resolved on ABSENCE
        // (`No speech was detected`, plus every racer swallowing its own timeout via
        // `.catch(() => null)`), then a schema check gated behind `if (url.includes('/analytics'))`
        // and, inside that, `if (sessions.length > 0)`. An empty session list is exactly what a
        // silently failed save produces, so the one assertion proving a save happened was skipped
        // by the failure it existed to catch — and the spec then logged "Smoke test passed".
        //
        // Nothing below may be conditional, and no terminal may carry a swallowing catch.
        // ORDER MATTERS. `UpgradePromptDialog` can BLOCK navigation to /analytics, which is why the
        // replaced oracle raced them. Dismiss it FIRST, then require the terminal — racing a blocker
        // against the thing it blocks is how an absence became a pass.
        const dialogLocator = page.locator('div[role="alertdialog"]');
        if (await dialogLocator.isVisible().catch(() => false)) {
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            if (await stayButton.isVisible().catch(() => false)) await stayButton.click();
        }

        // FORBIDDEN TERMINAL. The fixture contains speech; "no speech" is the defect, not an end state.
        await expect(
            page.getByText('No speech was detected'),
            'CANARY_FORBIDDEN_TERMINAL: the recorded take produced no speech',
        ).toHaveCount(0);

        // REQUIRED TERMINAL. Saving stays on /session; the after-state verdict is the actual rendered
        // post-save terminal. No `.catch(() => null)`: a timeout here is a failure, not a pass.
        await expect(page.getByTestId('session-verdict')).toBeVisible({ timeout: 15000 });

        // Seal payload evidence only AFTER stop/finalization/save reaches that required terminal. The
        // Stop button's callback is intentionally void while persistence continues asynchronously, so
        // auditing immediately after click() misses any egress during STOPPING or save. Worker records
        // stream to the document while the engine is alive. Worker teardown remains synchronous; its
        // shared atomic counter freezes the exact final sequence. This document-side drain requires
        // every numbered record and exposed-binding acknowledgement, never an elapsed-time guess.
        const payloadDrain = await page.evaluate(async (expectedWorkers) => {
            const drain = (globalThis as typeof globalThis & {
                __SS_TRIPWIRE_DRAIN__?: (expected: number) => Promise<{
                    workers: number; received: number; acknowledged: number;
                }>;
            }).__SS_TRIPWIRE_DRAIN__;
            if (typeof drain !== 'function') throw new Error('payload relay drain unavailable');
            return drain(expectedWorkers);
        }, workerInstallations.size);
        expect(payloadDrain.workers, 'CANARY_PAYLOAD_OBSERVER_GAP: worker relay not registered')
            .toBeGreaterThanOrEqual(workerInstallations.size);
        expect(payloadDrain.acknowledged, 'CANARY_PAYLOAD_OBSERVER_GAP: worker sequence not drained')
            .toBeGreaterThanOrEqual(payloadDrain.received);
        expect(lateWorkerCount, 'CANARY_PAYLOAD_OBSERVER_GAP: worker created after recording began').toBe(0);

        const payloadFindings = auditPayloads(payloadRecords, {
            appOrigin: new URL(page.url()).origin,
            recordingStartedAt,
        });
        const blockingPayloads = payloadFindings.filter((finding: { category?: string }) =>
            BLOCKING_PAYLOAD_CATEGORIES.includes(finding.category));
        await test.info().attach('audio-egress-payload-verdict', {
            contentType: 'application/json',
            body: JSON.stringify({
                verdict: blockingPayloads.length === 0 ? 'PASS' : 'FAIL',
                inspected: payloadRecords.length,
                workers: workerInstallations.size,
                findings: payloadFindings,
            }, null, 2),
        });
        expect(blockingPayloads, 'CANARY_AUDIO_EGRESS: payload tripwire observed prohibited bytes').toEqual([]);
        // Seal the exact take window before navigation/reload. Later evidence reads must not contaminate it.
        const sealedEgressObservations = egressObservations.slice();
        const sealedChannelObservations = channelObservations.slice();

        // Exercise the shipped action only after the post-save payload verdict is sealed. This makes
        // /analytics an explicit journey step instead of pretending Save navigates there automatically.
        await page.getByTestId('verdict-see-all').click();
        await page.waitForURL(/\/analytics/, { timeout: 15000 });

        debugLog('[CANARY] 🔍 Binding durable evidence to this take...');
        const sessionResponsePromise = page.waitForResponse((res) => {
            if (res.request().method() !== 'GET' || res.status() !== 200) return false;
            try {
                const url = new URL(res.url());
                const projection = url.searchParams.get('select') ?? '';
                return url.pathname.endsWith('/rest/v1/sessions')
                    && projection.includes('id')
                    && projection.includes('total_words')
                    && projection.includes('duration');
            } catch {
                return false;
            }
        });
        await page.reload();
        const sessionResponse = await sessionResponsePromise;
        const sessions = await sessionResponse.json();

        // Bound to THIS take's session id from the authoritative start RPC — never `sessions[0]`,
        // which is the newest row the account has and on a re-run is the PREVIOUS take.
        const boundSessionId = 'sessionId' in startOutcome ? startOutcome.sessionId : '';
        const durable = judgeDurableSession(sessions, boundSessionId);
        await test.info().attach('durable-session-verdict', {
            contentType: 'application/json',
            body: JSON.stringify({ ...durable, boundSessionId }, null, 2),
        });
        const durableReason = verdictCategory(durable);
        expect(durable.ok, `CANARY_TAKE_NOT_DURABLE:${durableReason}`).toBe(true);
        expect(createSessionRpcCount, 'CANARY_DUPLICATE_SESSION_CREATE: expected one start RPC for this take').toBe(1);
        debugLog('[CANARY] ✅ This take saved exactly once with a non-zero word count.');

        // Candidate identity comes from THIS TAKE'S immutable, server-owned attribution authority — never
        // from the legacy client-facing `sessions.attribution_status` tuple. Reuse the authenticated headers
        // already sent by the app for its owner-scoped sessions read, but never attach or log those values.
        const configuredSupabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
        expect(configuredSupabaseUrl, 'CANARY_CONFIG_INVALID: Supabase URL is required for authority read')
            .toBeTruthy();
        const requestHeaders = await sessionResponse.request().allHeaders();
        const apiKey = requestHeaders.apikey;
        const authorization = requestHeaders.authorization;
        expect(Boolean(apiKey && authorization), 'CANARY_AUTHORITY_READ_HEADERS_MISSING').toBe(true);
        const authorityUrl = new URL('/rest/v1/session_attribution_authority', configuredSupabaseUrl as string);
        authorityUrl.searchParams.set(
            'select',
            'session_id,user_id,authority_version,engine_class,engine,engine_version,model_id,provider,attested_at',
        );
        authorityUrl.searchParams.set('session_id', `eq.${boundSessionId}`);
        let authorityRows: unknown = null;
        await expect.poll(async () => {
            const response = await fetch(authorityUrl, {
                headers: { apikey: apiKey as string, authorization: authorization as string },
            });
            if (!response.ok) return `authority_http_${response.status}`;
            try { authorityRows = await response.json(); }
            catch { return 'authority_invalid_json'; }
            return verdictCategory(judgeSessionAttributionAuthority(authorityRows, boundSessionId));
        }, {
            message: 'CANARY_CANDIDATE_AUTHORITY_NOT_TERMINAL',
            timeout: 15_000,
        }).toBe('none');
        const authority = judgeSessionAttributionAuthority(authorityRows, boundSessionId);
        await test.info().attach('candidate-authority-verdict', {
            contentType: 'application/json',
            body: JSON.stringify({ ...authority, boundSessionId }, null, 2),
        });
        expect(authority.ok, `CANARY_CANDIDATE_AUTHORITY:${verdictCategory(authority)}`).toBe(true);

        // The expected side is the checked-in selector in the exact release under test, so a future v4
        // promotion automatically changes this assertion while a silent declaration mismatch remains visible.
        const engineVersion = 'engineVersion' in authority ? authority.engineVersion : null;
        const modelId = 'modelId' in authority ? authority.modelId : null;
        const persistedCandidate = candidateFromPersistedTuple(engineVersion, modelId);
        const configuredCandidate = (JSON.parse(
            readFileSync('frontend/src/config/private-stt.config.json', 'utf8'),
        ) as { candidate?: unknown }).candidate;
        expect(typeof configuredCandidate, 'CANARY_CONFIG_INVALID: Private STT selector has no candidate').toBe('string');
        expect('failure' in persistedCandidate ? persistedCandidate.failure : null,
            'CANARY_CANDIDATE_UNATTRIBUTABLE').toBeNull();
        const observedCandidate = 'candidateId' in persistedCandidate ? persistedCandidate.candidateId : null;
        expect(observedCandidate, 'CANARY_CANDIDATE_DIVERGENCE').toBe(configuredCandidate);
        await test.info().attach('candidate-attribution-verdict', {
            contentType: 'application/json',
            body: JSON.stringify({
                configuredCandidate,
                observedCandidate,
                authorityVersion: 'authorityVersion' in authority ? authority.authorityVersion : null,
            }, null, 2),
        });

        // 8. Destination-policy proof. This catches undeclared origins, audio-shaped query exfiltration
        // even to an approved origin, any post-readiness model-origin request, unreadable body state,
        // and ungoverned duplex channels. Body-content classification remains the worker/main tripwire's
        // responsibility; query shape is classified here before the URL is redacted to origin-only evidence.
        const appOrigin = new URL(page.url()).origin;
        expect(configuredSupabaseUrl, 'CANARY_CONFIG_INVALID: Supabase URL is required for exact-origin policy')
            .toBeTruthy();
        const supabaseOrigin = new URL(configuredSupabaseUrl as string).origin;
        const governedTelemetry = Array.from(new Set([
            process.env.VITE_POSTHOG_HOST,
            process.env.SENTRY_DSN,
        ].filter((value): value is string => Boolean(value)).map((value) => new URL(value).origin)));
        const egress = judgeCanaryEgress(sealedEgressObservations, sealedChannelObservations, {
            firstParty: [appOrigin, supabaseOrigin, supabaseOrigin.replace(/^https/, 'wss')],
            governedTelemetry,
            modelAssets: ['https://huggingface.co', 'https://cdn-lfs.huggingface.co', 'https://cdn-lfs-us-1.huggingface.co'],
        });
        await test.info().attach('egress-destination-verdict', {
            contentType: 'application/json',
            body: JSON.stringify(egress, null, 2),
        });
        const egressReason = `${verdictCategory(egress)} ${verdictUrl(egress)}`.trim();
        expect(egress.ok, `CANARY_PROHIBITED_DESTINATION:${egressReason}`).toBe(true);
        debugLog(`[CANARY] ✅ No prohibited destination across ${egress.ok ? egress.inspected : 0} observed requests.`);

        debugLog('[CANARY] ✅ Smoke test passed. System is operational.');
    });
});
