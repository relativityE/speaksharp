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
import { gunzipSync, inflateSync } from 'node:zlib';
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
    routeSurfaceFailures,
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

/** Bodies no known encoding could decode. A non-zero count invalidates the telemetry half outright. */
let undecodableAnalyticsBodies = 0;

/*
 * DEFENCE IN DEPTH FOR THE CREDENTIAL (Codex security `3996855726`).
 *
 * deployed-live runs with `trace: 'on'`, `screenshot: 'only-on-failure'` and `video: 'retain-on-failure'`,
 * and a Playwright trace stores call parameters and DOM snapshots. The previous head filled
 * PRO_TEST_PASSWORD into the page one line after the step that timed out — the trace recorded zero fill
 * actions only because execution never reached it. That is luck, not a control.
 *
 * Two changes, in order of importance:
 *   1. the password NEVER enters the page. Authentication happens Node-side through Supabase and the
 *      resulting session is injected, so no trace, video, screenshot or DOM snapshot can contain it.
 *   2. artifacts are suppressed for this spec anyway, so a future edit that reintroduces a fill cannot
 *      quietly publish it.
 *
 * PM accepted the consequence explicitly: this proves the AUTHENTICATED Practice Loop journey, not the
 * sign-in UI. The original finding is about automatic post-save suggestions, not authentication.
 */
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('#1437 — Practice Loop journey on canonical Production', () => {
    test.skip(
        !PRO_EMAIL || !PRO_PASSWORD || !SUPABASE_URL || !SERVICE_ROLE,
        'Requires PRO_TEST_EMAIL, PRO_TEST_PASSWORD, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — supplied by rc-gates.yml. Absent locally by design.',
    );

    test('a completed, saved session automatically renders exactly one 1+1 review', async ({ page }) => {
        test.setTimeout(900_000); // a real Private take on Production, including model acquisition

        const coachingRequests: number[] = [];   // timestamps, so post-save ordering is provable
        /** One captured analytics event: its name and only the closed-enum/identity fields read. */
        const captured: Array<{ name: string; stage?: string; journeyId?: string; attemptId?: string; candidateId?: string; expected?: string; acquired?: string }> = [];

        /*
         * TEST-ONLY PLUMBING, and the minimum of it. Without a record of real user input this journey
         * cannot distinguish "the product requested coaching by itself" from "something clicked". The
         * init script records only event type and timestamp — no target, no value, no content.
         */
        await page.addInitScript(() => {
            const marks: number[] = [];
            (window as unknown as { __journeyInput__?: number[] }).__journeyInput__ = marks;
            for (const type of ['pointerdown', 'keydown']) {
                window.addEventListener(type, () => marks.push(Date.now()), { capture: true });
            }
        });

        /**
         * DECODE BEFORE PARSING (Codex `3996845159`).
         *
         * PostHog compresses captures by default — negotiated gzip, or base64 inside a urlencoded
         * `data=` field. The previous head ran regexes over `postData()`, so on Production it would have
         * collected NOTHING and then failed every journey for a missing sequence: a proof that reports
         * the product broken because the proof cannot read. Each encoding is tried in turn and an
         * undecodable body is surfaced rather than silently treated as "no events".
         */
        const decodeAnalytics = (raw: Buffer | null): unknown[] => {
            if (!raw || raw.length === 0) return [];
            const attempts: Array<() => unknown> = [
                () => JSON.parse(raw.toString('utf8')),
                () => {
                    const params = new URLSearchParams(raw.toString('utf8'));
                    const data = params.get('data');
                    if (!data) throw new Error('no data field');
                    const decoded = Buffer.from(data, 'base64');
                    try { return JSON.parse(gunzipSync(decoded).toString('utf8')); } catch { /* not gzipped */ }
                    return JSON.parse(decoded.toString('utf8'));
                },
                () => JSON.parse(gunzipSync(raw).toString('utf8')),
                () => JSON.parse(inflateSync(raw).toString('utf8')),
                () => JSON.parse(Buffer.from(raw.toString('utf8'), 'base64').toString('utf8')),
            ];
            for (const attempt of attempts) {
                try {
                    const parsed = attempt();
                    return Array.isArray(parsed) ? parsed : [parsed];
                } catch { /* try the next encoding */ }
            }
            undecodableAnalyticsBodies += 1;
            return [];
        };

        page.on('request', (request) => {
            const url = request.url();
            if (url.includes(`/functions/v1/${COACHING_FUNCTION}`)) {
                coachingRequests.push(Date.now());
                return;
            }
            let host = '';
            try { host = new URL(url).host; } catch { host = ''; }
            if (!ANALYTICS_HOST.test(host)) return;

            for (const entry of decodeAnalytics(request.postDataBuffer())) {
                const record = entry as { event?: unknown; properties?: Record<string, unknown> };
                if (typeof record?.event !== 'string') continue;
                const props = record.properties ?? {};
                const text = (key: string) => (typeof props[key] === 'string' ? props[key] as string : undefined);
                captured.push({
                    name: record.event,
                    // `stage` is a closed enum (LatencyStage); the identity fields are opaque ids. None of
                    // these is content, and no other property is read.
                    stage: text('stage'),
                    journeyId: text('journey_id'),
                    attemptId: text('attempt_id'),
                    candidateId: text('candidate_id'),
                    expected: text('expected_candidate_id'),
                    acquired: text('acquired_candidate_id'),
                });
            }
        });

        await test.step('canonical Production on a REAL route, before any credential', async () => {
            // `/auth/signin` is the route App.tsx:439 defines. The previous head used `/auth/login`,
            // which does not exist, and passed anyway because a 404 shell satisfies origin/release/mock
            // checks. The response status and the not-found shell are both checked now.
            const response = await page.goto('/auth/signin');
            const observed = await page.evaluate(() => {
                const w = window as unknown as Record<string, unknown> & { __APP_RELEASE__?: string };
                return {
                    origin: location.origin,
                    release: w.__APP_RELEASE__ ?? null,
                    injected: Object.keys(w).some((k) => /__MOCK|__MSW/i.test(k)),
                    notFound: document.body.innerText.includes('Page not found'),
                };
            });
            const failures = routeSurfaceFailures({
                path: '/auth/signin',
                httpStatus: response?.status() ?? null,
                origin: observed.origin,
                releaseSha: observed.release,
                mockSurfacesPresent: observed.injected,
                notFoundRendered: observed.notFound,
            }, APPROVED_ORIGIN);
            expect(failures, 'the pre-credential surface must be the real approved route').toEqual([]);
        });

        await test.step('authenticate Node-side and inject the session — no credential touches the page', async () => {
            const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
            expect(anonKey, 'anon key required to authenticate Node-side').toBeTruthy();
            const auth = createClient(SUPABASE_URL!, anonKey!, { auth: { persistSession: false } });

            let session;
            try {
                const { data, error } = await auth.auth.signInWithPassword({ email: PRO_EMAIL!, password: PRO_PASSWORD! });
                // Sanitised: the provider's message can echo submitted values, so only the code is surfaced.
                if (error) throw new Error(`Node-side sign-in failed (code=${error.code ?? 'unknown'}, status=${error.status ?? 'unknown'})`);
                session = data.session;
            } catch (caught) {
                const code = caught instanceof Error && /code=/.test(caught.message) ? caught.message : 'sign-in threw';
                throw new Error(`Node-side sign-in failed, sanitised: ${code}`);
            }
            expect(session, 'a session must be established Node-side').toBeTruthy();

            const projectRef = new URL(SUPABASE_URL!).host.split('.')[0];
            await page.addInitScript(({ ref, value }) => {
                window.localStorage.setItem(`sb-${ref}-auth-token`, value);
            }, { ref: projectRef, value: JSON.stringify(session) });

            await page.goto('/practice');
            // FAIL FAST. The previous head burned 900s on a wrong route because nothing asserted the
            // surface was present. A missing practice root now fails in seconds with a readable reason.
            await expect(page.getByTestId('practice-root'), 'authenticated practice surface must load').toBeVisible({ timeout: 60_000 });
        });

        await test.step('enter Open Mic through Products, exactly as the procedure says', async () => {
            await expect(page.getByTestId('practice-card-freeform'), 'Open Mic entry must be offered').toBeVisible({ timeout: 30_000 });
            await page.getByTestId('practice-card-freeform').click();
            await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
            await selectBenchmarkMode(page, 'private');
            await preparePrivateModelIfPrompted(page, 600_000);
            await waitForPrivateEngineReady(page, 300_000);
        });

        // The facade (`data-stt-mode` = `private`) is deliberately NOT read as identity any more. Every
        // Private candidate reports it, so it cannot distinguish v2, v4 and Moonshine — the one thing the
        // down-selection needs. Identity comes from the acquisition envelope instead.

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

        /*
         * TERMINAL OUTCOMES COME FROM TELEMETRY, NOT THE DOM (Codex `3996845164`). The previous head
         * mapped `data-review-state` to a hand-built single-element array, so duplicate terminal events —
         * a failure followed by a render, or two renders — were invisible while the DOM settled on
         * `ready`. Counting the emitted terminal events is what makes the duplicate casualty reachable.
         */
        const reviewState = await reviewCard.getAttribute('data-review-state');
        const terminalEvents = captured.filter((event) =>
            event.name === 'practice_loop_review_rendered' || event.name === 'practice_loop_review_failed');
        const terminalOutcomes: ReviewTerminalOutcome[] = terminalEvents.map((event) =>
            event.name === 'practice_loop_review_rendered' ? 'rendered_success' : 'failed_safe');

        /*
         * VISIBLE, NON-EMPTY COACHING — not heading presence (Codex `3996845185`, raised to P1 because
         * visible 1+1 coaching IS the value proposition). Headings mount with the card, so counting them
         * proved the card rendered, which is the same reachability-not-rendering flaw this spec exists to
         * replace. Each phrase is scoped to the card, required visible, and required non-empty; the text
         * is measured and discarded, never stored.
         */
        const visibleNonEmptyPhrase = async (heading: string): Promise<number> => {
            const blocks = reviewCard.locator('div', { has: page.getByRole('heading', { name: heading, exact: true }) });
            const total = await blocks.count();
            let counted = 0;
            for (let index = 0; index < total; index += 1) {
                const block = blocks.nth(index);
                if (!(await block.isVisible())) continue;
                const paragraph = block.locator('p').first();
                if (!(await paragraph.isVisible().catch(() => false))) continue;
                const length = (await paragraph.innerText().catch(() => '')).trim().length;
                if (length > 0) counted += 1;
            }
            return counted;
        };
        const whatWentWell = await visibleNonEmptyPhrase('What went well');
        const whatToImprove = await visibleNonEmptyPhrase('What to improve');

        const savedSessionId = await page.evaluate(
            () => document.documentElement.getAttribute('data-session-persisted-id'),
        );

        const inputAfterSave = await page.evaluate(() => {
            const marks = (window as unknown as { __journeyInput__?: number[] }).__journeyInput__ ?? [];
            return marks.slice();
        });
        const firstInteractionAfterSave = inputAfterSave.find((at) => at > savedAt) ?? null;

        /*
         * PERSISTED identity. `engine` is the product facade — every Private candidate reports
         * `private` — so the candidate discriminator is `engine_version`/`model_name`, which is what
         * `complete_session_v2` persists via `p_engine_version` (Codex `3996845174`). Only identity
         * columns are selected; the transcript and the coaching text are never read.
         */
        let persistedCandidate: string | null = null;
        if (savedSessionId) {
            const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
            const { data, error } = await admin
                .from('sessions')
                .select('id,engine,engine_version,model_name')
                .eq('id', savedSessionId)
                .single();
            if (error) throw new Error(`persisted read failed (fail closed): ${error.code ?? 'unknown'}`);
            persistedCandidate = (data?.engine_version as string | null) ?? (data?.model_name as string | null) ?? null;
        }

        // CONFIGURED and ACQUIRED come from the acquisition event the allowlist publishes precisely so a
        // readback can prove configured = acquired = running for a three-model down-selection.
        const acquisition = captured.find((event) => event.name === 'private_model_acquisition_start');
        const runningCandidate = [...captured].reverse().find((event) => event.candidateId)?.candidateId ?? null;

        const reviewEvents = captured.filter((event) => event.name.startsWith('practice_loop_review_'));
        const distinct = (values: Array<string | undefined>) =>
            [...new Set(values.filter((value): value is string => Boolean(value)))];

        const evidence: PracticeLoopJourneyEvidence = {
            savedSessionId: savedSessionId ?? null,
            sessionSaved: Boolean(savedSessionId),
            suggestionRequests: coachingRequests.filter((at) => at > savedAt).length,
            suggestionRequestsBeforeSave: coachingRequests.filter((at) => at <= savedAt).length,
            manualGenerationTriggered: firstInteractionAfterSave !== null
                && coachingRequests.some((at) => at > (firstInteractionAfterSave as number)),
            renderedPhraseCounts: { whatWentWell, whatToImprove },
            terminalOutcomes,
            modelIdentity: {
                requested: acquisition?.expected ?? null,
                observed: acquisition?.acquired ?? runningCandidate,
                persisted: persistedCandidate,
            },
            telemetry: {
                events: captured.map((event) => event.name),
                stagesReached: distinct(captured.map((event) => event.stage)),
                boundCandidateId: runningCandidate,
                attemptIds: distinct(reviewEvents.map((event) => event.attemptId)),
                journeyIds: distinct(reviewEvents.map((event) => event.journeyId)),
            },
        };

        await test.step('the telemetry half is readable at all', async () => {
            // A proof that cannot decode its own evidence must say so, not report the product broken.
            expect(undecodableAnalyticsBodies, 'every analytics body must decode').toBe(0);
            expect(captured.length, 'telemetry must have been observed').toBeGreaterThan(0);
        });

        await test.step('the evidence carries no credential, transcript or coaching content', async () => {
            const serialized = JSON.stringify(evidence);
            expect(contentLeaks(serialized, [PRO_EMAIL!, PRO_PASSWORD!, SERVICE_ROLE!]), 'no credential in evidence').toEqual([]);
            expect(serialized).not.toMatch(/what_worked|what_to_try_next/);
        });

        await test.step('the journey satisfies the procedure', async () => {
            const failures = practiceLoopJourneyFailures(evidence);
            expect(
                failures,
                `journey failed (state=${reviewState}, postSaveRequests=${evidence.suggestionRequests}, terminalEvents=${terminalOutcomes.join('|') || 'none'})`,
            ).toEqual([]);
        });
    });
});
