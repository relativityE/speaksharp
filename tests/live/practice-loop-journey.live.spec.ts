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
 *   6. the take runs an EXPLICIT v2/v4/Moonshine target, reached through the repository's guarded switch,
 *      and requested (the target), observed and VERIFIED persisted identity agree;
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
 *
 * ONE TEST PER COMPARISON CANDIDATE (#1437 RETURN `5649385757`). The target is part of each test's title,
 * so a dispatch selects exactly one arm through the existing `diagnostic_dast_grep` input — for example
 * `candidate v2:base.en` — and no workflow change is needed to name it.
 */
import { gunzipSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { test } from './helpers/deployedLiveTest';
import { waitForAppVisibleReady } from '../e2e/helpers';
import { expect, type Request } from '@playwright/test';
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
    awaitCorrelatedTerminal,
    savedCorrelationsOf,
    observedCandidateAfterSwitch,
    runningCandidateAfterSwitch,
    classifyRequestsByBoundary,
    COMPARISON_TARGETS,
    MODEL_COMPARISON_AUTH_KEY,
    DIAGNOSTIC_JOURNEY,
    diagnosticAuthorizationFor,
    diagnosticHoldMessage,
    type DiagnosticHold,
    type PersistedIdentity,
    type PracticeLoopJourneyEvidence,
    type ReviewTerminalOutcome,
} from './helpers/practiceLoopJourney';
import { checkRunAuthority, githubApiGetter, loadRunAuthority } from '../../scripts/human-test/modelComparisonRunAuthority.mjs';

const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';
const PRO_EMAIL = process.env.PRO_TEST_EMAIL;
const PRO_PASSWORD = process.env.PRO_TEST_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/*
 * #1432 PM decision 5651684739 — THIS RUN IS THE AUTHORIZATION, NO KEY. `rc-gates.yml` (inputs `comparison_cell`,
 * `comparison_release_sha`, `comparison_evidence_document_id`) mints the take's authorization in an earlier step of
 * the same run attempt and passes its path. That attempt is read back from GitHub in Node before any navigation;
 * outside it the diagnostic HOLDs. It never qualifies six-cell evidence.
 */
const AUTHORIZATION_FILE = process.env.MODEL_COMPARISON_AUTHORIZATION_FILE;
const AUTHORIZATION_RUN_ID = process.env.GITHUB_RUN_ID ?? null;
const AUTHORIZATION_RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT ?? null;
/** Read-only GitHub token used only in Node to read this run attempt; never passed to the page. */
const RUN_READ_TOKEN = process.env.MODEL_COMPARISON_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
const readOperatorFile = (path: string | undefined): string | null => {
    if (!path) return null;
    try { return readFileSync(path, 'utf8'); } catch { return null; }
};

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

    for (const target of COMPARISON_TARGETS) {
        test(`a completed, saved session automatically renders exactly one 1+1 review [candidate ${target}]`, async ({ page }, testInfo) => {
            test.setTimeout(900_000); // a real Private take on Production, including model acquisition

            /*
             * NO PAGE SNAPSHOT IN THE ARTIFACT, EVER.
             *
             * On failure Playwright writes `error-context.md` containing a full DOM snapshot of the page —
             * and after sign-in that page holds the transcript and the generated coaching. Suppressing
             * trace, video and screenshot does not stop it: `playwright/lib/index.js:616` writes it unless an
             * attachment named `error-context` already exists. So one is attached up front, content-free,
             * and the snapshot is never written. The previous run's artifact carried exactly such a snapshot
             * (a 404 page, harmless then — the same code path after a real take would not have been).
             */
            await testInfo.attach('error-context', {
                contentType: 'text/markdown',
                body: '# Page snapshot suppressed\n\nThis journey runs against an authenticated Production session whose DOM '
                    + 'contains transcript and coaching text. A snapshot is deliberately not captured; the failure reason is in '
                    + 'the assertion message, which is content-free by construction.',
            });

            const coachingRequests: number[] = [];   // browser-clock start times, so post-save ordering is provable
            /*
             * WORKSTREAM 1 — the request's own start time, on the same clock as the product's persistence stamp.
             * Node sees a request slightly after the browser sends it, and that lag is in the unsafe direction: a
             * request fired a few milliseconds BEFORE persistence could be observed after it and counted as
             * post-save. `timing().startTime` is reported by the browser, so it is used whenever it is available.
             */
            const coachingObservedAt = new Map<Request, number>();
            /** One captured analytics event: its name and only the closed-enum/identity fields read. */
            const captured: Array<{ name: string; stage?: string; journeyId?: string; attemptId?: string; candidateId?: string; expected?: string; acquired?: string; comparisonNonce?: string; evidenceDocumentId?: string }> = [];

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

            /*
             * #1432 PM decision A and Product Owner decision 5651663038 — READ THE AUTHORIZATION RUN FROM GITHUB IN
             * NODE, BEFORE ANY NAVIGATION (PM decision 5651684739: the authorization run is THIS run attempt). The page-writable Boolean arm is retired in the product and never returns
             * here. The run must be this in-progress, owner-dispatched and owner-triggered rc-gates.yml attempt, and its
             * artifact must name this exact take (candidate, `open_mic`, origin) with a run-generated
             * nonce. A refusal HOLDs with a named reason and no switch is attempted, so missing, stale or inconsistent
             * authority is never reported as a candidate or product failure. This diagnostic creates and qualifies
             * NO six-cell evidence; only the trusted observer receipt and the terminal validator can.
             */
            const holdNow = (hold: DiagnosticHold, problems: readonly string[]): Error => {
                testInfo.annotations.push({ type: 'hold', description: hold });
                return new Error(diagnosticHoldMessage(hold, problems));
            };
            const authorizationText = readOperatorFile(AUTHORIZATION_FILE);
            if (AUTHORIZATION_FILE && authorizationText === null) {
                throw holdNow('comparison_authorization_unreadable', ['the authorization minted by this run could not be read']);
            }
            // GitHub's own record of this run attempt and its jobs: repository owner, dispatched ref and revision (which must
            // be the release), actor and triggering actor. The minted file is compared against it, never trusted alone.
            let runBundle: Awaited<ReturnType<typeof loadRunAuthority>> | null = null;
            if (authorizationText && AUTHORIZATION_RUN_ID && /^\d{1,20}$/.test(AUTHORIZATION_RUN_ID)
                && AUTHORIZATION_RUN_ATTEMPT && /^\d{1,4}$/.test(AUTHORIZATION_RUN_ATTEMPT)) {
                try {
                    const artifact = JSON.parse(authorizationText) as unknown;
                    runBundle = await loadRunAuthority({
                        runId: Number(AUTHORIZATION_RUN_ID),
                        runAttempt: Number(AUTHORIZATION_RUN_ATTEMPT),
                        githubGet: githubApiGetter({ token: RUN_READ_TOKEN }),
                        fetchRunArtifact: () => Promise.resolve(artifact),
                    });
                } catch {
                    runBundle = null;
                }
            }
            const authorization = diagnosticAuthorizationFor({
                authorizationText,
                runId: AUTHORIZATION_RUN_ID,
                runAttempt: AUTHORIZATION_RUN_ATTEMPT,
                bundle: runBundle,
                target,
                origin: APPROVED_ORIGIN,
                now: Date.now(),
                check: checkRunAuthority,
            });
            if (!authorization.ok) throw holdNow(authorization.hold, authorization.problems);
            const { authority } = authorization;

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
                    coachingObservedAt.set(request, Date.now());
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
                        // The run-issued take join and its evidence document — opaque ids, never content.
                        comparisonNonce: text('comparison_nonce'),
                        evidenceDocumentId: text('comparison_evidence_document_id'),
                    });
                }
            });
            const settleCoachingRequest = (request: Request) => {
                const observedAt = coachingObservedAt.get(request);
                if (observedAt === undefined) return;
                coachingObservedAt.delete(request);
                const startTime = request.timing().startTime;
                coachingRequests.push(startTime > 0 ? startTime : observedAt);
            };
            page.on('requestfinished', settleCoachingRequest);
            page.on('requestfailed', settleCoachingRequest);

            await test.step('canonical Production on a REAL route, before any credential', async () => {
                // `/auth/signin` is the route App.tsx:439 defines. The previous head used `/auth/login`,
                // which does not exist, and passed anyway because a 404 shell satisfies origin/release/mock
                // checks. The response status and the not-found shell are both checked now.
                const response = await page.goto('/auth/signin');
                // The repository's centralized readiness authority comes FIRST: `data-app-ready`, then
                // `data-app-visible-ready`, then a shell with non-empty text. AGENTS.md is explicit that a
                // selector is not readiness proof, and a form can be visible while the app has not declared
                // the route committed. Recorded as a fact rather than thrown, so the pure verdict decides and
                // the failure message stays content-free.
                const appVisibleReady = await waitForAppVisibleReady(page, 45_000)
                    .then(() => true)
                    .catch(() => false);
                // Then the route's OWN content, so a blank or still-loading shell cannot be read as a
                // rendered surface. `auth-form` is SignInPage.tsx:167.
                // `isVisible()` returns immediately and ignores its timeout, so it would read a page that is
                // still hydrating as unrendered. `waitFor` actually waits.
                const routeMarkerVisible = await page.getByTestId('auth-form')
                    .waitFor({ state: 'visible', timeout: 30_000 })
                    .then(() => true)
                    .catch(() => false);
                const observed = await page.evaluate(() => {
                    const w = window as unknown as Record<string, unknown> & { __APP_RELEASE__?: string };
                    return {
                        origin: location.origin,
                        pathname: location.pathname,
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
                    observedPathname: observed.pathname,
                    routeMarkerVisible,
                    appVisibleReady,
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

                /*
                 * #1432 PM decision A — THE VERIFIED RUN AUTHORIZATION ENTERS ONLY THE /practice DOCUMENT. The authorization is
                 * one-use and every document boot consumes it; arming the earlier /auth/signin document would spend
                 * the nonce there and leave /practice refused as a replay. Injected immutable and non-enumerable,
                 * exactly as the trusted observer arms a page.
                 */
                await page.addInitScript(({ key, authorization }) => {
                    if (location.pathname !== '/practice') return;
                    Object.defineProperty(globalThis, Symbol.for(key), {
                        value: authorization, enumerable: false, configurable: true, writable: false,
                    });
                }, { key: MODEL_COMPARISON_AUTH_KEY, authorization: authority.authorization });
                await page.goto('/practice');
                // FAIL FAST. The previous head burned 900s on a wrong route because nothing asserted the
                // surface was present. A missing practice root now fails in seconds with a readable reason.
                await expect(page.getByTestId('practice-root'), 'authenticated practice surface must load').toBeVisible({ timeout: 60_000 });
            });

            /*
             * WORKSTREAM 2 — THE EXPLICIT TARGET (Codex `3997967389`), under #1432 PM decision A. The switch sets the
             * acquisition expectation BEFORE it initialises, so the acquisition that follows is bound to this target.
             * It runs IMMEDIATELY after the authorized surface installs and BEFORE default-model preparation, so the
             * acquisition that follows is this target's. Only the outcome CODE crosses back. A surface that never
             * installs, or a deployed release other than the authorized one, HOLDs before any switch is attempted.
             */
            let switchOutcome = 'not_attempted';
            await test.step(`switch to the explicit target ${target} under the verified authority, before model preparation`, async () => {
                const surfaceInstalled = await expect
                    .poll(async () => page.evaluate(
                        () => typeof (window as unknown as { __SS_SWITCH_CANDIDATE__?: unknown }).__SS_SWITCH_CANDIDATE__,
                    ), { timeout: 60_000 })
                    .toBe('function')
                    .then(() => true)
                    .catch(() => false);
                if (!surfaceInstalled) {
                    throw holdNow('comparison_surface_not_installed', ['the page did not accept the run authorization (release, origin or replay)']);
                }
                const deployedRelease = await page.evaluate(
                    () => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null,
                );
                if (deployedRelease !== authority.releaseSha) {
                    throw holdNow('deployed_release_mismatch', ['the deployed release is not the release the authorization run named']);
                }
                switchOutcome = await page.evaluate(async ({ id, journey }) => {
                    const w = window as unknown as {
                        __SS_SWITCH_CANDIDATE__?: (candidate: string, journey: string) => Promise<{ ok: boolean; code?: string }>;
                    };
                    const result = await w.__SS_SWITCH_CANDIDATE__!(id, journey);
                    return result.ok ? 'ok' : (result.code ?? 'unknown_failure');
                }, { id: target, journey: DIAGNOSTIC_JOURNEY });
                expect(switchOutcome, `the guarded switch to ${target} must succeed`).toBe('ok');
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
            /*
             * WORKSTREAM 1 — THE PRODUCT'S OWN SAVE BOUNDARY (Codex `3997967382`). The previous head took
             * `Date.now()` here, after the stop, the save wait and an attribute poll — and a correct automatic
             * request fired inside that gap was counted as pre-save. `syncSessionPersisted` stamps
             * `__SS_LAST_PERSISTED_SESSION__.at` at the moment of persistence; its id must name this session.
             */
            const persistenceMarker = await page.evaluate(() => {
                const marker = (window as unknown as { __SS_LAST_PERSISTED_SESSION__?: { id?: unknown; at?: unknown } })
                    .__SS_LAST_PERSISTED_SESSION__;
                return {
                    id: typeof marker?.id === 'string' ? marker.id : null,
                    at: typeof marker?.at === 'number' ? marker.at : null,
                };
            });
            const savedAt = persistenceMarker.at;

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
            /*
             * WORKSTREAM 1 — WAIT FOR THE WIRE, THEN FREEZE (Codex `3997967395`). The DOM turns terminal before
             * the terminal event leaves PostHog's batch queue, so counting here commonly saw no outcome at all.
             * Poll, bounded, for a terminal event on THIS take's attempt, keep observing to the deadline so a same-take
             * duplicate anywhere in the window is counted, then take one frozen snapshot that everything below reads.
             */
            // The saved take — journey AND attempt — is discovered INSIDE the bounded poll (Codex `3998069827`):
            // `session_saved` rides the same async queue, so it may not be on the wire when the DOM turns terminal.
            const flush = await awaitCorrelatedTerminal(() => captured, savedCorrelationsOf, {
                timeoutMs: 30_000,
                intervalMs: 500,
                now: () => Date.now(),
                sleep: (ms) => page.waitForTimeout(ms),
            });
            const frozen = flush.events;
            // Exactly-one counting runs only over terminal events of THIS take — journey and attempt.
            // The pair LOCKED by the wait (Codex `3998202205`) — never re-derived from the snapshot.
            const take = flush.take;
            const terminalEvents = frozen.filter((event) =>
                (event.name === 'practice_loop_review_rendered' || event.name === 'practice_loop_review_failed')
                && take !== null && event.attemptId === take.attemptId && event.journeyId === take.journeyId);
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
            const firstInteractionAfterSave = savedAt === null ? null : inputAfterSave.find((at) => at > savedAt) ?? null;

            /*
             * PERSISTED identity. `engine` is the product facade — every Private candidate reports
             * `private` — so the candidate discriminator is `engine_version`/`model_name`, which is what
             * `complete_session_v2` persists via `p_engine_version` (Codex `3996845174`). Only identity
             * columns are selected; the transcript and the coaching text are never read.
             */
            /*
             * WORKSTREAM 3 — TRUSTED ATTRIBUTION ONLY (Codex `3997967394`). `attribution_status` is selected and
             * the verdict refuses anything but `verified`. The server attestation is the sole writer of that
             * verdict and can complete after the persisted marker appears, so the row is re-read, bounded, while
             * it is still `pending` — reading it once would report a correct take as unverified.
             */
            let persistedIdentity: PersistedIdentity = { engineVersion: null, modelName: null, attributionStatus: null };
            if (savedSessionId) {
                const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
                const attributionDeadline = Date.now() + 90_000;
                for (;;) {
                    const { data, error } = await admin
                        .from('sessions')
                        .select('id,engine_version,model_name,attribution_status')
                        .eq('id', savedSessionId)
                        .single();
                    if (error) throw new Error(`persisted read failed (fail closed): ${error.code ?? 'unknown'}`);
                    persistedIdentity = {
                        engineVersion: (data?.engine_version as string | null) ?? null,
                        modelName: (data?.model_name as string | null) ?? null,
                        attributionStatus: (data?.attribution_status as string | null) ?? null,
                    };
                    if (persistedIdentity.attributionStatus !== 'pending' || Date.now() > attributionDeadline) break;
                    await page.waitForTimeout(3_000);
                }
            }

            // CONFIGURED and ACQUIRED come from the acquisition event the allowlist publishes precisely so a
            // readback can prove configured = acquired = running for a three-model down-selection.
            // Observed identity only from events AFTER the acquisition the switch bound to THIS target — the
            // default engine's earlier acquisition can never lend its identity, even when target == default.
            const observedCandidate = observedCandidateAfterSwitch(frozen, target);
            // RUNNING identity is switch-bound too (PM `5649623145` item 3) — it feeds `boundCandidateId`.
            const runningCandidate = runningCandidateAfterSwitch(frozen, target);
            const requestCounts = classifyRequestsByBoundary(coachingRequests, savedAt);

            const reviewEvents = frozen.filter((event) => event.name.startsWith('practice_loop_review_'));
            const takeEvents = frozen.filter((event) => event.name === 'session_started' || event.name === 'session_saved');
            const distinct = (values: Array<string | undefined>) =>
                [...new Set(values.filter((value): value is string => Boolean(value)))];

            const evidence: PracticeLoopJourneyEvidence = {
                savedSessionId: savedSessionId ?? null,
                sessionSaved: Boolean(savedSessionId),
                persistenceBoundary: { markerSessionId: persistenceMarker.id, at: savedAt },
                suggestionRequests: requestCounts.after,
                suggestionRequestsBeforeSave: requestCounts.atOrBefore,
                manualGenerationTriggered: firstInteractionAfterSave !== null
                    && coachingRequests.some((at) => at > (firstInteractionAfterSave as number)),
                renderedPhraseCounts: { whatWentWell, whatToImprove },
                terminalOutcomes,
                terminalFlushSettled: flush.settled,
                additionalSavedTakes: flush.additionalSavedTakes,
                candidateSwitch: { target, outcome: switchOutcome },
                observedCandidate,
                persistedIdentity,
                telemetry: {
                    events: frozen.map((event) => event.name),
                    stagesReached: distinct(frozen.map((event) => event.stage)),
                    boundCandidateId: runningCandidate,
                    attemptIds: distinct(reviewEvents.map((event) => event.attemptId)),
                    journeyIds: distinct(reviewEvents.map((event) => event.journeyId)),
                },
                authorization: {
                    comparisonNonce: authority.comparisonNonce,
                    evidenceDocumentId: authority.evidenceDocumentId,
                    releaseSha: authority.releaseSha,
                },
                takeTelemetry: {
                    comparisonNonces: distinct(takeEvents.map((event) => event.comparisonNonce)),
                    evidenceDocumentIds: distinct(takeEvents.map((event) => event.evidenceDocumentId)),
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
    }
});
