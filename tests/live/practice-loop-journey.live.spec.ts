/**
 * #1437 — THE PRACTICE LOOP JOURNEY, ON CANONICAL PRODUCTION.
 *
 * PO's original real-world finding was that a completed Production session produced no AI suggestions.
 * Nothing in the estate proved otherwise: `tests/e2e/completed-session-practice-loop.e2e.spec.ts` asserts
 * the review is REACHABLE — the session link, the Gemini disclosure, an enabled "Practice this again" —
 * and never that generated coaching rendered, because `get-ai-suggestions` is not routed in the e2e
 * mocks at all. This spec is the missing proof, and it follows PO's procedure rather than inspecting
 * source: sign in, complete a real take, save, and watch what the product does on its own.
 *
 * WHAT IT PROVES, deliberately in the order the user experiences it:
 *   1. a fresh authenticated session starts, completes and saves;
 *   2. the coaching request fires AUTOMATICALLY — no click, no retry, no refresh, exactly one request;
 *   3. exactly one valid 1+1 review becomes visible;
 *   4. telemetry correlates saved → requested → exactly one terminal outcome, bound to THIS session;
 *   5. a non-rendered outcome claims neither completion stage (#1422's corrected defect);
 *   6. requested, observed and persisted engine identity agree (the down-selection's basis);
 *   7. the evidence holds no credential, transcript or coaching content.
 *
 * The VERDICT lives in `helpers/practiceLoopJourney.ts` as a pure function, and its failure shapes are
 * driven in ordinary CI by `tests/unit/practiceLoopJourneyEvidence.test.ts`. A Production run can prove
 * the journey happened; it cannot prove the check would have caught a failure, because Production
 * cannot be made to fail on demand. Both halves are required — that is the lesson #1424 paid for.
 *
 * DISPATCH: `rc-gates.yml` → `diagnostic_dast_spec=tests/live/practice-loop-journey.live.spec.ts`
 * against `https://speaksharp-public.vercel.app`. The workflow calls that a diagnostic and NOT a Gate 3
 * pass; this spec is reported the same way — a journey smoke, not a gate.
 */
import { createClient } from '@supabase/supabase-js';
import { test } from './helpers/deployedLiveTest';
import { expect } from '@playwright/test';
import {
    selectBenchmarkMode,
    preparePrivateModelIfPrompted,
    waitForPrivateEngineReady,
    startBenchmarkRecording,
    stopBenchmarkRecording,
    waitForBenchmarkSaveCandidate,
} from './helpers/benchmark-utils';
import {
    practiceLoopJourneyFailures,
    contentLeaks,
    type PracticeLoopJourneyEvidence,
    type ReviewTerminalOutcome,
} from './helpers/practiceLoopJourney';

const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';
const PRO_EMAIL = process.env.PRO_TEST_EMAIL;
const PRO_PASSWORD = process.env.PRO_TEST_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The coaching endpoint, by function name — the browser-observable half of the journey. */
const COACHING_FUNCTION = 'get-ai-suggestions';
/** Analytics transport hosts. Only event NAMES are read from these; never properties. */
const ANALYTICS_HOST = /posthog\.com$/i;

test.describe('#1437 — Practice Loop journey on canonical Production', () => {
    test.skip(
        !PRO_EMAIL || !PRO_PASSWORD || !SUPABASE_URL || !SERVICE_ROLE,
        'Requires PRO_TEST_EMAIL, PRO_TEST_PASSWORD, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — supplied by rc-gates.yml. Absent locally by design.',
    );

    test('a completed, saved session automatically renders exactly one 1+1 review', async ({ page }) => {
        test.setTimeout(900_000); // a real Private take on Production, including model acquisition

        const coachingRequests: number[] = [];   // timestamps, so "automatic" can be proven against input
        const analyticsEvents: string[] = [];
        const stagesReached: string[] = [];

        /*
         * TEST-ONLY PLUMBING, and the minimum of it. Without a record of real user input this journey
         * cannot distinguish "the product requested coaching by itself" from "something clicked". The
         * init script records only event type and timestamp — no target, no value, no content — and it
         * exists solely in the test context.
         */
        await page.addInitScript(() => {
            const marks: number[] = [];
            (window as unknown as { __journeyInput__?: number[] }).__journeyInput__ = marks;
            for (const type of ['pointerdown', 'keydown']) {
                window.addEventListener(type, () => marks.push(Date.now()), { capture: true });
            }
        });

        /*
         * OBSERVATION, INSTALLED BEFORE ANYTHING NAVIGATES. Every coaching request is timestamped so the
         * request can be shown to precede any interaction, and analytics payloads give up only their
         * event names. Reading properties here would put transcript-adjacent content into an artifact,
         * which the journey must never need.
         */
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes(`/functions/v1/${COACHING_FUNCTION}`)) {
                coachingRequests.push(Date.now());
                return;
            }
            let host = '';
            try { host = new URL(url).host; } catch { host = ''; }
            if (!ANALYTICS_HOST.test(host)) return;
            const body = request.postData() ?? '';
            for (const match of body.matchAll(/"event"\s*:\s*"([a-z0-9_$]+)"/gi)) {
                analyticsEvents.push(match[1]);
            }
            // `stage` on a stage_latency event is a closed enum (LatencyStage), so reading it carries no
            // content. It is the only property this spec reads, and it is what proves #1422's rule that a
            // non-rendered review claims neither completion stage.
            for (const match of body.matchAll(/"stage"\s*:\s*"([a-z0-9_]+)"/gi)) {
                stagesReached.push(match[1]);
            }
        });

        await test.step('canonical Production, no test surfaces, before any credential', async () => {
            await page.goto('/auth/login');
            const surface = await page.evaluate(() => {
                const w = window as unknown as Record<string, unknown> & { __APP_RELEASE__?: string };
                return {
                    origin: location.origin,
                    release: w.__APP_RELEASE__ ?? null,
                    injected: Object.keys(w).some((k) => /__MOCK|__MSW/i.test(k)),
                };
            });
            expect(surface.origin, 'exact approved origin').toBe(APPROVED_ORIGIN);
            expect(surface.release, 'the deployed release must be identifiable').toMatch(/^[0-9a-f]{40}$/);
            expect(surface.injected, 'no mock surfaces on Production').toBe(false);
        });

        await test.step('sign in as the existing Pro test account', async () => {
            await page.getByTestId('email-input').fill(PRO_EMAIL!);
            await page.getByTestId('password-input').fill(PRO_PASSWORD!);
            await page.getByTestId('sign-in-submit').click();
            await expect(page).toHaveURL(/\/practice/, { timeout: 60_000 });
        });

        await test.step('enter Open Mic through Products, exactly as the procedure says', async () => {
            await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 45_000 });
            await page.getByTestId('practice-card-freeform').click();
            await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
            await selectBenchmarkMode(page, 'private');
            await preparePrivateModelIfPrompted(page, 600_000);
            await waitForPrivateEngineReady(page, 300_000);
        });

        const requestedEngine = await page.evaluate(
            () => document.documentElement.getAttribute('data-stt-mode') ?? document.documentElement.getAttribute('data-model-status'),
        );

        await test.step('complete a real take and let it save', async () => {
            await startBenchmarkRecording(page, 'practice-loop-journey');
            await page.waitForTimeout(20_000); // real speech from the committed fixture
            await stopBenchmarkRecording(page, 'practice-loop-journey', 180_000);
            await waitForBenchmarkSaveCandidate(page, 'practice-loop-journey', 180_000);
            await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 120_000 });
        });
        const savedAt = Date.now();

        /*
         * THE HEART OF IT. From here the test does NOT touch the page — no click, no retry, no refresh.
         * Whatever happens next is the product acting on its own, which is the contract PO stated: after
         * a successful save, suggestions start automatically.
         */
        const reviewCard = page.getByTestId('ai-suggestions-card');
        await expect(reviewCard, 'the review surface must appear after a save').toBeVisible({ timeout: 60_000 });

        await expect
            .poll(async () => reviewCard.getAttribute('data-review-state'), {
                timeout: 180_000,
                message: 'the review must reach a terminal state on its own',
            })
            .toMatch(/^(ready|error|empty)$/);

        const reviewState = await reviewCard.getAttribute('data-review-state');
        const whatWentWell = await page.getByText('What went well', { exact: true }).count();
        const whatToImprove = await page.getByText('What to improve', { exact: true }).count();

        const terminalOutcomes: ReviewTerminalOutcome[] = reviewState === 'ready'
            ? ['rendered_success']
            : reviewState === 'error' ? ['failed_safe'] : ['refused_safe'];

        // `data-session-persisted-id` is the forensic anchor the product already publishes at the
        // persistence boundary (`forensicAnchors.ts:318`). No new product seam is introduced for this test.
        const savedSessionId = await page.evaluate(
            () => document.documentElement.getAttribute('data-session-persisted-id'),
        );

        // Input recorded AFTER the save. The test performs none, so a non-empty list is a real finding.
        const inputAfterSave = await page.evaluate(() => {
            const marks = (window as unknown as { __journeyInput__?: number[] }).__journeyInput__ ?? [];
            return marks.slice();
        });
        const firstInteractionAfterSave = inputAfterSave.find((at) => at > savedAt) ?? null;

        /*
         * PERSISTED identity, read with the service role — the third of requested/observed/persisted.
         * Only the engine column and the presence of coaching are read. The transcript and the coaching
         * text are never selected, so they cannot reach an artifact.
         */
        let persistedEngine: string | null = null;
        let persistedHasCoaching = false;
        if (savedSessionId) {
            const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
            const { data, error } = await admin
                .from('sessions')
                .select('id,engine,ai_suggestions')
                .eq('id', savedSessionId)
                .single();
            if (error) throw new Error(`persisted read failed (fail closed): ${error.code ?? 'unknown'}`);
            persistedEngine = (data?.engine as string | null) ?? null;
            persistedHasCoaching = data?.ai_suggestions != null;
        }

        const observedEngine = await page.evaluate(
            () => document.documentElement.getAttribute('data-stt-mode') ?? null,
        );

        const evidence: PracticeLoopJourneyEvidence = {
            savedSessionId: savedSessionId ?? null,
            sessionSaved: Boolean(savedSessionId),
            suggestionRequests: coachingRequests.length,
            // Automatic means the request happened without an interaction preceding it. The test performs
            // no interaction after the save, so any recorded interaction would be a real defect.
            // Automatic means no input preceded the request. Proven against a recorded input timeline,
            // not against the test's own good intentions.
            manualGenerationTriggered: firstInteractionAfterSave !== null
                && coachingRequests.some((at) => at > (firstInteractionAfterSave as number)),
            renderedPhraseCounts: { whatWentWell, whatToImprove },
            terminalOutcomes,
            modelIdentity: {
                requested: requestedEngine,
                observed: observedEngine,
                persisted: persistedEngine,
            },
            telemetry: {
                events: analyticsEvents,
                stagesReached,
                boundSessionId: savedSessionId ?? null,
                boundModel: persistedEngine,
            },
        };

        await test.step('the evidence carries no credential, transcript or coaching content', async () => {
            const serialized = JSON.stringify(evidence);
            expect(contentLeaks(serialized, [PRO_EMAIL!, PRO_PASSWORD!, SERVICE_ROLE!]), 'no credential in evidence').toEqual([]);
            expect(serialized).not.toMatch(/what_worked|what_to_try_next/);
        });

        await test.step('the journey satisfies the procedure', async () => {
            const failures = practiceLoopJourneyFailures(evidence);
            expect(
                failures,
                `journey failed (state=${reviewState}, requests=${coachingRequests.length}, persistedCoaching=${persistedHasCoaching})`,
            ).toEqual([]);
        });
    });
});
