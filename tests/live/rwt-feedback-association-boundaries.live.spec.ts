/**
 * RWT gap coverage — deployed older-take and no-session feedback association.
 *
 * This file is intentionally independent of App Dev's #1587 files. It uses the real deployed UI,
 * a per-test disposable account, the accepted run-owned cleanup helper, and content-free receipts.
 * It is preparation only: do not dispatch without a fresh release-bound RWT authorization.
 */
import { createClient } from '@supabase/supabase-js';
import type { APIResponse, ConsoleMessage, Page, Route, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/rwtProductionTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RWT_CANARY_CLAIM_ACK_VALUE,
    RwtReceipt, canaryClaimAuthorized, expectedReleaseSha, feedbackRetentionAfterDeletionRow,
    installMicAcquisitionCounter, loadRwtFixture, markRunOwnedAccountCanary, newDisposableEmail,
    requireApprovedSurface, rwtLaunchArgs, rwtPreconditionFailures, runOwnedIdentityFailures, suppressPageSnapshot,
    signUpDisposableAccount, telemetryClassRows,
} from './helpers/rwtJourney';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { CoachingGenerationTap } from './helpers/coachingGenerationTap';
import { feedbackDiagnosticChainRow } from './helpers/coachingFeedbackAdapter';
import { coachingRequestBudgetRow } from './helpers/rwtCoachingCollector';
import {
    ACK_COPY, ACK_TOAST, FEEDBACK_INSERT_URL, FeedbackInsertObserver, PREVIOUS_ACK_ATTR, markEarlierAcknowledgments, observeFreshAcknowledgment,
    readStoredDiagnosticRef, writeFreshAcknowledgmentRow,
    writeNoSessionReportRows, writeOlderTakeBindingRow, writeOlderTakeReportRows, writeReceivedFeedbackRow,
    type FreshAcknowledgmentObservation, type ReceiptRowSink, type StoredFeedbackReport,
} from './helpers/feedbackDiagnosticRef';
import {
    FEEDBACK_FAULT_LEGS, FEEDBACK_ISOLATION_ROW, FeedbackAttemptLedger, type FeedbackFaultLeg, type LegObservation, type RowVerdict,
    feedbackLedgerVerdict, feedbackLegDescription, feedbackLegRecovered, finalIsolationVerdict, isNamedIdempotencyReplay, syntheticRejection,
    withoutFaultLegSubmits, writeFeedbackAttemptRows, writeFeedbackLegRows,
} from './helpers/feedbackAttemptLedger';
import { ZERO_RESIDUE_ROW } from './helpers/feedbackReportCleanup';
import { NO_SESSION_ATTEMPT_CAP, noSessionWriteDecision } from './helpers/feedbackNoSessionCleanup';
import { HarnessParityTap, START_CONTROLS } from './helpers/rwtHarnessParity';
import { JourneyFeedbackFence } from './helpers/feedbackFence';
import {
    J8_FENCE_CASE, J8_FENCE_KEY_CAP, J8_LEGS, J8_LEGACY_REFUSAL, J8_SUITE, type J8Leg, J8WriteGate, type J8WriteOutcome, TAKE_PROJECTION_FIELDS, j8AdmissionPresent, j8RunnerAdmission,
    j8bFinalSentFeedbackVerdict, legReadback, legReceipt, legSink, mergeLegReadback, readTakeDigests, takesReadComplete, takesUnchangedVerdict, writerDrainedVerdict,
    type StartPressCounts, legStartPressVerdict, startPressSnapshot,
} from './helpers/rwtJ8Journey';
import { readFileSync } from 'node:fs';
import { currentRunBinding } from './helpers/runBinding';
import { coachingContract } from './helpers/rwtCoachingEvidence';
import { openProductsItem } from './helpers/productsMenu';
import { FINALIZE_CLEANUP_MS, FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, aliveReceipt, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
import {
    expectBenchmarkRecordingStarted, preparePrivateModelIfPrompted, selectBenchmarkMode, startBenchmarkRecording,
    stopBenchmarkRecording, waitForBenchmarkSaveCandidate, waitForPrivateEngineReady,
} from './helpers/benchmark-utils';

const SUITE = 'feedback-association-boundaries';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
const fixture = loadRwtFixture('open_mic_tts');

// The two deployed checks each bind exactly one share_feedback action, matching the current readback contract.
test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});
// AHT-07's one-run write limit (Sam, 2026-11-11): a failed run is never re-driven inside the same authorization.
test.describe.configure({ mode: 'serial', retries: 0 });
/** #1811: AHT-07's fence key cap equals its route's distinct-key cap (four), so the route always refuses first. */
const AHT07_FENCE_KEY_CAP = 4;
/** #1811: the bounds step reads in-process counts. */
const FEEDBACK_FENCE_STEP_MS = 10_000;

type Owner = { email: string; uid: string };

async function prepareDisposable(page: Page, receipt: RwtReceipt, owner: Owner, runnerEmail?: string): Promise<boolean> {
    // Sam on 27ee1856: only the J8 journey (which passes the runner's reserved email) may sign up under a J8 admission.
    if (runnerEmail === undefined && j8AdmissionPresent(process.env)) {
        receipt.halt('preflight', `HOLD before Production writes: ${J8_LEGACY_REFUSAL}`);
        return false;
    }
    const missing = rwtPreconditionFailures();
    if (!canaryClaimAuthorized() || process.env.RWT_CANARY_CLAIM_ACK !== RWT_CANARY_CLAIM_ACK_VALUE) {
        missing.push('AUTHORIZATION GATE: the separate run-owned canary-claim acknowledgement is absent');
    }
    if (missing.length > 0) {
        receipt.halt('preflight', `HOLD before Production writes: ${missing.join('; ')}`);
        return false;
    }
    await installMicAcquisitionCounter(page);
    await page.goto('/auth/signup');
    await requireApprovedSurface(page, receipt);
    // J8: the email is the lookup reference the named runner recorded for this account-create BEFORE the signup (Sam on 94fe88d7).
    owner.email = runnerEmail ?? newDisposableEmail('feedback-boundary');
    receipt.forbid(owner.email, SERVICE_ROLE);
    const account = await signUpDisposableAccount(page, owner.email);
    owner.uid = account.uid;
    // The account id reaches receipt evidence through the fence, feedback and readback helpers: the leak guard must know it, so an
    // uploaded receipt that carries it is replaced by the redacted failure receipt. (The password never leaves the signup closure.)
    receipt.forbid(owner.uid);
    const identity = await runOwnedIdentityFailures(admin as never, owner.uid, owner.email);
    if (identity.length > 0) throw new Error(`run-owned identity preflight failed: ${identity.join('; ')}`);
    receipt.row('run-owned signup', 'PASS', 'fresh disposable account and profile verified');
    const claimed = await markRunOwnedAccountCanary(admin as never, owner.uid, owner.email);
    if (!claimed) {
        receipt.halt('canary claim', 'HOLD before qualifying traffic: the run-owned canary claim was not applied');
        return false;
    }
    await account.signOutAndSignIn();
    const hasClaim = await page.evaluate(() => Object.keys(localStorage).some((key) => {
        if (!/^sb-.*-auth-token$/.test(key)) return false;
        try { return JSON.parse(localStorage.getItem(key) ?? '{}').user?.app_metadata?.canary === true; }
        catch { return false; }
    }));
    receipt.row('canary claim in fresh login', hasClaim ? 'PASS' : 'FAIL', hasClaim
        ? 'fresh sign-in carries the run-owned server-issued canary claim' : 'fresh sign-in lacks the run-owned canary claim');
    if (!hasClaim) {
        receipt.halt('canary claim', 'HOLD before scenario traffic: the fresh-login canary claim was absent');
        return false;
    }
    return true;
}

async function createSavedOpenMicTake(
    page: Page,
    index: number,
    first: boolean,
): Promise<string> {
    const previousSessionId = first ? null : await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
    if (first) {
        await selectBenchmarkMode(page, 'private');
        const setup = await preparePrivateModelIfPrompted(page, 900_000);
        if (!setup.recordingAlreadyStarted) {
            await waitForPrivateEngineReady(page, 600_000);
            await startBenchmarkRecording(page, `feedback-boundary-${index}`);
        }
    } else {
        // Codex P1 r4247193659: after the first save the page is in its AFTER state, where the before-state `mic-start`
        // is not rendered. The person starts the next take with the completed review's own repeat action — the same
        // control the core journeys use (`practiceAgainEvidence`).
        const again = page.getByTestId('verdict-practice-again');
        await expect(again).toBeEnabled({ timeout: 120_000 });
        await again.click();
        await expectBenchmarkRecordingStarted(page, `feedback-boundary-${index}`);
    }
    await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
    await stopBenchmarkRecording(page, `feedback-boundary-${index}`, 180_000);
    await waitForBenchmarkSaveCandidate(page, `feedback-boundary-${index}`, 180_000);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 120_000 });
    if (previousSessionId) {
        await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id')),
            { timeout: 120_000 }).not.toBe(previousSessionId);
    }
    const sessionId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
    if (!sessionId) throw new Error('the take did not expose its persisted session identity');
    await expect.poll(async () => page.getByTestId('ai-suggestions-card').getAttribute('data-review-state').catch(() => null),
        { timeout: 180_000 }).toMatch(/^(ready|error|blocked)$/);
    return sessionId;
}

/**
 * AHT-08's own observations of the submit. Absent (AHT-07), the submit runs exactly as before. Both are called before the
 * acknowledgement can throw, so their rows are written whatever the submit's outcome.
 */
interface SubmitObservers {
    /** The submit's telemetry window: the `feedback_submit` count and the time just before the Submit click. */
    onSubmitted(submitted: { feedbackBefore: number; submitAt: number }): void;
    /** Earlier toasts are marked before the click; then the dialog's detach and an unmarked acknowledgment are observed. */
    onFreshAcknowledgment(observation: FreshAcknowledgmentObservation): void;
}

async function submitFeedback(
    page: Page,
    tap: AnalyticsTap,
    uid: string,
    association: 'selected_older_session' | 'no_session' | 'no_session_with_takes',
    sessionId: string | null,
    newerSessionId?: string,
    observers?: SubmitObservers,
    listedTakes?: readonly [string, string],
): Promise<StoredFeedbackReport & { acknowledged: boolean }> {
    await page.goto('/analytics');
    await expect(page.getByTestId('nav-report-issue-button').first()).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('nav-report-issue-button').first().click();
    await expect(page.getByTestId('issue-report-dialog')).toBeVisible({ timeout: 20_000 });
    // The stored-report read is bound to THIS submit: the idempotency key the page's own feedback insert carries
    // (`issueReportService.submit` → POST /rest/v1/user_issue_reports, column `idempotency_key`). Observed on the whole
    // context from the open dialog until the read, so every Send of this draft is seen; one draft's Sends share one key.
    const inserts = new FeedbackInsertObserver(page.context());
    try {
        return await submitOpenDialog(page, tap, uid, association, sessionId, inserts, newerSessionId, observers, listedTakes);
    } finally {
        inserts.stop();
    }
}

async function submitOpenDialog(
    page: Page,
    tap: AnalyticsTap,
    uid: string,
    association: 'selected_older_session' | 'no_session' | 'no_session_with_takes',
    sessionId: string | null,
    inserts: FeedbackInsertObserver,
    newerSessionId?: string,
    observers?: SubmitObservers,
    listedTakes?: readonly [string, string],
): Promise<StoredFeedbackReport & { acknowledged: boolean }> {
    const selector = page.getByTestId('feedback-session-select');
    if (association === 'selected_older_session') {
        if (!sessionId) throw new Error('older-session case requires a saved older session id');
        await expect(selector.locator(`option[value="${sessionId}"]`)).toHaveCount(1);
        if (newerSessionId) {
            const order = await selector.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
            expect(order.indexOf(newerSessionId), 'the newest saved take should be listed before the older take').toBeGreaterThanOrEqual(0);
            expect(order.indexOf(newerSessionId)).toBeLessThan(order.indexOf(sessionId));
        }
        await selector.selectOption(sessionId);
    } else if (association === 'no_session_with_takes') {
        // J8.c (Sam, 2026-11-15): exactly "No session" plus the two distinct saved takes, each listed once; then No session.
        if (!listedTakes || new Set(listedTakes).size !== 2) throw new Error('J8.c requires the two distinct saved take ids');
        const values = await selector.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
        expect(values.filter((v) => v === '__none')).toHaveLength(1);
        for (const take of listedTakes) expect(values.filter((v) => v === take)).toHaveLength(1);
        expect(values).toHaveLength(3);
        await selector.selectOption('__none');
    } else {
        await expect(selector.locator('option[value="__none"]')).toHaveCount(1);
        await expect(selector.locator('option')).toHaveCount(1);
        await selector.selectOption('__none');
    }
    await page.getByTestId('feedback-type-broke').click();
    await page.getByTestId('issue-report-description').fill('Automated RWT feedback-association boundary check.');
    await tap.captureActionBindingSettled(page, 'share_feedback', expectedReleaseSha(), process.env.GITHUB_RUN_ID ?? '',
        process.env.GITHUB_RUN_ATTEMPT ?? '');
    // A missing action-time binding is retained as HOLD by bindReadbackJourneys; it must never be
    // guessed from a same-number or unrelated journey.
    const feedbackBefore = tap.sent('feedback_submit').length;
    // AHT-08 fresh acknowledgment: every toast already on the page is marked BEFORE the click, so only this submit's counts.
    const earlierAcks = observers ? await markEarlierAcknowledgments(page) : null;
    observers?.onSubmitted({ feedbackBefore, submitAt: Date.now() });
    await page.getByTestId('issue-report-submit').click();
    if (observers && earlierAcks) observers.onFreshAcknowledgment(await observeFreshAcknowledgment(page, earlierAcks));
    const acknowledged = await page.getByText('Thanks — we’ve got it.').first()
        .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    if (!acknowledged) throw new Error('the feedback acknowledgement was not shown');
    // #1258 (live round 1, run 38847643414): analytics are batched. Before this scenario reads, cleans up and closes the
    // page, wait (bounded) until this submission's feedback_submit events — `attempted` plus its outcome — have actually
    // LEFT the page (the main journeys' R8 settle), so the readback can receive them instead of losing them at unload.
    await tap.awaitObserved(page, { feedback_submit: feedbackBefore + 2 });
    // Stored rows = the owner's rows under the submit's observed key(s). With no observed key nothing is read: the
    // stored-once row HOLDs (never a PASS or FAIL from an unbound read by time window).
    const keys = [...inserts.keys];
    let rows: Array<{ id: unknown; session_id: unknown; metadata: unknown }> = [];
    if (keys.length > 0) {
        const { data, error } = await admin!.from('user_issue_reports')
            .select('id,session_id,metadata').eq('user_id', uid).in('idempotency_key', keys);
        if (error) throw new Error(`feedback row read failed (fail closed): ${error.code ?? 'unknown'}`);
        rows = data ?? [];
    }
    const row = rows.length === 1 ? rows[0] : null;
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
    const storedSession = typeof row?.session_id === 'string' ? row.session_id : null;
    // #1539 / #1491 6123627243: absent, valid and MALFORMED are distinct — a malformed stored link is never "no link".
    const diagnosticRef = readStoredDiagnosticRef(metadata);
    return { id: row ? String(row.id) : null, sessionId: storedSession, diagnosticRef, storedRows: rows.length,
        insertKeys: keys.length, insertRequests: inserts.insertRequests, unattributedInserts: inserts.unattributedInserts, acknowledged };
}

/**
 * AHT-08 pre-send bounds (ported from #1857; Sam's #1860 review): ONE route on the no-session journey's context sees every write
 * to `user_issue_reports`. Each is decided at entry (`noSessionWriteDecision`: one insert, one key, one same-key Retry) and sent
 * only while the fence is writable; anything else is aborted, never sent. The fence below it records what commits.
 */
async function installNoSessionWriteRoute(page: Page, fence: JourneyFeedbackFence): Promise<{ pending: () => number; refused: () => number }> {
    let ordinal = 0;
    let inFlight = 0;
    let refused = 0;
    const keysSeen: string[] = [];
    await page.context().route(FEEDBACK_INSERT_URL, async (route: Route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback();
        inFlight += 1;
        ordinal += 1;
        const decision = noSessionWriteDecision({ method: request.method(), body: () => request.postDataJSON(), ordinal, keysSeen });
        try {
            if (!fence.writable || decision.action === 'cap-abort') {
                refused += 1;
                return await route.abort('failed');
            }
            for (const key of decision.keys) if (!keysSeen.includes(key)) keysSeen.push(key);
            let response: APIResponse;
            try { response = await route.fetch(); } catch {
                // An unanswered forward may still have committed: the fence recorded it if so, and close serializes with it.
                return await route.abort('failed');
            }
            return await route.fulfill({ response });
        } catch {
            return undefined; // the page closed under the route
        } finally {
            inFlight -= 1;
        }
    });
    return { pending: () => inFlight, refused: () => refused };
}

/**
 * AHT-07 bounded writes (Sam's one-run limit, 2026-11-11): ONE route on the journey's browser context sees every write to
 * `user_issue_reports`, so a write from any page of the journey is counted. Each is recorded and decided by the ledger at entry,
 * BEFORE it can leave the browser: the pre-send cap aborts the 8th attempt and later, an unkeyed insert, a fifth distinct key and
 * any non-insert write (`route.abort()`, never sent); an armed leg's first insert gets its fault; everything else reaches the real
 * server through `route.fetch()` so the ledger keeps its answer, and the page gets that same answer. The precedent is AHT-06's
 * lost completion (rwt-save-retry-recovery.live.spec.ts: `route.fetch()` then `route.abort('failed')`).
 */
async function installFeedbackWriteRoute(page: Page, ledger: FeedbackAttemptLedger, fence: JourneyFeedbackFence): Promise<void> {
    await page.context().route(FEEDBACK_INSERT_URL, async (route: Route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback();
        return handleLedgerWrite(route, ledger, fence);
    });
}

/**
 * The AHT-07 ledger's handling of ONE write (shared by the AHT-07 route and J8.b's window of the J8 route). Returns how it ended,
 * so the J8 gate keeps an unknown server outcome unresolved (Sam on 94fe88d7); the AHT-07 route ignores it.
 */
async function handleLedgerWrite(route: Route, ledger: FeedbackAttemptLedger, fence: JourneyFeedbackFence): Promise<J8WriteOutcome> {
    const request = route.request();
    ledger.begin();
    // Recorded and decided here, before anything is sent.
    const attempt = ledger.admit(request.method(), () => request.postDataJSON());
    let outcome: J8WriteOutcome = 'unknown';
    try {
        // #1811 (Sam, #1859 review): the database fence is the durable record — every insert the account commits is recorded
        // in the same transaction, so a late commit stays locatable after this process exits. A write is sent only while the
        // fence is confirmed open and the writer has not been stopped; anything else is aborted, never sent.
        if (!fence.writable) {
            ledger.settle(attempt, { status: null, forwarded: false });
            outcome = 'aborted-unsent';
            await route.abort('failed');
            return outcome;
        }
        if (attempt.action === 'cap-abort' || attempt.action === 'fault-request-lost') {
            ledger.settle(attempt, { status: null, forwarded: false });
            outcome = 'aborted-unsent';
            await route.abort('failed');
            return outcome;
        }
        if (attempt.action === 'fault-synthetic-42501') {
            ledger.settle(attempt, { status: 403, forwarded: false });
            outcome = 'aborted-unsent';
            await route.fulfill(syntheticRejection(request.headers().origin));
            return outcome;
        }
        let response: APIResponse;
        try { response = await route.fetch(); } catch {
            // An unanswered forward may still have committed: the fence recorded it if so, and close serializes with it.
            ledger.settle(attempt, { status: null, forwarded: null });
            outcome = 'unknown';
            await route.abort('failed');
            return outcome;
        }
        const status = response.status();
        const key = attempt.keys.length === 1 ? attempt.keys[0] : null;
        const replayNamed = status === 409 ? isNamedIdempotencyReplay(await response.text().catch(() => null), key) : null;
        ledger.settle(attempt, { status, forwarded: true, replayNamed });
        // stored-response-lost: the server stored the row (201); only its answer is dropped. The commit was OBSERVED here.
        if (attempt.action === 'fault-stored-response-lost') {
            outcome = status >= 200 && status < 300 ? 'committed-response-dropped' : 'answered';
            await route.abort('failed');
            return outcome;
        }
        outcome = 'answered';
        await route.fulfill({ response });
        return outcome;
    } catch {
        // The page closed under the route: the attempt is already in the ledger; the outcome decided so far stands.
        return outcome;
    } finally {
        ledger.end();
    }
}

/**
 * J8 (Sam, 2026-11-15): ONE route on the journey's context for all three legs. Each write is decided at entry and frozen to the
 * leg window open then (`J8WriteGate`): a write between windows or while an earlier one is unresolved is aborted unsent; J8.a and
 * J8.c are each bounded to one key and one same-key Retry of their OWN; J8.b's writes go through the AHT-07 ledger exactly as in
 * the older-take journey. Nothing is sent unless the journey's one `AHT-07+AHT-08` fence is confirmed writable.
 */
async function installJ8WriteRoute(page: Page, gate: J8WriteGate, ledger: FeedbackAttemptLedger, fence: JourneyFeedbackFence): Promise<void> {
    await page.context().route(FEEDBACK_INSERT_URL, async (route: Route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback();
        const decision = gate.enter(request.method(), () => request.postDataJSON());
        if (decision.action === 'abort') return route.abort('failed').catch(() => undefined);
        // Sam on 94fe88d7: only a known outcome releases the gate; a failed forward stays UNRESOLVED and blocks every later write
        // and the next leg (the fence records the commit if it lands, and its close serializes with it).
        let outcome: J8WriteOutcome = 'unknown';
        try {
            if (decision.action === 'ledger') {
                outcome = await handleLedgerWrite(route, ledger, fence);
                return undefined;
            }
            if (!fence.writable) {
                outcome = 'aborted-unsent';
                return await route.abort('failed');
            }
            let response: APIResponse;
            try { response = await route.fetch(); } catch {
                outcome = 'unknown';
                return await route.abort('failed');
            }
            outcome = 'answered';
            return await route.fulfill({ response });
        } catch {
            return undefined; // the page closed under the route: the outcome decided so far stands
        } finally {
            gate.settle(decision.attempt, outcome);
        }
    });
}

/**
 * One fault leg on a fresh document (its own boot and journey; the tab's sessionStorage keeps this login's saved takes, so the
 * older take stays selectable): one Submit that the route faults, the form read as the person sees it, then ONE explicit Retry
 * of the unchanged draft (marked immediately before its click), the dialog's close and acknowledgement, the leg's telemetry
 * settled before the next document, and the owner's rows under the leg's key. No `share_feedback` action is bound here, so no leg
 * reaches the readback journey. Content-free: booleans and counts only.
 */
async function runFeedbackFaultLeg(
    page: Page, tap: AnalyticsTap, ledger: FeedbackAttemptLedger, leg: FeedbackFaultLeg, olderId: string, uid: string, legJourneys: string[],
): Promise<LegObservation> {
    const feedbackBefore = tap.sent('feedback_submit').length;
    await page.goto('/analytics');
    await expect(page.getByTestId('nav-report-issue-button').first()).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('nav-report-issue-button').first().click();
    const dialog = page.getByTestId('issue-report-dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const description = feedbackLegDescription(leg);
    await page.getByTestId('feedback-session-select').selectOption(olderId);
    await page.getByTestId('feedback-type-broke').click();
    await page.getByTestId('issue-report-description').fill(description);
    const earlier = await markEarlierAcknowledgments(page);
    const fresh = page.locator(`${ACK_TOAST}:not([${PREVIOUS_ACK_ATTR}])`).filter({ hasText: ACK_COPY });
    const read = <T>(value: Promise<T>): Promise<T | null> => value.catch(() => null);
    let serviceErrors = 0;
    const onConsole = (message: ConsoleMessage) => {
        if (message.type() === 'error' && message.text().includes('[issueReportService.submit]')) serviceErrors += 1;
    };
    page.on('console', onConsole);
    let observation: Omit<LegObservation, 'storedRows' | 'storedSessionMatches' | 'serviceErrors' | 'telemetry'>;
    try {
        ledger.armLeg(leg);
        await page.getByTestId('issue-report-submit').click();
        const alert = dialog.getByRole('alert');
        const alertShown = await alert.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
        const descriptionValue = await read(page.getByTestId('issue-report-description').inputValue({ timeout: 5_000 }));
        const typeChecked = await read(page.getByTestId('feedback-type-broke').getAttribute('aria-checked', { timeout: 5_000 }));
        const sessionValue = await read(page.getByTestId('feedback-session-select').inputValue({ timeout: 5_000 }));
        const dialogVisible = await read(dialog.isVisible());
        const before = {
            alertShown,
            alertText: alertShown ? await read(alert.innerText({ timeout: 5_000 })) : null,
            dialogVisible,
            descriptionKept: descriptionValue === null ? null : descriptionValue === description,
            typeKept: typeChecked === null ? null : typeChecked === 'true',
            sessionKept: sessionValue === null ? null : sessionValue === olderId,
            submitEnabled: await read(page.getByTestId('issue-report-submit').isEnabled({ timeout: 5_000 })),
            freshBeforeRetry: await read(fresh.count()),
        };
        let retried = false;
        let dialogDetachedAfterRetry: boolean | null = null;
        let freshAfterRetry: number | null = null;
        // Only a failure the person can see is retried; otherwise the leg stops here (and the scenario after its rows).
        if (alertShown && dialogVisible === true) {
            ledger.markRetry();
            await page.getByTestId('issue-report-submit').click();
            retried = true;
            const after = await observeFreshAcknowledgment(page, earlier);
            dialogDetachedAfterRetry = after.dialogDetached;
            freshAfterRetry = await read(fresh.count());
        }
        observation = { ...before, retried, dialogDetachedAfterRetry, freshAfterRetry };
        // The leg's attempted/storage_failed/attempted/storage_ok leave THIS document before the next one starts.
        await tap.awaitObserved(page, { feedback_submit: feedbackBefore + 4 });
    } finally {
        page.off('console', onConsole);
        ledger.endWindow();
    }
    const events = tap.sent('feedback_submit').slice(feedbackBefore);
    for (const e of events) if (e.journeyId && !legJourneys.includes(e.journeyId)) legJourneys.push(e.journeyId);
    const outcome = (o: string) => events.filter((e) => e.fields?.outcome === o).length;
    const first = ledger.legAttempts(leg)[0];
    const key = first && first.keys.length === 1 ? first.keys[0] : null;
    let storedRows: number | null = null;
    let storedSessionMatches: boolean | null = null;
    if (key) {
        const { data, error } = await admin!.from('user_issue_reports').select('id,session_id').eq('user_id', uid).eq('idempotency_key', key);
        if (!error && Array.isArray(data)) {
            storedRows = data.length;
            storedSessionMatches = data.length === 1 ? data[0].session_id === olderId : null;
        }
    }
    return { ...observation, storedRows, storedSessionMatches, serviceErrors,
        telemetry: { attempted: outcome('attempted'), storageFailed: outcome('storage_failed'), storageOk: outcome('storage_ok') } };
}

async function finishReceipt(
    receipt: RwtReceipt,
    testInfo: TestInfo,
    tap: AnalyticsTap,
    claimed: boolean,
    steps: FinalizationSteps,
    faultLegJourneys: readonly string[] = [],
): Promise<void> {
    await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, true));
    steps.report(receipt);
    // AHT-07: the fault legs' `feedback_submit` events are not the share_feedback anchor (see `withoutFaultLegSubmits`).
    receipt.write(testInfo, bindReadbackJourneys(withoutFaultLegSubmits(tap.events, faultLegJourneys), {
        recording: [], feedback: true, actionBindings: tap.actionBindings,
        expectedReleaseSha: expectedReleaseSha(), expectedRunId: process.env.GITHUB_RUN_ID,
        expectedRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    }), tap.trafficTypes());
}

/**
 * J8's receipt: ONE receipt with three leg-scoped readback results (Sam, 2026-11-15). Each leg is bound only to its own window's
 * capture and submit events (J8.b's fault-leg submits excluded); a leg with no, a duplicate or a mismatched binding stays a
 * leg-scoped missing binding (HOLD) and never borrows another leg's proof.
 */
async function finishJ8Receipt(
    receipt: RwtReceipt, testInfo: TestInfo, tap: AnalyticsTap, claimed: boolean, steps: FinalizationSteps,
    windows: Partial<Record<J8Leg, { fromMs: number; toMs: number }>>, faultLegJourneys: readonly string[],
    storedProof: Partial<Record<J8Leg, { storedRows: number; insertKeys: number }>>,
    finalB: { fromMs: number; submitAt?: number } | null,
): Promise<void> {
    await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, true));
    steps.report(receipt);
    const ctx = { expectedReleaseSha: expectedReleaseSha(), expectedRunId: process.env.GITHUB_RUN_ID, expectedRunAttempt: process.env.GITHUB_RUN_ATTEMPT };
    const plans = Object.fromEntries(J8_LEGS.map((leg) => {
        const w = leg === 'J8.b'
            ? { fromMs: finalB?.fromMs ?? Number.POSITIVE_INFINITY, toMs: windows[leg]?.toMs ?? Number.NEGATIVE_INFINITY }
            : windows[leg] ?? { fromMs: Number.POSITIVE_INFINITY, toMs: Number.NEGATIVE_INFINITY };
        return [leg, legReadback(tap.events, { ...w, bindings: tap.actionBindings, captures: tap.actionCaptures,
            excludeJourneys: leg === 'J8.b' ? faultLegJourneys : [], stored: storedProof[leg] ?? null }, ctx)];
    })) as Record<J8Leg, ReturnType<typeof legReadback>>;
    const merged = mergeLegReadback(plans);
    if (finalB) {
        const sent = j8bFinalSentFeedbackVerdict(tap.sent('feedback_submit'), merged.legJourneys['J8.b'], finalB.submitAt,
            windows['J8.b']?.toMs, tap.blindAt, expectedReleaseSha());
        legSink(receipt, 'J8.b').row('final feedback pair sent', sent.verdict, sent.detail, sent.evidence);
    }
    // The leg -> journey map the nine-journey splitter reads to scope each leg's received readback (the readback itself is per journey).
    const oneEach = J8_LEGS.every((leg) => merged.legJourneys[leg].length === 1);
    receipt.row('J8 leg readback bindings', oneEach ? 'PASS' : 'HOLD',
        oneEach ? 'each leg is bound to exactly one journey of its own' : 'a leg has no journey of its own bound (see readback journey binding)',
        Object.fromEntries(J8_LEGS.map((leg) => [leg, merged.legJourneys[leg].join(',')])));
    receipt.write(testInfo, merged, tap.trafficTypes());
}

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();

/**
 * Harness parity (PO route 2026-11-10), AHT-07 (older take), from the journey's design: two takes, one Start press each —
 *   1. the first take (`createSavedOpenMicTake(..., true)`): `mic-download` on a cold first use (benchmark-utils.ts:609,
 *      the one cold press that downloads AND starts the take), otherwise `mic-start` (benchmark-utils.ts:862 via
 *      `startBenchmarkRecording`, which presses nothing when setup already started the take);
 *   2. the second take: the completed review's `verdict-practice-again` (`again.click()` in createSavedOpenMicTake, this file).
 * Feedback, navigation and sign-in press no Start control. The three fault legs (`runFeedbackFaultLeg`) press only
 * `nav-report-issue-button`, `feedback-type-broke` and `issue-report-submit` (twice: the failed Send and its Retry) and select
 * the older take; the feedback Retry is the dialog's Submit, not `mic-retry`. So 2 in all (the catalog minimum), at most one each
 * of `mic-start`, `mic-download` and `verdict-practice-again`, and no Start Retry.
 */
const AHT07_START_PRESS_BUDGET = { total: 2, perControl: { 'mic-start': 1, 'mic-download': 1, 'verdict-practice-again': 1 } } as const;
/** The page-close step's own bound: each page close is itself bounded at 15 s inside it. */
const PARITY_CLOSE_STEP_MS = 60_000;

/**
 * AHT-08 (No session) is designed to press no Start control at all (catalog minimum 0), so `startPressRow` — which FAILs
 * at zero presses — does not apply. Same row name: PASS iff no Start press was observed.
 */
function zeroStartPressRow(receipt: ReceiptRowSink, parity: HarnessParityTap): void {
    const evidence = { startPresses: parity.startPresses,
        ...Object.fromEntries(START_CONTROLS.map((c) => [`presses:${c}`, parity.startPressesByControl[c]])),
        leaseAcquisitionsDiagnostic: parity.leaseAcquisitions, cap: 0 };
    const ok = parity.startPresses === 0;
    receipt.row('Start presses within budget', ok ? 'PASS' : 'FAIL',
        ok ? 'no Start control was pressed, as the journey is designed' : 'a Start control was pressed in a journey designed to press none', evidence);
}

test.describe('RWT — Share Feedback association boundaries @live', () => {
    test.afterEach(async () => {
        await finalizer.drain();
    });

    test('feedback selected for an older take links only to that take', async ({ page }, testInfo) => {
        // Sam on 27ee1856: decided first, before any page action or signup: under a J8 runner admission this test sends nothing.
        test.skip(j8AdmissionPresent(process.env), J8_LEGACY_REFUSAL);
        if (j8AdmissionPresent(process.env)) return;
        test.setTimeout(1_800_000);
        const owner: Owner = { email: '', uid: '' };
        const receipt = new RwtReceipt(`${SUITE}-older-take`);
        const tap = new AnalyticsTap();
        const generations = new CoachingGenerationTap();
        tap.attach(page); generations.attach(page);
        // Harness parity: Cloud STT requests and Start presses on every page of this journey's one context.
        const parity = new HarnessParityTap();
        // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the timeout.
        const watch = armWatchdog({ page, tap, profile: watchProfileFor(`${SUITE}-older-take`), label: `${SUITE}-older-take` });
        let claimed = false;
        let accountDeleted = false;
        let reportId: string | null = null;
        // #1594: the takes this scenario saved, for the end-of-scenario one-request-per-take budget.
        const takes: string[] = [];
        // AHT-07 bounded writes: every feedback write of this journey, the legs' journeys, and the ledger as the body last saw it.
        const ledger = new FeedbackAttemptLedger();
        let routeInstalled = false;
        const legJourneys: string[] = [];
        let observedLedger: RowVerdict | null = null;
        // #1811 (Sam, #1859 review): the database feedback fence replaces the on-disk recovery inventory. Its cap is the route's
        // distinct-key cap (four), so the route refuses first and the fence never surprises a legitimate write.
        let feedbackFence: JourneyFeedbackFence | null = null;
        // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
        // (which Playwright runs after a timeout) run this same memoized closure exactly once.
        const finish = finalizer.once(async () => {
            // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
            const steps = new FinalizationSteps();
            // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
            // (bounded; page-independent, since a finalizer may run after its tabs closed).
            await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
            await steps.step('watchdog', () => watch.record(receipt));
            await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
            // The WHOLE scenario, after feedback and navigation: at most one request per saved take (two in all).
            await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 2, oneRequestPerSession: takes }));
            // Harness parity rows (catalog AHT-07: no-cloud-stt, start-press-budget, owned-pages-closed), before the account is
            // deleted; the page close in its own bounded step so a slow count can never skip it.
            await steps.step('harness parity counts', (alive) => {
                parity.noCloudSttRow(aliveReceipt(receipt, alive));
                parity.startPressRow(aliveReceipt(receipt, alive), AHT07_START_PRESS_BUDGET);
            });
            await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
            // AHT-07 bounded writes, at the FINAL boundary: every owned page is closed, so no feedback write can still come from a
            // page; route handlers still in flight are drained (their writes are already recorded). A write after the body's end
            // falls outside every window and FAILs the ledger; a FAIL the body observed stays FAIL.
            ledger.endWindow();
            // Sam, #1811 b319d42b RETURN: the drain's result is kept, never ignored; a handler still in flight is an unknown write.
            let pendingAfterDrain: number | null = null;
            if (routeInstalled) {
                await steps.step('feedback attempt ledger', async (alive) => {
                    // ff3922e9 RETURN: close the route's door first (every later write is aborted unsent), then drain; only a
                    // drain that found nothing in flight writes the writer's stopped record that recovery requires.
                    feedbackFence?.stopWriter();
                    pendingAfterDrain = await ledger.drain(15_000);
                    const sink = aliveReceipt(receipt, alive);
                    // Sam, #1811 b319d42b RETURN: the drain's result is reported, never ignored. A handler still in flight is a write
                    // whose outcome this process may not see; the fence close that follows serializes with it in the database.
                    sink.row('feedback writer drained', pendingAfterDrain === 0 ? 'PASS' : 'HOLD',
                        pendingAfterDrain === 0 ? 'no feedback write was still in flight when the writer stopped'
                            : `${pendingAfterDrain} write(s) still in flight; the fence close records any that commit`, { pending: pendingAfterDrain });
                    writeFeedbackAttemptRows(sink, ledger.attempts, observedLedger);
                    const isolation = finalIsolationVerdict({
                        boundJourneys: tap.actionBindings.filter((b) => b.stage === 'share_feedback').map((b) => b.journeyId),
                        legJourneys, events: tap.sent('feedback_submit'),
                        legKeys: FEEDBACK_FAULT_LEGS.flatMap((leg) => ledger.legAttempts(leg).flatMap((a) => a.keys)),
                        finalKeys: [...new Set(ledger.finalAttempts().flatMap((a) => a.keys))],
                    });
                    sink.row(FEEDBACK_ISOLATION_ROW, isolation.verdict, isolation.detail, isolation.evidence);
                });
            }
            // #1811 (Sam, #1859 review): the writer is stopped and drained; close the fence, ACKNOWLEDGED, before any cleanup. Close
            // waits in the database for every in-flight insert of the account, then refuses all later ones, so every report this run
            // can ever commit is now recorded — including one forwarded with no answer (an "uncertain" commit).
            const fence = feedbackFence;
            if (fence) await steps.step('feedback fence close', async (alive) => { await fence.close(aliveReceipt(receipt, alive)); });
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion. With a report, the retention proof deletes through it;
            // the deletion's own settlement then decides the row — a stalled readback never deletes again.
            if ((owner.uid || owner.email) && !accountDeleted) {
                const cleanup = new OwnedCleanup(() => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
                const report = owner.uid ? reportId : null;
                accountDeleted = (await finalizeOwnedCleanup(steps, receipt, cleanup, report
                    ? (alive) => feedbackRetentionAfterDeletionRow(aliveReceipt(receipt, alive), admin as never, report, () => cleanup.run())
                    : undefined)) === 'deleted';
            }
            // AFTER the retention read (a product contract): delete exactly the fence-recorded reports (owned or, after the account
            // deletion, ownerless; never another account's), then the INDEPENDENT read-only zero readback. A fence that could not be
            // closed or cleaned is FAIL here, and the recovery dispatch closes and cleans it by its run key.
            if (fence) {
                const written = await steps.step('feedback fence cleanup', async (alive) => { await fence.cleanRow(aliveReceipt(receipt, alive), ZERO_RESIDUE_ROW); return true; },
                    FINALIZE_CLEANUP_MS);
                if (written !== true) receipt.row(ZERO_RESIDUE_ROW, 'FAIL', 'the fence cleanup step did not finish; the recovery dispatch closes and cleans it by run key');
            }
            await finishReceipt(receipt, testInfo, tap, claimed, steps, legJourneys);
        });
        try {
            // BEFORE the first navigation (the click recorder is an init script).
            await parity.attach(page.context());
            await suppressPageSnapshot(testInfo);
            const ready = await prepareDisposable(page, receipt, owner);
            claimed = ready;
            if (!ready) return;
            // AHT-07 bounded writes: the pre-send cap, installed only after the canary claim is visible (no write before preflight).
            // #1811 (Sam, #1859 review): the run's feedback fence is CONFIRMED open first — no route, and so no feedback write,
            // without it. An uncertain open is recovered by its run key (never reopened); anything else HOLDs before any write.
            feedbackFence = new JourneyFeedbackFence(admin as never, 'AHT-07', AHT07_FENCE_KEY_CAP);
            await feedbackFence.open(owner.uid, currentRunBinding());
            if (!feedbackFence.writable) {
                receipt.halt('feedback fence open', `HOLD before any feedback write: ${feedbackFence.heldReason ?? 'not opened'}`);
                return;
            }
            feedbackFence.openRow(receipt);
            await installFeedbackWriteRoute(page, ledger, feedbackFence);
            routeInstalled = true;
            await page.goto('/practice');
            await openProductsItem(page, 'open-mic');
            await page.waitForURL(/\/session/, { timeout: 45_000 });
            const olderId = await createSavedOpenMicTake(page, 1, true);
            const newerId = await createSavedOpenMicTake(page, 2, false);
            takes.push(olderId, newerId);
            await generations.settle();
            receipt.row('two saved takes', olderId !== newerId ? 'PASS' : 'FAIL',
                olderId !== newerId ? 'two distinct takes were saved in this login' : 'the two saves reused one session identity');
            const olderRequests = generations.forSession(olderId).map((e) => e.sent.requestId).filter((id): id is string => Boolean(id));
            const newerRequests = generations.forSession(newerId).map((e) => e.sent.requestId).filter((id): id is string => Boolean(id));
            receipt.row('older take coaching request observed', olderRequests.length > 0 ? 'PASS' : 'HOLD',
                olderRequests.length > 0 ? 'the browser sent a coaching request bound to the older saved take' : 'no older-take coaching request was captured');
            // AHT-07 fault legs: each one failed attempt and one explicit same-key Retry. A leg that did not recover stops the
            // scenario after its rows, so no further feedback is sent and no kept draft can leak into the final submit.
            for (const leg of FEEDBACK_FAULT_LEGS) {
                const observation = await runFeedbackFaultLeg(page, tap, ledger, leg, olderId, owner.uid, legJourneys);
                writeFeedbackLegRows(receipt, leg, observation, ledger.legAttempts(leg));
                if (!feedbackLegRecovered(observation)) throw new Error(`the ${leg} feedback leg did not recover`);
            }
            // The one clean final submit, in a NEW document (`submitFeedback` navigates): a new boot and journey, a fresh dialog
            // and key, and the only `share_feedback` binding, so no leg event reaches the bound journey.
            ledger.beginFinal();
            const stored = await submitFeedback(page, tap, owner.uid, 'selected_older_session', olderId, newerId);
            ledger.endWindow();
            observedLedger = feedbackLedgerVerdict(ledger.attempts);
            // Captured FIRST: whatever the stored reference holds, cleanup and retention bookkeeping keep this report id.
            reportId = stored.id;
            writeOlderTakeReportRows(receipt, stored, olderId);
            // #1594 (PM 6120326867): the #1590 contract on the SELECTED OLDER take — its own sent request, never the newer
            // take's (named as current so the contract refuses a borrowed link). Settled only by the received readback.
            await generations.settle();
            await feedbackDiagnosticChainRow({
                receipt, admin: admin as never, userId: owner.uid, reportId, currentSessionId: newerId, reportedSessionId: olderId,
                acknowledgementVisible: stored.acknowledged,
                exchanges: generations.exchanges, observedEvents: tap.events, configuredModel: coachingContract.model, product: 'open_mic',
            });
            writeOlderTakeBindingRow(receipt, stored, olderRequests, newerRequests);
        } catch (error) {
            receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
            throw error;
        } finally {
            await finish();
        }
    });

    /**
     * J8 (nine-journey design; Sam's disposition 2026-11-15): ONE run-owned account, in order J8.a No session before any take,
     * J8.b two saved takes + the AHT-07 fault legs + the older-take submit, J8.c No session with both takes listed. One
     * `AHT-07+AHT-08` fence (keys 1/4/1), one route (`installJ8WriteRoute`), one finalizer, ONE receipt with leg-scoped rows and
     * three leg-scoped readback results. Offline adapter for the named nine-journey runner: never dispatched standalone.
     */
    test('J8: one account — No session before any take, older-take feedback, No session with both takes listed', async ({ page }, testInfo) => {
        // Sam on 94fe88d7: no runner, no signup. Decided FIRST, before any page action, signup, route or write: without the named
        // nine-journey runner's admission for this run (and its pre-recorded account-create attempt) the test sends nothing.
        const admission = j8RunnerAdmission(process.env, (f) => readFileSync(f, 'utf8'));
        test.skip(!admission.admitted, admission.admitted ? '' : admission.reason);
        if (!admission.admitted) return;
        test.setTimeout(2_400_000);
        const owner: Owner = { email: '', uid: '' };
        const receipt = new RwtReceipt(J8_SUITE);
        // The nightly entry maps this receipt only when it names the entry's own run-bound create attempt (Sam: the receipt and
        // cleanup bind to the same run and attempt). The attempt id is the runner's own label, never an account identifier.
        receipt.meta.runnerAttempt = admission.attemptId;
        const tap = new AnalyticsTap();
        const generations = new CoachingGenerationTap();
        tap.attach(page); generations.attach(page);
        const parity = new HarnessParityTap();
        const watch = armWatchdog({ page, tap, profile: watchProfileFor(J8_SUITE), label: J8_SUITE });
        let claimed = false;
        const takes: string[] = [];
        const ledger = new FeedbackAttemptLedger();
        const gate = new J8WriteGate();
        let routeInstalled = false;
        const faultLegJourneys: string[] = [];
        let observedLedger: RowVerdict | null = null;
        let feedbackFence: JourneyFeedbackFence | null = null;
        // Each leg's evidence window, and each no-session leg's submit window for its received-feedback row.
        const windows: Partial<Record<J8Leg, { fromMs: number; toMs: number }>> = {};
        const submitWindows: Partial<Record<J8Leg, { feedbackBefore: number; submitAt: number }>> = {};
        // Each leg's own independently observed submit proof (stored rows under its own observed insert keys) for its readback.
        const storedProof: Partial<Record<J8Leg, { storedRows: number; insertKeys: number }>> = {};
        let finalB: { fromMs: number; submitAt?: number } | null = null;
        // Each leg's OWN Start presses: tap snapshots at the journey's start, at J8.a's end and at J8.b's end (J8.b's interval
        // includes its two takes, which run before its write window opens). J8.c counts its own (`no extra Start or coaching`).
        let startsAtAttach: StartPressCounts | null = null;
        let startsAfterJ8a: StartPressCounts | null = null;
        // A leg opens only when no earlier write is in flight or has an unknown outcome; otherwise it is NOT RUN (HOLD).
        const openLeg = (leg: J8Leg): boolean => {
            if (gate.pending === 0 && gate.unresolvedCount === 0) { gate.open(leg); return true; }
            legSink(receipt, leg).row('prerequisites', 'HOLD', `an earlier feedback write is still in flight or has an unknown outcome, so ${leg} was NOT RUN`,
                { pending: gate.pending, unresolved: gate.unresolvedCount });
            return false;
        };
        const finish = finalizer.once(async () => {
            const steps = new FinalizationSteps();
            await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
            await steps.step('watchdog', () => watch.record(receipt));
            for (const leg of ['J8.a', 'J8.c'] as const) {
                await steps.step(`${leg} received feedback`, (alive) => {
                    const submitted = submitWindows[leg];
                    if (!submitted) return;
                    writeReceivedFeedbackRow(legSink(aliveReceipt(receipt, alive), leg), tap.sent('feedback_submit').slice(submitted.feedbackBefore)
                        .filter((e) => e.at <= (windows[leg]?.toMs ?? Number.POSITIVE_INFINITY)), {
                        blindSinceSubmit: tap.blindAt.filter((t) => t >= submitted.submitAt && t <= (windows[leg]?.toMs ?? Number.POSITIVE_INFINITY)).length,
                        expectedReleaseSha: expectedReleaseSha(),
                    });
                });
            }
            await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
            // The whole journey: at most one coaching request per saved take (two in all); J8.a and J8.c add none.
            await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 2, oneRequestPerSession: takes }));
            await steps.step('harness parity counts', (alive) => {
                parity.noCloudSttRow(aliveReceipt(receipt, alive));
                parity.startPressRow(aliveReceipt(receipt, alive), AHT07_START_PRESS_BUDGET);
            });
            await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
            ledger.endWindow();
            if (routeInstalled) {
                await steps.step('feedback writer drained', async (alive) => {
                    feedbackFence?.stopWriter();
                    const pendingAfterDrain = await ledger.drain(15_000);
                    const sink = aliveReceipt(receipt, alive);
                    // Sam on 7a755749: in-flight and unresolved are counted apart; either one keeps the writer HOLD. Every J8 write goes
                    // through the gate, so the ledger's own count is a subset of it. The fence close and cleanup steps below run either way.
                    const drained = writerDrainedVerdict({ inFlight: Math.max(pendingAfterDrain, gate.pending), unresolved: gate.unresolvedCount });
                    sink.row('feedback writer drained', drained.status, drained.detail, drained.evidence);
                    const refused = gate.refused.none + J8_LEGS.reduce((n, leg) => n + gate.refused[leg], 0);
                    sink.row('J8 write windows', refused === 0 ? 'PASS' : 'FAIL',
                        refused === 0 ? 'every feedback write fell inside its own leg window, within its own bounds'
                            : `${refused} write(s) refused (between windows, unresolved prior write, or over a leg's own bounds)`,
                        { refusedBetweenWindows: gate.refused.none, refusedJ8a: gate.refused['J8.a'], refusedJ8b: gate.refused['J8.b'], refusedJ8c: gate.refused['J8.c'] });
                    const b = legSink(sink, 'J8.b');
                    writeFeedbackAttemptRows(b, ledger.attempts, observedLedger);
                    const isolation = finalIsolationVerdict({
                        boundJourneys: tap.actionBindings.filter((x) => x.stage === 'share_feedback' && windows['J8.b']
                            && x.capturedAt >= windows['J8.b'].fromMs && x.capturedAt <= windows['J8.b'].toMs).map((x) => x.journeyId),
                        legJourneys: faultLegJourneys, events: tap.sent('feedback_submit'),
                        legKeys: FEEDBACK_FAULT_LEGS.flatMap((leg) => ledger.legAttempts(leg).flatMap((a) => a.keys)),
                        finalKeys: [...new Set(ledger.finalAttempts().flatMap((a) => a.keys))],
                    });
                    b.row(FEEDBACK_ISOLATION_ROW, isolation.verdict, isolation.detail, isolation.evidence);
                });
            }
            const fence = feedbackFence;
            if (fence) await steps.step('feedback fence close', async (alive) => { await fence.close(aliveReceipt(receipt, alive)); });
            // Sam on 27ee1856, route (b): the nightly runner (the parent) owns this account's deletion. Once this spec has exited it finds
            // the account under the reservation, checks it is bound to this run and attempt, deletes it on the scoped path and reads every
            // required store at zero, which is what clears the run's create attempt (j8-parent-recovery.cjs). The spec never deletes it,
            // so retention after deletion is not observed in this run (not a J8 plan row). The fence still closes and cleans here: the
            // fence deletes its recorded reports whether or not their owner exists.
            receipt.row('feedback retention', 'HOLD', 'the nightly runner deletes the account after this spec exits, so retention after deletion is not observed in this run');
            if (fence) {
                const written = await steps.step('feedback fence cleanup', async (alive) => { await fence.cleanRow(aliveReceipt(receipt, alive), ZERO_RESIDUE_ROW); return true; },
                    FINALIZE_CLEANUP_MS);
                if (written !== true) receipt.row(ZERO_RESIDUE_ROW, 'FAIL', 'the fence cleanup step did not finish; the recovery dispatch closes and cleans it by run key');
            }
            await finishJ8Receipt(receipt, testInfo, tap, claimed, steps, windows, faultLegJourneys, storedProof, finalB);
        });
        try {
            await parity.attach(page.context());
            startsAtAttach = startPressSnapshot(parity.startPressesByControl);
            await suppressPageSnapshot(testInfo);
            const ready = await prepareDisposable(page, receipt, owner, admission.lookupRef);
            claimed = ready;
            if (!ready) return;
            feedbackFence = new JourneyFeedbackFence(admin as never, J8_FENCE_CASE, J8_FENCE_KEY_CAP);
            await feedbackFence.open(owner.uid, currentRunBinding());
            if (!feedbackFence.writable) {
                receipt.halt('feedback fence open', `HOLD before any feedback write: ${feedbackFence.heldReason ?? 'not opened'}`);
                return;
            }
            feedbackFence.openRow(receipt);
            await installJ8WriteRoute(page, gate, ledger, feedbackFence);
            routeInstalled = true;

            // J8.a — No session before any take (AHT-08's checks): one report, no take or coaching link, no coaching at all yet.
            const a = legSink(receipt, 'J8.a');
            windows['J8.a'] = { fromMs: Date.now(), toMs: Number.POSITIVE_INFINITY };
            if (!openLeg('J8.a')) return;
            const storedA = await submitFeedback(page, tap, owner.uid, 'no_session', null, undefined, {
                onSubmitted: (submitted) => { submitWindows['J8.a'] = submitted; },
                onFreshAcknowledgment: (observation) => writeFreshAcknowledgmentRow(a, observation),
            });
            gate.close('J8.a');
            windows['J8.a'].toMs = Date.now();
            storedProof['J8.a'] = { storedRows: storedA.storedRows, insertKeys: storedA.insertKeys };
            writeNoSessionReportRows(a, storedA);
            // J8.a's own zero-Start observation: from the journey's start (signup included) to the end of its No-session submit.
            startsAfterJ8a = startPressSnapshot(parity.startPressesByControl);
            const aStarts = legStartPressVerdict(startsAtAttach, startsAfterJ8a, 'none');
            a.row('no Start press', aStarts.status, aStarts.detail, aStarts.evidence);
            a.row('no coaching before any take', generations.exchanges.length === 0 ? 'PASS' : 'FAIL',
                generations.exchanges.length === 0 ? 'no coaching request was sent before the first take' : 'a coaching request was sent before any take existed',
                { coachingRequests: generations.exchanges.length });

            // J8.b — two saved takes, the AHT-07 fault legs, then the older-take submit.
            const b = legSink(receipt, 'J8.b');
            await page.goto('/practice');
            await openProductsItem(page, 'open-mic');
            await page.waitForURL(/\/session/, { timeout: 45_000 });
            const olderId = await createSavedOpenMicTake(page, 1, true);
            const newerId = await createSavedOpenMicTake(page, 2, false);
            takes.push(olderId, newerId);
            await generations.settle();
            b.row('two saved takes', olderId !== newerId ? 'PASS' : 'FAIL',
                olderId !== newerId ? 'two distinct takes were saved in this login' : 'the two saves reused one session identity');
            const olderRequests = generations.forSession(olderId).map((e) => e.sent.requestId).filter((id): id is string => Boolean(id));
            const newerRequests = generations.forSession(newerId).map((e) => e.sent.requestId).filter((id): id is string => Boolean(id));
            b.row('older take coaching request observed', olderRequests.length > 0 ? 'PASS' : 'HOLD',
                olderRequests.length > 0 ? 'the browser sent a coaching request bound to the older saved take' : 'no older-take coaching request was captured');
            windows['J8.b'] = { fromMs: Date.now(), toMs: Number.POSITIVE_INFINITY };
            if (!openLeg('J8.b')) return;
            let bEstablished = olderId !== newerId;
            for (const leg of FEEDBACK_FAULT_LEGS) {
                const observation = await runFeedbackFaultLeg(page, tap, ledger, leg, olderId, owner.uid, faultLegJourneys);
                writeFeedbackLegRows(b, leg, observation, ledger.legAttempts(leg));
                if (!feedbackLegRecovered(observation)) { bEstablished = false; break; }
            }
            let storedB: (StoredFeedbackReport & { acknowledged: boolean }) | null = null;
            if (bEstablished) {
                ledger.beginFinal();
                // The final submit's own window (it binds J8.b's readback, so the fault attempts are outside it) and its own fresh
                // acknowledgment (the fault legs' toasts are marked first).
                const finalSubmit: { fromMs: number; submitAt?: number } = { fromMs: Date.now() };
                finalB = finalSubmit;
                storedB = await submitFeedback(page, tap, owner.uid, 'selected_older_session', olderId, newerId, {
                    onSubmitted: ({ submitAt }) => { finalSubmit.submitAt = submitAt; },
                    onFreshAcknowledgment: (observation) => writeFreshAcknowledgmentRow(b, observation),
                });
                ledger.endWindow();
                observedLedger = feedbackLedgerVerdict(ledger.attempts);
                storedProof['J8.b'] = { storedRows: storedB.storedRows, insertKeys: storedB.insertKeys };
                writeOlderTakeReportRows(b, storedB, olderId);
                await generations.settle();
                await feedbackDiagnosticChainRow({
                    receipt: legReceipt(receipt, 'J8.b'), admin: admin as never, userId: owner.uid, reportId: storedB.id, currentSessionId: newerId,
                    reportedSessionId: olderId, acknowledgementVisible: storedB.acknowledged,
                    exchanges: generations.exchanges, observedEvents: tap.events, configuredModel: coachingContract.model, product: 'open_mic',
                });
                writeOlderTakeBindingRow(b, storedB, olderRequests, newerRequests);
            }
            gate.close('J8.b');
            windows['J8.b'].toMs = Date.now();
            // J8.b's own Start presses: its two takes, from J8.a's end to here, against AHT-07's designed budget.
            const bStarts = legStartPressVerdict(startsAfterJ8a, startPressSnapshot(parity.startPressesByControl), AHT07_START_PRESS_BUDGET);
            b.row('Start presses within budget', bStarts.status, bStarts.detail, bStarts.evidence);

            // J8.c — No session with both takes listed. Sam on 94fe88d7: it must EARN its write. Before C opens: J8.b's report is stored
            // exactly once AND linked to the older take, and both saved takes read completely and owner-bound. Otherwise NOT RUN.
            const c = legSink(receipt, 'J8.c');
            // Sam on 7a755749: a failed query is UNREADABLE (null), never an empty map: unreadable before the submit keeps J8.c NOT
            // RUN; after it, HOLD. Only a successful read that lacks a take FAILs.
            const readTakes = async (): Promise<ReadonlyMap<string, string | null> | null> => {
                try {
                    return readTakeDigests(await admin!.from('sessions').select(TAKE_PROJECTION_FIELDS.join(',')).eq('user_id', owner.uid).in('id', [olderId, newerId]), owner.uid);
                } catch { return null; }
            };
            const linkedToOlder = Boolean(storedB && storedB.storedRows === 1 && storedB.sessionId === olderId);
            const before = linkedToOlder ? await readTakes() : null;
            if (!bEstablished || !linkedToOlder || !takesReadComplete([olderId, newerId], before)) {
                c.row('prerequisites', 'HOLD', 'J8.b did not leave one stored report linked to the older take and two completely read, owner-bound saved takes, so J8.c was NOT RUN',
                    { bEstablished, linkedToOlder, takesReadable: before !== null, takesReadComplete: takesReadComplete([olderId, newerId], before) });
                return;
            }
            const startsBefore = parity.startPresses;
            const coachingBefore = generations.exchanges.length;
            windows['J8.c'] = { fromMs: Date.now(), toMs: Number.POSITIVE_INFINITY };
            if (!openLeg('J8.c')) return;
            const storedC = await submitFeedback(page, tap, owner.uid, 'no_session_with_takes', null, undefined, {
                onSubmitted: (submitted) => { submitWindows['J8.c'] = submitted; },
                onFreshAcknowledgment: (observation) => writeFreshAcknowledgmentRow(c, observation),
            }, [olderId, newerId]);
            gate.close('J8.c');
            windows['J8.c'].toMs = Date.now();
            storedProof['J8.c'] = { storedRows: storedC.storedRows, insertKeys: storedC.insertKeys };
            writeNoSessionReportRows(c, storedC);
            await generations.settle();
            const unchanged = takesUnchangedVerdict([olderId, newerId], before, await readTakes());
            c.row('both saved takes unchanged', unchanged.status, unchanged.detail, unchanged.evidence);
            const extraStarts = parity.startPresses - startsBefore;
            const extraCoaching = generations.exchanges.length - coachingBefore;
            c.row('no extra Start or coaching', extraStarts === 0 && extraCoaching === 0 ? 'PASS' : 'FAIL',
                extraStarts === 0 && extraCoaching === 0 ? 'the No-session submit pressed no Start and sent no coaching request'
                    : 'the No-session submit was followed by a Start press or a coaching request', { extraStarts, extraCoaching });
        } catch (error) {
            receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
            throw error;
        } finally {
            await finish();
        }
    });

    test('No session feedback stores no take or coaching link', async ({ page }, testInfo) => {
        // Sam on 27ee1856: decided first, before any page action or signup: under a J8 runner admission this test sends nothing.
        test.skip(j8AdmissionPresent(process.env), J8_LEGACY_REFUSAL);
        if (j8AdmissionPresent(process.env)) return;
        test.setTimeout(300_000);
        const owner: Owner = { email: '', uid: '' };
        const receipt = new RwtReceipt(`${SUITE}-no-session`);
        const tap = new AnalyticsTap();
        const generations = new CoachingGenerationTap();
        tap.attach(page); generations.attach(page);
        // Harness parity: Cloud STT requests and Start presses on every page of this journey's one context.
        const parity = new HarnessParityTap();
        // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the timeout.
        const watch = armWatchdog({ page, tap, profile: watchProfileFor(`${SUITE}-no-session`), label: `${SUITE}-no-session` });
        let claimed = false;
        let accountDeleted = false;
        let reportId: string | null = null;
        // AHT-08 received feedback: the submit's telemetry window, set just before the Submit click (null: never submitted).
        let submitWindow: { feedbackBefore: number; submitAt: number } | null = null;
        // #1811 (Sam, #1859 review): AHT-08's feedback fence. Its key cap of ONE is enforced by the database itself, so the one
        // submit is bounded without a route, and a lost runner's report stays recorded for the recovery dispatch.
        let feedbackFence: JourneyFeedbackFence | null = null;
        let writeRoute: { pending: () => number; refused: () => number } | null = null;
        // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
        // (which Playwright runs after a timeout) run this same memoized closure exactly once.
        const finish = finalizer.once(async () => {
            // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
            const steps = new FinalizationSteps();
            // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
            // (bounded; page-independent, since a finalizer may run after its tabs closed).
            await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
            await steps.step('watchdog', () => watch.record(receipt));
            // AHT-08 received feedback, after the settle: exactly one attempted + one storage_ok, same submit_seq, since the submit.
            await steps.step('received feedback', (alive) => {
                const submitted = submitWindow;
                if (!submitted) return;
                writeReceivedFeedbackRow(aliveReceipt(receipt, alive), tap.sent('feedback_submit').slice(submitted.feedbackBefore), {
                    blindSinceSubmit: tap.blindAt.filter((t) => t >= submitted.submitAt).length, expectedReleaseSha: expectedReleaseSha(),
                });
            });
            await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
            // No session links no take, so the whole scenario must send no coaching request at all.
            await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 0 }));
            // Harness parity rows (catalog AHT-08: no-cloud-stt, start-press-budget at a cap of 0, owned-pages-closed), before
            // the account is deleted; the page close in its own bounded step.
            await steps.step('harness parity counts', (alive) => {
                parity.noCloudSttRow(aliveReceipt(receipt, alive));
                zeroStartPressRow(aliveReceipt(receipt, alive), parity);
            });
            await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
            // #1811: every owned page is closed. Stop the writer and report the route's bounds (in-flight handlers and refused
            // writes are reported, never ignored), then close the fence (acknowledged) before any cleanup. Close waits for an
            // in-flight insert and refuses every later one, so the submit's report — even one whose answer was lost — is recorded.
            feedbackFence?.stopWriter();
            const route = writeRoute;
            if (route) {
                await steps.step('feedback write bounds', (alive) => {
                    const pending = route.pending(), refused = route.refused();
                    aliveReceipt(receipt, alive).row('feedback write bounds', pending === 0 && refused === 0 ? 'PASS' : refused > 0 ? 'FAIL' : 'HOLD',
                        refused > 0 ? `${refused} write(s) refused before sending (over the ${NO_SESSION_ATTEMPT_CAP}-attempt / one-key bound, or not an insert)`
                            : pending > 0 ? `${pending} write(s) still in flight; the fence close records any that commit`
                                : 'one insert and at most one same-key Retry; nothing was refused or left in flight', { pending, refused });
                }, FEEDBACK_FENCE_STEP_MS);
            }
            const fence = feedbackFence;
            if (fence) await steps.step('feedback fence close', async (alive) => { await fence.close(aliveReceipt(receipt, alive)); });
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion. With a report, the retention proof deletes through it;
            // the deletion's own settlement then decides the row — a stalled readback never deletes again.
            if ((owner.uid || owner.email) && !accountDeleted) {
                const cleanup = new OwnedCleanup(() => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
                const report = owner.uid ? reportId : null;
                accountDeleted = (await finalizeOwnedCleanup(steps, receipt, cleanup, report
                    ? (alive) => feedbackRetentionAfterDeletionRow(aliveReceipt(receipt, alive), admin as never, report, () => cleanup.run())
                    : undefined)) === 'deleted';
            }
            // AFTER the retention read: delete exactly the fence-recorded report(s), then the independent read-only zero readback.
            if (fence) {
                const written = await steps.step('feedback fence cleanup', async (alive) => { await fence.cleanRow(aliveReceipt(receipt, alive), ZERO_RESIDUE_ROW); return true; },
                    FINALIZE_CLEANUP_MS);
                if (written !== true) receipt.row(ZERO_RESIDUE_ROW, 'FAIL', 'the fence cleanup step did not finish; the recovery dispatch closes and cleans it by run key');
            }
            await finishReceipt(receipt, testInfo, tap, claimed, steps);
        });
        try {
            // BEFORE the first navigation (the click recorder is an init script).
            await parity.attach(page.context());
            await suppressPageSnapshot(testInfo);
            const ready = await prepareDisposable(page, receipt, owner);
            claimed = ready;
            if (!ready) return;
            // #1811: the one feedback write only behind a CONFIRMED-open fence; otherwise HOLD before any write.
            feedbackFence = new JourneyFeedbackFence(admin as never, 'AHT-08', 1);
            await feedbackFence.open(owner.uid, currentRunBinding());
            if (!feedbackFence.writable) {
                receipt.halt('feedback fence open', `HOLD before any feedback write: ${feedbackFence.heldReason ?? 'not opened'}`);
                return;
            }
            feedbackFence.openRow(receipt);
            writeRoute = await installNoSessionWriteRoute(page, feedbackFence);
            const stored = await submitFeedback(page, tap, owner.uid, 'no_session', null, undefined, {
                onSubmitted: (submitted) => { submitWindow = submitted; },
                onFreshAcknowledgment: (observation) => writeFreshAcknowledgmentRow(receipt, observation),
            });
            // Captured FIRST: whatever the stored reference holds, the retention bookkeeping keeps this report id.
            reportId = stored.id;
            writeNoSessionReportRows(receipt, stored);
        } catch (error) {
            receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
            throw error;
        } finally {
            await finish();
        }
    });
});
