/**
 * RWT PRODUCT 1 — OPEN MIC, FIRST SESSION (PO script RWT_TWO_PRODUCT_USER_JOURNEY, rows 1–7; #1258).
 *
 * One new person's first Open Mic session on canonical Production, in the order they experience it:
 *   1. sign up (and sign back in through the real form);
 *   2. reach Open Mic without the microphone opening on navigation;
 *   3. first microphone use — the model the product actually acquires, and how long it takes;
 *   4. speak the pinned corpus — fillers seen vs saved vs the corpus's ground truth;
 *   5. Stop — the session saves and exactly two coaching phrases (about 8–10 words each: a soft target that is measured, not a validity rule) render on their own; they are
 *      distinct and equal the saved coaching response;
 *   6. the session in Analytics — same transcript (by digest) and both saved AI suggestions, before and after
 *      a reload; then Back to Dashboard and a PDF that carries the saved transcript (the PO's manual v12 order);
 *   7. Share feedback, after Analytics — acknowledged and stored once; the marked report is retained by product policy.
 * plus the next Start (no Progress hold) and the telemetry this journey sent, for the PostHog readback.
 *
 * INDEPENDENT of the Focus Points suite: own account, own fixture, own receipt, own cleanup.
 *
 * VERDICTS. Every row is PASS, FAIL or HOLD. A FAIL is a finding about the product and turns the test red. A HOLD
 * is an evidence state — something this run cannot establish (a synthetic "uh" no recognizer hears, speech
 * specificity that needs a human reader, the base_q4 primary the switch cannot select yet) — and is never a pass.
 * Coaching is never stubbed: if the #1473 path fails on Production, this suite fails visibly.
 *
 * DISPATCH (Production writes to one disposable account; needs PO authorization per run):
 *   rc-gates.yml  gate=gate-3-dast  diagnostic_dast_spec=tests/live/rwt-open-mic-first-session.live.spec.ts
 *                 rwt_writes_ack=RWT-DISPOSABLE-ACCOUNT-WRITES  [comparison_cell=v4:distil:q4/open_mic]
 * With no comparison cell the run records the deployed default and is labelled diagnostic.
 */
import { createClient } from '@supabase/supabase-js';
import { test } from './helpers/rwtProductionTest';
import { MainThreadTrace, TRACE_OP_TIMEOUT_MS, TRACE_START_WORST_CASE_MS, TRACE_STOP_WORST_CASE_MS, boundedStopWithTrace, withDeadline } from './helpers/rwtMainThreadTrace';
import { DiagnosticRecord, ProcessSampler, diagnosticWindowFor, requireWindowBudget, runBoundedWindow } from './helpers/rwtDiagnosticWindow';
import { readFillerBreakdown } from './helpers/rwtFillerBreakdown';
import { expect, type Response } from '@playwright/test';
import {
    selectBenchmarkMode,
    preparePrivateModelIfPrompted,
    waitForPrivateEngineReady,
    startBenchmarkRecording,
    stopBenchmarkRecording,
    waitForBenchmarkSaveCandidate,
} from './helpers/benchmark-utils';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import { transientPrivateDir } from './helpers/rwtTransientFile';
import { MODEL_COMPARISON_AUTH_KEY } from './helpers/practiceLoopJourney';
import { canonicalizeForLeakCheck, extractPdfText } from '../helpers/pdfText';
import {
    AnalyticsTap,
    RWT_ACCOUNT_PREFIX,
    RwtReceipt,
    requireApprovedSurface,
    armCandidateSwitch,
    countWords,
    installMicAcquisitionCounter,
    loadRwtFixture,
    markRunOwnedAccountCanary,
    micAcquisitions,
    newDisposableEmail,
    nextStartEvidence,
    nextStartRows,
    practiceAgainEvidence,
    practiceAgainRows,
    productMarkerRows,
    modelIdentityRow,
    acquisitionTimingRow,
    shareFeedbackRows,
    openProductsMenuInPlace,
    feedbackRetentionAfterDeletionRow,
    analyticsRows,
    analyticsThroughActions,
    humanObservation,
    normalisePhraseText,
    performCandidateSwitch,
    readSttIdentity,
    readCpuRuntime,
    receiptContentLeaks,
    resolveRunTarget,
    rwtLaunchArgs,
    rwtPreconditionFailures,
    sha256Hex,
    signUpDisposableAccount,
    suppressPageSnapshot,
    telemetryClassRows,
    canaryClaimRow,
    EntitlementTap,
    expectedReleaseSha,
    entitlementRow,
    runOwnedIdentityFailures,
    type RunTarget, readCoachingFailureReason, settleCoachingReason, COACHING_REASON_UNKNOWN, bandSide,
    writeCoachingTextForRunSummary,
} from './helpers/rwtJourney';
import { bindReadbackJourneys, takeStartedAfter, practiceArrivalVerdict, feedbackOutcomeVerdict } from './helpers/rwtOracles';

const SUITE = 'open-mic-first-session';
/** #1258: Stop plus the saved-candidate wait have 180 s inside; the page itself must answer well before this bound. */
const STOP_BOUND_MS = 240_000;
/**
 * #1258 (run 36930648785): every live-page read has its own bound. The deployed-live config sets no action timeout, so
 * an unbounded read of an element the page no longer renders waited forever — that was the reproduced "freeze".
 */
const LIVE_READ_TIMEOUT_MS = 15_000;
/** The whole after-Stop FillerBreakdown read: visible wait (60 s) + bounded row and stats reads, under one deadline. */
const BREAKDOWN_READ_BOUND_MS = 120_000;
/**
 * #1258 follow-up (run 36863804680 hung after the take began and wrote nothing): a Node-side deadline around the WHOLE
 * traced take → Stop window — trace start, the speech wait, the live reads and Stop — that fires whether or not the page
 * or browser answers. Its wanted and minimum-useful bounds come from `diagnosticWindowFor` (both include the worst-case
 * trace start; the wanted bound also the worst-case trace stop after Stop), and it is always short of the outer test timeout.
 */
const windowBounds = (speechSeconds: number) => diagnosticWindowFor(speechSeconds, {
    stopBoundMs: STOP_BOUND_MS, traceStartWorstCaseMs: TRACE_START_WORST_CASE_MS, traceStopWorstCaseMs: TRACE_STOP_WORST_CASE_MS,
});
/** Bound on the deadline collection: the trace stop (end + complete + cleanup, 3 × op bound) plus the page fence. */
const DEADLINE_COLLECTION_MS = 3 * TRACE_OP_TIMEOUT_MS + 30_000;
/** Kept free before the outer timeout: the deadline collection, then the receipt `finally` and account cleanup. */
const WINDOW_RESERVE_MS = DEADLINE_COLLECTION_MS + 60_000;
/** External process/resource sampling interval (#1258 PM 5932271540: modest, not profiling). */
const PROC_SAMPLE_MS = 5_000;
const JOURNEY = 'open_mic';
/** PO 2026-10-02: about 8-10 words per phrase is a SOFT target (the Edge contract's `wordTarget`), measured — never a failure. */
const COACHING_WORD_TARGET = 10;
/** #1258 (Codex r4188372867): ABOUT 8-10 words — a shorter phrase is not within the target. */
const COACHING_WORD_TARGET_MIN = 8;
/** Accepted headings (runbook (3) row 5: Akin also accepts "What to try next"). */
const WELL_HEADINGS = ['What went well'] as const;
const NEXT_HEADINGS = ['Try this next run', 'What to try next'] as const;
/** Same phrase, ignoring case, spacing and trailing punctuation. */
const samePhrase = (a: string, b: string): boolean =>
    normalisePhraseText(a) !== '' && normalisePhraseText(a) === normalisePhraseText(b);
/** The words checked per key: spoken form → persisted `filler_counts` key (contracts/fillerCounts.ts). */
const FILLER_KEY: Record<string, string> = { um: 'um', uh: 'uh', ah: 'ah', 'you know': 'you_know' };
/**
 * The coachable headline counts the TRUE filler tier only (fillerWordUtils.isCoachableFillerKey: um/uh/ah for an
 * account with no custom words). "you know" is tracked per key but excluded from the headline (PM ruling 2026-09-24).
 */
const COACHABLE_KEYS = ['um', 'uh', 'ah'] as const;
const normaliseKey = (word: string): string => word.trim().toLowerCase().replace(/\s+/g, '_');
/** Occurrences of a spoken filler in text — counted in Node, never stored. */
const occurrences = (text: string, spoken: string): number =>
    (text.toLowerCase().match(new RegExp(`\\b${spoken.replace(/\s+/g, '\\s+')}\\b`, 'g')) ?? []).length;
/** WebGPU runs need a GPU-capable runner; GitHub's hosted Linux runners have none. Declared, never inferred. */
const WEBGPU = process.env.RWT_WEBGPU === '1';

const fixture = loadRwtFixture('open_mic_tts');
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

test.use({
    permissions: ['microphone'],
    // Signup types a password into the page and, afterwards, the DOM holds transcript and coaching text: no trace,
    // video or screenshot, ever (same rule as the practice-loop journey).
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: WEBGPU }) },
});

test.describe('RWT — Open Mic first session @live', () => {
    let activeSampler: ProcessSampler | null = null;
    let createdEmail = '';
    let capturedUid = '';
    let feedbackReportId: string | null = null;
    let accountDeletedInTest = false;

    test.afterEach(async () => {
        // Backstop: the sampler stops in the test's own finally; this covers a body that never reached it.
        activeSampler?.stop();
        activeSampler = null;
        // Only the run-owned account is deleted (PM contract #1258 §3). The feedback report is retained by product
        // policy (user_issue_reports.user_id is SET NULL on account deletion); the test body deletes the account first
        // and proves that retention (#1532 Codex P1 r4105978630). This is the fallback when the body did not.
        if (!accountDeletedInTest) {
            await cleanupRunOwnedAccount({ admin: admin as never, capturedUid, createdEmail, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
        }
        createdEmail = '';
        capturedUid = '';
        feedbackReportId = null;
        accountDeletedInTest = false;
    });

    test('a new person completes a first Open Mic session end to end', async ({ page, browser }, testInfo) => {
        test.setTimeout(1_500_000); // cold model acquisition + a 60 s take + coaching + Analytics + feedback
        const testStartedAt = Date.now();

        const preconditions = rwtPreconditionFailures();
        if (preconditions.length > 0) throw new Error(`HOLD preconditions: ${preconditions.join('; ')}`);
        // Refused authorization is a named HOLD before any navigation — never a model or product finding.
        const run: RunTarget = await resolveRunTarget(JOURNEY);

        const receipt = new RwtReceipt(SUITE);
        receipt.forbid(SERVICE_ROLE);
        receipt.meta.fixture = fixture.key;
        receipt.meta.fixtureKind = fixture.entry.kind;
        receipt.meta.fixtureSha256 = fixture.entry.kind === 'human' ? '(private)' : fixture.entry.sha256;
        receipt.meta.target = run.label;
        receipt.meta.webgpu = WEBGPU;
        // #1258: durable, content-free diagnostic evidence, written now and on every update (file + job log), so a hang
        // that never reaches the receipt below still leaves its classification behind.
        const diag = new DiagnosticRecord(SUITE, { release: expectedReleaseSha() });
        diag.update({ diag_window: 'not_entered' });
        const sampler = new ProcessSampler(diag, { suite: SUITE });
        activeSampler = sampler;
        receipt.row('base_q4 primary', 'HOLD', 'the one-run switch cannot select v4 base_q4 yet; this run is not base_q4 evidence');

        const tap = new AnalyticsTap();
        tap.attach(page);
        const entitlement = new EntitlementTap();
        entitlement.attach(page);
        await installMicAcquisitionCounter(page);
        await armCandidateSwitch(page, run, MODEL_COMPARISON_AUTH_KEY);
        const coaching: { status: number | null; requests: number; reason: string | null; reasonRead: Promise<void> | null } = { status: null, requests: 0, reason: null, reasonRead: null };
        page.on('response', (response: Response) => {
            if (response.url().includes('/functions/v1/get-ai-suggestions') && response.request().method() === 'POST') {
                coaching.status = response.status();
                // #1258: a failed generation names its closed, content-free reason in the receipt.
                if (response.status() >= 400) coaching.reasonRead = readCoachingFailureReason(response).then((r) => { coaching.reason = r; });
                coaching.requests += 1; // runbook v12: Analytics must never request coaching again
            }
        });

        await suppressPageSnapshot(testInfo);

        let persistedId: string | null = null;
        // The take's own generation count, snapshotted before the Practice-again pass records more takes.
        let generationsForTake: number | null = null;
        // #1532 Codex P1 r4124290575: sent-stream windows around each take's Start, so the takes are identified by the Start the
        // page sent (takeStartedAfter), independently of whether their saves arrive.
        let firstTakeFrom = 0;
        let repeatWindow: [number, number] | null = null;
        let stoppedAt = 0;
        let transcriptDigest = ''; // compared in Node only; never written to the receipt
        let transcriptCanonical = ''; // in memory only, for the PDF match; never written anywhere
        let claimed = false;
        // Coaching text, in memory only for the visible/saved/after-reload comparisons; never written anywhere.
        let shownWell = '';
        let shownNext = '';
        let savedWell = '';
        let savedNext = '';
        try {
            // ── Row 1 — sign up, then sign back in through the real form ────────────────────────────────
            await test.step('row 1 — sign up and sign in', async () => {
                await page.goto('/auth/signup');
                await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
                await requireApprovedSurface(page, receipt);
                createdEmail = newDisposableEmail('open-mic');
                receipt.forbid(createdEmail);
                const account = await signUpDisposableAccount(page, createdEmail);
                capturedUid = account.uid;
                const identity = await runOwnedIdentityFailures(admin as never, capturedUid, createdEmail);
                if (identity.length > 0) throw new Error(`FAIL first-visit identity: ${identity.join('; ')}`);
                receipt.row('signup', 'PASS', 'fresh account created through the real form; UID, email and profile verified', { signupMs: account.signupMs });
                claimed = await markRunOwnedAccountCanary(admin as never, capturedUid, createdEmail);
                receipt.meta.canaryClaim = claimed;
                const { signinMs } = await account.signOutAndSignIn();
                await canaryClaimRow(page, receipt, claimed);
                receipt.row('sign-in', 'PASS', 'signed out and back in through the real form', { signinMs });
            });

            // ── Row 2 — Open Mic, and the microphone stays closed on navigation ─────────────────────────
            await test.step('row 2 — reach Open Mic; no microphone on navigation', async () => {
                await page.goto('/practice');
                await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 60_000 });
                const switched = await performCandidateSwitch(page, run, JOURNEY);
                receipt.meta.switchOutcome = switched;
                if (run.mode === 'switch' && switched !== 'ok') throw new Error(`HOLD candidate switch: ${switched}`);
                // The runbook's path: the header's Products → Open Mic (a client-side navigation, so the one-run
                // switch made on this /practice document still governs the take).
                const desktop = page.getByTestId('nav-products-button');
                if (await desktop.isVisible().catch(() => false)) {
                    await desktop.click();
                    await page.getByTestId('nav-products-open-mic').click();
                } else {
                    await page.getByTestId('nav-mobile-products-button').click();
                    await page.getByTestId('nav-mobile-products-open-mic').click();
                }
                const reached = await page.waitForURL(/\/session/, { timeout: 45_000 }).then(() => true).catch(() => false);
                receipt.row('Products → Open Mic', reached ? 'PASS' : 'FAIL', reached ? 'the header Products menu opened Open Mic' : 'Products → Open Mic did not reach the session');
                if (!reached) throw new Error('FAIL Products → Open Mic');
                await page.waitForTimeout(3_000); // give an eager acquisition time to show itself
                const opened = (await micAcquisitions(page)).length;
                receipt.row('no mic on navigation', opened === 0 ? 'PASS' : 'FAIL',
                    opened === 0 ? 'reaching Open Mic did not open the microphone' : 'the microphone opened before any consent or Start',
                    { acquisitionsBeforeConsent: opened });
            });

            // ── Row 3 — first microphone use: model identity and acquisition time ───────────────────────
            let takeAlreadyRunning = false;
            firstTakeFrom = tap.events.length;
            // Sampling runs from model acquisition through Stop, so growth before the take is visible too.
            sampler.start(PROC_SAMPLE_MS);
            diag.mark('row3_entered');
            await test.step('row 3 — first microphone use and model acquisition', async () => {
                const began = Date.now();
                await selectBenchmarkMode(page, 'private');
                const setup = await preparePrivateModelIfPrompted(page, 900_000);
                takeAlreadyRunning = setup.recordingAlreadyStarted;
                if (!takeAlreadyRunning) await waitForPrivateEngineReady(page, 600_000);
                const acquisitionMs = Date.now() - began;
                modelIdentityRow(receipt, run, await readSttIdentity(page), acquisitionMs, await readCpuRuntime(page));
            });

            // Entitlement as the page received it, before the take writes anything (one ~50 s take + next Start).
            await entitlementRow(receipt, entitlement, 120);

            // ── Row 4 — the take ────────────────────────────────────────────────────────────────────────
            let visibleFillers: number | null = null;
            const liveDisplay: Record<string, number> = {};   // the per-word counts the person sees (after Stop: FillerBreakdown)
            const liveMarks: Record<string, number> = {};     // the highlighted words in the live transcript
            // #1258 Stop-stall diagnostic: one content-free browser-level trace across the take and Stop (summary → meta and
            // the diagnostic record). Recording it is idempotent and bounded, so every exit path below may ask for it.
            let mainThreadTrace: MainThreadTrace | null = null;
            const recordTrace = async () => {
                if (!mainThreadTrace) return;
                const summary = await mainThreadTrace.stop();
                Object.assign(receipt.meta, summary);
                diag.update(summary);
            };
            diag.mark('row3_done');
            // #1549 Codex P1 r4157529415: never longer than the test has left; too little left → durable HOLD-shaped exit now.
            const windowBoundMs = requireWindowBudget(diag, {
                ...windowBounds(fixture.entry.speechSeconds),
                remainingMs: testInfo.timeout - (Date.now() - testStartedAt),
                reserveMs: WINDOW_RESERVE_MS,
            });
            try {
                await runBoundedWindow({
                    boundMs: windowBoundMs,
                    record: diag,
                    body: async () => {
                        const started = await MainThreadTrace.start(browser);
                        mainThreadTrace = started.trace;
                        receipt.meta.trace_state = started.trace_state;
                        receipt.meta.trace_cleanup = started.trace_cleanup;
                        diag.update({ trace_state: started.trace_state, trace_cleanup: started.trace_cleanup });
                        diag.mark('trace_start_settled');
                        await test.step('row 4 — speak the corpus', async () => {
                            if (!takeAlreadyRunning) await startBenchmarkRecording(page, SUITE);
                            diag.mark('row4_take_running');
                            // Stop inside the fixture's 15 s trailing silence: all speech, and never a second loop of it.
                            await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
                            diag.mark('row4_speech_wait_done');
                            for (const text of await page.getByTestId('live-filler').allInnerTexts()) {
                                const key = normaliseKey(text.replace(/[^a-z\s]/gi, ''));
                                liveMarks[key] = (liveMarks[key] ?? 0) + 1;
                            }
                            diag.mark('row4_live_fillers_read');
                            const markTotal = Object.values(liveMarks).reduce((a, b) => a + b, 0);
                            receipt.row('live filler highlighting', markTotal > 0 ? 'PASS' : 'FAIL',
                                markTotal > 0 ? 'fillers were highlighted in the live transcript' : 'no filler was highlighted live',
                                { liveFillerMarks: markTotal });
                            // #1258: the during-state shows fillers only as transcript highlights (above). The per-word counts
                            // and the filler headline are read after Stop from FillerBreakdown, where the person sees them — the
                            // during-state badges and `filler-count-value` belonged to the retired FillerWordsCard.
                            diag.mark('row4_done');
                        });

                        // ── Row 5 — Stop ────────────────────────────────────────────────────────────────────
                        await test.step('row 5 — Stop', async () => {
                            stoppedAt = Date.now();
                            diag.mark('row5_stop_entered');
                            // Bounded: whether Stop succeeds, rejects or hangs, the trace is recorded before the step continues or fails.
                            await boundedStopWithTrace(() => stopBenchmarkRecording(page, SUITE, 180_000), STOP_BOUND_MS, recordTrace);
                            diag.mark('row5_stop_settled');
                        });
                    },
                    onDeadlineBoundMs: DEADLINE_COLLECTION_MS,
                    onDeadline: async () => {
                        await recordTrace();
                        // Fence the abandoned window: closing the page rejects every page operation it is still awaiting.
                        await withDeadline(() => page.close(), 15_000);
                    },
                });
            } finally {
                // A Row-4 failure never reached Stop's own recording; ask once more (idempotent, bounded).
                await withDeadline(recordTrace, TRACE_STOP_WORST_CASE_MS);
                // #1549 Codex P1 r4158574092: the process peaks describe the first-take window only — never coaching, PDF
                // or the repeat recording. The outer finally and afterEach remain the backstop for an earlier failure.
                sampler.stop();
            }

            // ── Row 5 — save, and coaching that arrives on its own ─────────────────────────────────────
            await test.step('row 5 — save and two coaching phrases', async () => {
                await waitForBenchmarkSaveCandidate(page, SUITE, 180_000);
                await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 120_000 });
                persistedId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
                const saveMs = Date.now() - stoppedAt;
                receipt.row('session saved', persistedId ? 'PASS' : 'FAIL', persistedId ? 'the take saved' : 'no persisted session id', { saveMs });
                if (!persistedId) return;
                // Saved EXACTLY once: this new account must hold one completed session, not a duplicate save.
                const { count: saved, error: savedErr } = await admin!.from('sessions').select('id', { count: 'exact', head: true })
                    .eq('user_id', capturedUid).eq('status', 'completed');
                if (savedErr) throw new Error(`saved-session count failed (fail closed): ${savedErr.code ?? 'unknown'}`);
                receipt.row('saved exactly once', saved === 1 ? 'PASS' : 'FAIL',
                    saved === 1 ? 'one completed session exists for this take' : 'the take was not saved exactly once', { completedSessions: saved ?? null });

                // #1258: the per-word counts and the headline the person sees after Stop (FillerBreakdown). The whole read
                // runs inside one outer deadline (#1550 Codex P1 r4161811889): a missing or stalled display leaves them
                // unset, so the filler rows below FAIL visibly instead of waiting.
                const breakdown = await readFillerBreakdown(page, {
                    boundMs: BREAKDOWN_READ_BOUND_MS, visibleTimeoutMs: 60_000, readTimeoutMs: LIVE_READ_TIMEOUT_MS, normaliseKey,
                });
                receipt.meta.fillerBreakdownRead = breakdown.state;
                if (breakdown.state === 'read') {
                    Object.assign(liveDisplay, breakdown.perWord);
                    visibleFillers = breakdown.headline;
                }

                const card = page.getByTestId('ai-suggestions-card');
                const terminal = await expect.poll(async () => card.getAttribute('data-review-state', { timeout: LIVE_READ_TIMEOUT_MS }).catch(() => null), { timeout: 180_000 })
                    .toMatch(/^(ready|error|empty)$/).then(() => true).catch(() => false);
                const state = await card.getAttribute('data-review-state', { timeout: LIVE_READ_TIMEOUT_MS }).catch(() => null);
                const coachingMs = Date.now() - stoppedAt;
                // The text is held in memory for the Node-side comparisons below and never written to the receipt.
                const phrase = async (headings: readonly string[]): Promise<string> => {
                    for (const heading of headings) {
                        const title = page.getByRole('heading', { name: heading, exact: true });
                        if ((await title.count()) === 0) continue;
                        const block = card.locator('div', { has: title }).last();
                        return (await block.locator('p').first().innerText({ timeout: LIVE_READ_TIMEOUT_MS }).catch(() => '')).trim();
                    }
                    return '';
                };
                shownWell = await phrase(WELL_HEADINGS);
                shownNext = await phrase(NEXT_HEADINGS);
                receipt.forbid(shownWell, shownNext);
                const well = shownWell ? countWords(shownWell) : null;
                const next = shownNext ? countWords(shownNext) : null;
                const twoPhrases = state === 'ready' && well !== null && next !== null;
                const inTarget = (n: number) => n >= COACHING_WORD_TARGET_MIN && n <= COACHING_WORD_TARGET;
                const withinTarget = twoPhrases && inTarget(well!) && inTarget(next!);
                // The reason is read before its row is written; a read still pending at the bound is UNKNOWN, never `null`.
                if (!(await settleCoachingReason(coaching.reasonRead))) coaching.reason = COACHING_REASON_UNKNOWN;
                receipt.row('coaching rendered', terminal && twoPhrases ? 'PASS' : 'FAIL',
                    twoPhrases ? 'exactly two coaching phrases rendered without any click' : `coaching did not render (state=${String(state)}, http=${String(coaching.status)})`,
                    { reviewState: state, httpStatus: coaching.status, failureReason: coaching.reason, stopToCoachingMs: coachingMs });
                receipt.row('coaching length', twoPhrases ? 'PASS' : 'HOLD',
                    !twoPhrases ? 'no phrases to measure'
                        : withinTarget ? `both phrases within the ${COACHING_WORD_TARGET_MIN}-${COACHING_WORD_TARGET}-word target`
                            : `served whole; a phrase is outside the ${COACHING_WORD_TARGET_MIN}-${COACHING_WORD_TARGET}-word band (${bandSide(well!, next!, COACHING_WORD_TARGET_MIN, COACHING_WORD_TARGET)}; a quality measure, not a failure)`,
                    { wellWords: well, nextWords: next, withinTarget });
                const distinct = twoPhrases && samePhrase(shownWell, shownNext) === false;
                receipt.row('coaching phrases distinct', distinct ? 'PASS' : twoPhrases ? 'FAIL' : 'HOLD',
                    distinct ? 'the two phrases are different suggestions' : twoPhrases ? 'both headings show the same phrase' : 'no phrases to compare');

                // The visible text must BE the saved coaching response, field for field (compared in Node only).
                const { data: savedRow, error: savedAiErr } = await admin!.from('sessions').select('ai_suggestions')
                    .eq('id', persistedId).eq('user_id', capturedUid).single();
                if (savedAiErr) throw new Error(`saved coaching read failed (fail closed): ${savedAiErr.code ?? 'unknown'}`);
                const savedAi = (savedRow?.ai_suggestions ?? null) as { what_worked?: unknown; what_to_try_next?: unknown } | null;
                savedWell = typeof savedAi?.what_worked === 'string' ? savedAi.what_worked.trim() : '';
                savedNext = typeof savedAi?.what_to_try_next === 'string' ? savedAi.what_to_try_next.trim() : '';
                receipt.forbid(savedWell, savedNext);
                writeCoachingTextForRunSummary(receipt, { shownWell, shownNext, savedWell, savedNext });
                const wellMatches = savedWell !== '' && samePhrase(shownWell, savedWell);
                const nextMatches = savedNext !== '' && samePhrase(shownNext, savedNext);
                receipt.row('coaching visible = saved', wellMatches && nextMatches ? 'PASS' : twoPhrases ? 'FAIL' : 'HOLD',
                    wellMatches && nextMatches ? 'both visible phrases equal the saved coaching response'
                        : savedWell === '' || savedNext === '' ? 'the session row holds no complete saved coaching response'
                            : 'a visible phrase differs from the saved coaching response',
                    { wellMatchesSaved: wellMatches, nextMatchesSaved: nextMatches, savedResponsePresent: savedWell !== '' && savedNext !== '' });
                humanObservation(receipt, 'open_mic_coaching_relevant', 'Product 1 row 5', 'coaching is about this speech',
                    'each phrase relates to what was said in this take — not generic advice');

                const { data: authority, error } = await admin!.from('ai_suggestion_authority_receipts')
                    .select('session_id,provider_request_made').eq('session_id', persistedId).eq('user_id', capturedUid).maybeSingle();
                if (error) throw new Error(`coaching receipt query failed (fail closed): ${error.code ?? 'unknown'}`);
                receipt.row('coaching server receipt', authority?.provider_request_made ? 'PASS' : twoPhrases ? 'FAIL' : 'HOLD',
                    authority ? 'the server recorded the provider request for this session' : 'no server receipt for this session');
            });

            // ── Row 4 (continued) — fillers: seen vs saved vs the corpus ────────────────────────────────
            await test.step('row 4 — fillers against the saved row and the corpus', async () => {
                if (!persistedId) { receipt.row('fillers', 'HOLD', 'no saved session to compare'); return; }
                const { data: row, error } = await admin!.from('sessions').select('filler_counts,transcript')
                    .eq('id', persistedId).eq('user_id', capturedUid).single();
                if (error) throw new Error(`session read failed (fail closed): ${error.code ?? 'unknown'}`);
                const counts = (row?.filler_counts ?? {}) as Record<string, number>;
                const transcript = String(row?.transcript ?? '');
                receipt.meta.transcriptWords = countWords(transcript);
                transcriptDigest = sha256Hex(transcript);
                transcriptCanonical = canonicalizeForLeakCheck(transcript);

                // Per word: what the transcript contains, what the live display showed, what was saved.
                for (const [spoken, key] of Object.entries(FILLER_KEY)) {
                    const inTranscript = occurrences(transcript, spoken);
                    const marked = liveMarks[key] ?? 0;
                    const saved = counts[key] ?? 0;
                    // #1550 Codex P1 r4161436378: the review (FillerBreakdown) renders only COACHABLE keys. A discourse
                    // marker such as "you know" is counted and saved per key but never displayed there by design, so its
                    // display is not compared; transcript vs saved still is.
                    const rendered = (COACHABLE_KEYS as readonly string[]).includes(key);
                    const shown = rendered ? liveDisplay[key] ?? 0 : null;
                    const consistent = (!rendered || shown === saved) && saved === inTranscript;
                    receipt.row(`filler "${spoken}": transcript / display / saved`, consistent ? 'PASS' : 'FAIL',
                        consistent
                            ? rendered ? 'the transcript, the displayed breakdown and the saved count agree'
                                : 'the transcript and the saved count agree (a discourse marker: tracked, not shown in the review by design)'
                            : rendered && shown !== saved ? 'the count the person saw differs from the count saved (misleading display)'
                                : 'the saved count differs from the words in the saved transcript',
                        { transcript: inTranscript, liveHighlighted: marked, displayed: rendered ? shown : null, displayRendered: rendered, saved });
                }
                // Keys displayed that the saved row does not carry (or vice versa) are also a misleading display.
                const shownOnly = Object.keys(liveDisplay).filter((k) => (counts[k] ?? 0) !== liveDisplay[k]);
                receipt.row('filler display matches saved (all words)', shownOnly.length === 0 ? 'PASS' : 'FAIL',
                    shownOnly.length === 0 ? 'every displayed word count equals its saved count' : 'a displayed word count differs from its saved count',
                    { mismatchedWords: shownOnly.length });

                // The coachable headline: um + uh + ah only; "you know" tracked but excluded.
                const coachable = COACHABLE_KEYS.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
                const headlineOk = visibleFillers === coachable;
                const includesYouKnow = (counts.you_know ?? 0) > 0 && visibleFillers === coachable + (counts.you_know ?? 0);
                receipt.row('coachable filler headline', headlineOk ? 'PASS' : 'FAIL',
                    headlineOk ? 'the headline equals the saved um+uh+ah (you know excluded)'
                        : includesYouKnow ? 'the headline counts "you know", which is not coachable' : 'the headline differs from the saved coachable count',
                    { headline: visibleFillers, coachable, youKnowTracked: counts.you_know ?? 0 });

                // Against the corpus. Synthetic "uh" is a HOLD, never a pass; the run never claims all eight were heard.
                for (const [spoken, expected] of Object.entries(fixture.entry.groundTruthFillers ?? {})) {
                    const inTranscript = occurrences(transcript, spoken);
                    const limited = fixture.entry.kind === 'synthetic' && spoken === 'uh';
                    if (limited) {
                        // Synthetic audio cannot prove "uh"; the human-spoken take is the acceptance check (runbook row 4).
                        humanObservation(receipt, 'open_mic_uh_detected', 'Product 1 row 4', 'spoken "uh" detected and saved (human speech)',
                            `every spoken "uh" (${expected}) is marked live and saved`);
                        continue;
                    }
                    receipt.row(`filler "${spoken}" vs corpus`, inTranscript === expected ? 'PASS' : 'FAIL',
                        inTranscript === expected ? 'the transcript holds every spoken instance' : 'the transcript misses or adds instances',
                        { expected, transcript: inTranscript });
                }
            });

            await test.step('Products menu opened on the session page (inventory, recording journey)', async () => {
                // #1532 Codex P1 r4121232419: emitted inside the recording journey (a product route; nothing navigates), where the
                // analytics_inventory stage proves it was received.
                const opened = await openProductsMenuInPlace(page);
                receipt.row('Products menu opened in the session', opened ? 'PASS' : 'FAIL',
                    opened ? 'the header Products menu opened and closed on the session page' : 'the header Products menu could not be opened on the session page');
            });

            // ── Row 6 — Analytics through the on-screen action; a PDF that carries the saved transcript ─
            await test.step('row 6 — Analytics action, PDF, session detail and reload', async () => {
                if (!persistedId) { receipt.row('analytics', 'HOLD', 'no saved session'); return; }
                // With a complete saved response, the detail must also show both suggestions before and after its reload.
                const savedCoaching = savedWell !== '' && savedNext !== '' ? { well: savedWell, next: savedNext } : undefined;
                if (!savedCoaching) receipt.row('analytics detail shows both AI suggestions', 'HOLD', 'no saved coaching response to look for');
                let pdfAttempted = false;
                const downloadPdf = async (): Promise<void> => {
                    pdfAttempted = true;
                    // v12 row 6 order (PM RETURN 5870036039): after the detail's reload, the person returns with the detail's own
                    // "Back to Dashboard" control and downloads THIS session's PDF from the list. The reload minted a new journey;
                    // the session_pdf_export stage is bound to wherever session_pdf_downloaded actually lands (pdfExport binding).
                    const back = page.getByRole('link', { name: 'Back to Dashboard' });
                    const returned = await back.click({ timeout: 20_000 }).then(() => page.waitForURL(/\/analytics(\?|$|#)/, { timeout: 30_000 }))
                        .then(() => true).catch(() => false);
                    if (!returned) { receipt.row('session PDF', 'FAIL', 'the detail\'s Back to Dashboard control did not return to the Analytics list'); return; }
                    const button = page.getByTestId(`download-pdf-btn-${persistedId}`).or(page.getByTestId(`download-pdf-btn-mobile-${persistedId}`)).first();
                    const offered = await button.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
                    if (!offered) { receipt.row('session PDF', 'FAIL', 'no PDF download offered for this session'); return; }
                    // Outside every uploaded path (#1532 Codex P1 r4126003354): a killed run skips `finally`.
                    const transient = transientPrivateDir('pdf');
                    const file = transient.file('rwt-session.pdf');
                    try {
                        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), button.click()]);
                        await download.saveAs(file);
                        const text = await extractPdfText(file).catch(() => '');
                        // The saved transcript, canonicalized (case, spacing, punctuation, split text runs), must be in the
                        // PDF. Compared in Node only; neither text reaches the receipt or any artifact.
                        const carries = transcriptCanonical !== '' && canonicalizeForLeakCheck(text).includes(transcriptCanonical);
                        receipt.row('session PDF', carries ? 'PASS' : 'FAIL',
                            carries ? 'the exported PDF contains the saved session transcript' : text.trim() ? 'the PDF does not contain the saved transcript' : 'the PDF did not open or has no text',
                            { pdfWords: countWords(text) });
                    } finally {
                        transient.remove(); // holds transcript text; removed on success and failure
                    }
                };
                const requestsBeforeAnalytics = coaching.requests;
                // Open Mic evidence is the stored delivery measurement ("6.2 filler words a minute, above your target").
                analyticsRows(receipt, await analyticsThroughActions(page, persistedId, transcriptDigest, savedCoaching, /\ba minute\b/i, downloadPdf));
                receipt.row('Analytics generates no coaching', coaching.requests === requestsBeforeAnalytics ? 'PASS' : 'FAIL',
                    coaching.requests === requestsBeforeAnalytics ? 'opening and reloading Analytics requested no new review'
                        : 'Analytics requested coaching again (regeneration / quota)',
                    { coachingRequestsBefore: requestsBeforeAnalytics, coachingRequestsAfter: coaching.requests });
                // Fail closed: the PDF is attempted only after the detail and its reload; never reaching them is a FAIL row, not a missing one.
                if (!pdfAttempted) receipt.row('session PDF', 'FAIL', 'the saved session was not reached in Analytics, so no PDF was attempted');
            });

            // ── Row 7 — Share feedback — AFTER Analytics, in the PO's manual v12 order (PM RETURN 5870036039). The row-6 reload
            // minted a new journey, so feedback is bound and qualified there for its own stages (share_feedback); the recording
            // journey keeps the take, the Products menu and the first saved-review revisit; the PDF binds where it lands. ───────────────────────────
            await test.step('row 7 — share feedback', async () => {
                feedbackReportId = await shareFeedbackRows(page, receipt, admin as never, capturedUid);
            });

            // ── The next Start is not held behind the Progress evaluation (#1471) ───────────────────────
            // ── Progress: the saved session was evaluated and owes nothing (#1471 / #1521) ─────────────
            await test.step('Progress evaluation recorded; nothing owed', async () => {
                if (!persistedId) { receipt.row('Progress evaluation', 'HOLD', 'no saved session'); return; }
                // Recorded at save or by the page's bounded retry; before #1521 a current-shape save failed with 23502.
                const evaluated = await expect.poll(async () => {
                    const { count, error } = await admin!.from('session_progress_evaluations')
                        .select('session_id', { count: 'exact', head: true })
                        .eq('session_id', persistedId).eq('user_id', capturedUid);
                    if (error) throw new Error(`evaluation query failed (fail closed): ${error.code ?? 'unknown'}`);
                    return count ?? 0;
                }, { timeout: 90_000 }).toBe(1).then(() => true).catch(() => false);
                receipt.row('Progress evaluation', evaluated ? 'PASS' : 'FAIL',
                    evaluated ? 'the saved session has exactly one Progress evaluation' : 'the saved session was not evaluated');
                // The same predicate get_progress_obligations uses: a completed session of this account with no evaluation.
                const { data: completed, error: cErr } = await admin!.from('sessions').select('id')
                    .eq('user_id', capturedUid).eq('status', 'completed');
                if (cErr) throw new Error(`completed-session query failed (fail closed): ${cErr.code ?? 'unknown'}`);
                const { data: rows, error: eErr } = await admin!.from('session_progress_evaluations').select('session_id')
                    .eq('user_id', capturedUid);
                if (eErr) throw new Error(`evaluation list failed (fail closed): ${eErr.code ?? 'unknown'}`);
                const done = new Set((rows ?? []).map((r) => r.session_id as string));
                const owed = (completed ?? []).filter((r) => !done.has(r.id as string)).length;
                receipt.row('Progress debt', owed === 0 ? 'PASS' : 'FAIL',
                    owed === 0 ? 'no completed session is still owed an evaluation' : 'a completed session is still owed an evaluation', { owed });
            });

            // ── Practice again through the rendered controls: Analytics → take → the review's own repeat (#1533) ───
            await test.step('Practice again — Analytics action, then the completed review\'s repeat action', async () => {
                generationsForTake = tap.sent('practice_loop_review_requested').length;
                if (!persistedId) {
                    practiceAgainRows(receipt, 'open_mic', { analyticsActionOpened: null, sameSetPending: null, reviewReached: null, afterActionEnabledMs: null, holdSeen: false, afterStartMs: null, stopped: false, liveTracksAfterStop: null, reason: 'no saved session', savedSessionId: null, actionBefore: null, actionAfter: null });
                    await productMarkerRows(receipt, admin as never, capturedUid, 'open_mic', []);
                    return;
                }
                const repeatFrom = tap.events.length;
                let saveTakeEnd = -1;
                const again = await practiceAgainEvidence(page, `${SUITE}-again`, persistedId, 'open_mic', [], () => { saveTakeEnd = tap.events.length; });
                // The window closes at the SAVE take's Stop, so the review's repeat Start can never stand in for it.
                repeatWindow = [repeatFrom, saveTakeEnd >= 0 ? saveTakeEnd : tap.events.length];
                practiceAgainRows(receipt, 'open_mic', again);
                // #1258 / #1537: every session this journey saved (its take + the Practice-again take) is marked Open Mic.
                await productMarkerRows(receipt, admin as never, capturedUid, 'open_mic', [persistedId, again.savedSessionId]);
            });

            await test.step('next Start without a hold', async () => {
                const next = await nextStartEvidence(page, `${SUITE}-next`);
                nextStartRows(receipt, next);
            });
        } finally {
            // #1258: stop sampling and carry the diagnostic record (content-free by construction) into the receipt.
            sampler.stop();
            activeSampler = null;
            Object.assign(receipt.meta, diag.snapshot());
            // ── Telemetry sent by this journey, for the PostHog readback ────────────────────────────────
            const { userJourneys } = telemetryClassRows(receipt, tap, claimed);
            receipt.row('telemetry sent', tap.sent('session_saved').length > 0 && tap.sent('feedback_submit').length > 0 ? 'PASS' : 'FAIL',
                'session_saved and feedback_submit left the page (sent, not yet received)',
                { sessionSaved: tap.sent('session_saved').length, feedbackSubmit: tap.sent('feedback_submit').length });
            // #1258 (#1563 closure): the outcome telemetry must CORRELATE, not merely be sent — each Practice-again press
            // reached its intended route (same action_seq), and each Share Feedback attempt resolved (same submit_seq).
            // Sent here; received is the deployed PostHog readback. Closed enums and integers only.
            const practiceArrival = practiceArrivalVerdict(tap.events);
            receipt.row('Practice again press → arrival (sent)', practiceArrival.verdict, practiceArrival.detail, practiceArrival.evidence);
            const feedbackOutcome = feedbackOutcomeVerdict(tap.events);
            receipt.row('feedback outcome (sent)', feedbackOutcome.verdict, feedbackOutcome.detail, feedbackOutcome.evidence);
            // Coaching telemetry the page SENT. RECEIVED is proven by the PostHog readback of the declared
            // session_after_open_mic stage: its post-Stop chain requires a received stage_latency "review_rendered", which
            // the app emits only once a validated two-phrase review is on screen.
            const reviewRendered = tap.sent('stage_latency').filter((e) => e.stage === 'review_rendered').length;
            const coachingEvents = {
                requested: tap.sent('practice_loop_review_requested').length,
                completed: tap.sent('practice_loop_review_completed').length,
                persisted: tap.sent('practice_loop_review_persisted').length,
                rendered: tap.sent('practice_loop_review_rendered').length,
                failed: tap.sent('practice_loop_review_failed').length,
                reviewRenderedStage: reviewRendered,
            };
            const coachingSent = coachingEvents.completed > 0 && coachingEvents.persisted > 0 && coachingEvents.rendered > 0 && reviewRendered > 0;
            receipt.row('coaching telemetry sent', coachingSent ? 'PASS' : 'FAIL',
                coachingSent ? 'review completed, persisted and rendered left the page (sent; received is the session_after_open_mic readback)'
                    : 'a coaching outcome event did not leave the page', coachingEvents);
            // PM 2026-09-25 inventory decisions: these controls now send their own content-free events. SENT here;
            // RECEIVED is the deployed PostHog readback for this journey.
            const inventory = {
                productsMenuOpened: tap.sent('products_menu_opened').length,
                pdfDownloaded: tap.sent('session_pdf_downloaded').length,
                savedReviewRevisited: tap.sent('saved_review_revisited').length,
                reviewGenerationsRequested: tap.sent('practice_loop_review_requested').length,
            };
            receipt.row('inventory events sent', inventory.productsMenuOpened > 0 && inventory.pdfDownloaded > 0 && inventory.savedReviewRevisited > 0 ? 'PASS' : 'FAIL',
                'products_menu_opened, session_pdf_downloaded and saved_review_revisited left the page (sent; received is qualified by the analytics_inventory stage in the recording journey and the session_pdf_export stage in the journey the PDF landed in)', inventory);
            // Counted up to the Practice-again pass: that pass records its own take, which generates its own review.
            const generationsForFirstTake = generationsForTake ?? inventory.reviewGenerationsRequested;
            receipt.row('revisit is not a generation', generationsForFirstTake === 1 ? 'PASS' : 'FAIL',
                generationsForFirstTake === 1 ? 'one generated review for the take; the Analytics revisits added none'
                    : 'the generation count is not exactly one for this take', { reviewGenerationsRequested: generationsForFirstTake });
            // Page reload has no click event by PM decision; it is proven by the persistence rows ("reopen after reload",
            // "analytics detail shows both AI suggestions").
            const leaks = receiptContentLeaks(receipt, [createdEmail, SERVICE_ROLE, shownWell, shownNext, savedWell, savedNext].filter(Boolean));
            receipt.row('receipt content-free', leaks.length === 0 ? 'PASS' : 'FAIL', leaks.length === 0 ? 'no credential, email or coaching text in the receipt' : 'the receipt carried a forbidden value');
            // v12 preflight: first-use model download vs engine setup, from the app's own acquisition receipt.
            acquisitionTimingRow(receipt, tap, tap.journeyIds());
            // Feedback retention is proven only after the run-owned account is deleted (#1532 Codex P1 r4105978630).
            accountDeletedInTest = await feedbackRetentionAfterDeletionRow(receipt, admin as never, feedbackReportId,
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid, createdEmail, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
            receipt.write(testInfo, bindReadbackJourneys(tap.events, {
                recording: ['session_during', 'session_after_open_mic', 'analytics_inventory'], repeatRecording: ['session_during', 'session_after_open_mic'],
                takes: {
                    first: takeStartedAfter(tap.events, firstTakeFrom, repeatWindow?.[0] ?? tap.events.length),
                    repeat: repeatWindow ? takeStartedAfter(tap.events, repeatWindow[0], repeatWindow[1]) : null,
                },
                feedback: true, pdfExport: true, practiceAgain: true,
            }),
                tap.trafficTypes(), userJourneys);
        }
    });
});
