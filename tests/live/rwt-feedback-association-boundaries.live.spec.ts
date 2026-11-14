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
import {
    type CapturedReports, captureRunReports, cleanupRunReports, writeUncertainty, writeZeroResidueRow, zeroResidueNotRun,
} from './helpers/feedbackReportCleanup';
import { noSessionWriteDecision, noSessionWriteUncertainty, type NoSessionInsertSnapshot } from './helpers/feedbackNoSessionCleanup';
import {
    FeedbackRecoveryInventory, RECOVERY_STORE_STEP, recordDurably, settleRecoveryInventory, verifyRecoveryStore,
} from './helpers/feedbackRecoveryInventory';
import { HarnessParityTap, START_CONTROLS } from './helpers/rwtHarnessParity';
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

type Owner = { email: string; uid: string };

async function prepareDisposable(page: Page, receipt: RwtReceipt, owner: Owner): Promise<boolean> {
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
    owner.email = newDisposableEmail('feedback-boundary');
    receipt.forbid(owner.email, SERVICE_ROLE);
    const account = await signUpDisposableAccount(page, owner.email);
    owner.uid = account.uid;
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
    /** AHT-08 report cleanup: what the submit's insert observer saw, delivered when the submit ends, also when it throws. */
    onInserts?(inserts: NoSessionInsertSnapshot): void;
}

async function submitFeedback(
    page: Page,
    tap: AnalyticsTap,
    uid: string,
    association: 'selected_older_session' | 'no_session',
    sessionId: string | null,
    newerSessionId?: string,
    observers?: SubmitObservers,
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
        return await submitOpenDialog(page, tap, uid, association, sessionId, inserts, newerSessionId, observers);
    } finally {
        inserts.stop();
        observers?.onInserts?.({ keys: [...inserts.keys], insertRequests: inserts.insertRequests, unattributedInserts: inserts.unattributedInserts });
    }
}

async function submitOpenDialog(
    page: Page,
    tap: AnalyticsTap,
    uid: string,
    association: 'selected_older_session' | 'no_session',
    sessionId: string | null,
    inserts: FeedbackInsertObserver,
    newerSessionId?: string,
    observers?: SubmitObservers,
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
 * AHT-08 durable pre-send inventory (2026-11-14, Sam's bar 1): ONE route on the no-session journey's context sees every write to
 * `user_issue_reports`. Each is decided at entry (`noSessionWriteDecision`: one insert, one key, one same-key Retry) and its key is
 * fsynced into the recovery inventory BEFORE `route.fetch()`; a write that cannot be recorded, or arrives after the writer stopped,
 * is aborted, never sent. The settle line follows the server's answer. `pending` counts handlers still in flight, so the
 * writer-stopped record is written only after a drain that found none.
 */
async function installNoSessionWriteRoute(page: Page, inventory: FeedbackRecoveryInventory): Promise<{ pending: () => number }> {
    let ordinal = 0;
    let inFlight = 0;
    const keysSeen: string[] = [];
    await page.context().route(FEEDBACK_INSERT_URL, async (route: Route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback();
        inFlight += 1;
        ordinal += 1;
        const decision = noSessionWriteDecision({ method: request.method(), body: () => request.postDataJSON(), ordinal, keysSeen });
        const attempt = { ordinal, action: decision.action, keys: decision.keys };
        try {
            if (!recordDurably(inventory, attempt)) {
                return await route.abort('failed');
            }
            if (decision.action === 'cap-abort') {
                inventory.recordSettle({ ordinal, status: null, forwarded: false });
                return await route.abort('failed');
            }
            for (const key of decision.keys) if (!keysSeen.includes(key)) keysSeen.push(key);
            let response: APIResponse;
            try { response = await route.fetch(); } catch {
                inventory.recordSettle({ ordinal, status: null, forwarded: null });
                return await route.abort('failed');
            }
            inventory.recordSettle({ ordinal, status: response.status(), forwarded: true });
            return await route.fulfill({ response });
        } catch {
            // The page closed under the route: the attempt line is already durable.
            return undefined;
        } finally {
            inFlight -= 1;
        }
    });
    return { pending: () => inFlight };
}

/**
 * AHT-07 bounded writes (Sam's one-run limit, 2026-11-11): ONE route on the journey's browser context sees every write to
 * `user_issue_reports`, so a write from any page of the journey is counted. Each is recorded and decided by the ledger at entry,
 * BEFORE it can leave the browser: the pre-send cap aborts the 8th attempt and later, an unkeyed insert, a fifth distinct key and
 * any non-insert write (`route.abort()`, never sent); an armed leg's first insert gets its fault; everything else reaches the real
 * server through `route.fetch()` so the ledger keeps its answer, and the page gets that same answer. The precedent is AHT-06's
 * lost completion (rwt-save-retry-recovery.live.spec.ts: `route.fetch()` then `route.abort('failed')`).
 */
async function installFeedbackWriteRoute(page: Page, ledger: FeedbackAttemptLedger, inventory: FeedbackRecoveryInventory): Promise<void> {
    await page.context().route(FEEDBACK_INSERT_URL, async (route: Route) => {
        const request = route.request();
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback();
        ledger.begin();
        // Recorded and decided here, before anything is sent.
        const attempt = ledger.admit(request.method(), () => request.postDataJSON());
        try {
            // Sam, #1811 791b3780 RETURN: the attempt's keys are durable on disk before anything can leave the browser, so a late
            // commit stays locatable after this process exits. A write that cannot be recorded is aborted, never sent.
            // After the writer stopped, nothing can be recorded, so nothing new is sent.
            if (!recordDurably(inventory, attempt)) {
                ledger.settle(attempt, { status: null, forwarded: false });
                return await route.abort('failed');
            }
            // Every settle is recorded too (ff3922e9 RETURN): recovery resolves an attempt only by its settle record or its
            // observed commit, never by age.
            if (attempt.action === 'cap-abort' || attempt.action === 'fault-request-lost') {
                ledger.settle(attempt, { status: null, forwarded: false });
                inventory.recordSettle(attempt);
                return await route.abort('failed');
            }
            if (attempt.action === 'fault-synthetic-42501') {
                ledger.settle(attempt, { status: 403, forwarded: false });
                inventory.recordSettle(attempt);
                return await route.fulfill(syntheticRejection(request.headers().origin));
            }
            let response: APIResponse;
            try { response = await route.fetch(); } catch {
                ledger.settle(attempt, { status: null, forwarded: null });
                inventory.recordSettle(attempt);
                return await route.abort('failed');
            }
            const status = response.status();
            const key = attempt.keys.length === 1 ? attempt.keys[0] : null;
            const replayNamed = status === 409 ? isNamedIdempotencyReplay(await response.text().catch(() => null), key) : null;
            ledger.settle(attempt, { status, forwarded: true, replayNamed });
            inventory.recordSettle(attempt);
            // stored-response-lost: the server stored the row (201); only its answer is dropped.
            if (attempt.action === 'fault-stored-response-lost') return await route.abort('failed');
            return await route.fulfill({ response });
        } catch {
            // The page closed under the route: the attempt is already in the ledger.
            return undefined;
        } finally {
            ledger.end();
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
        // Sam, #1811 791b3780 RETURN: the run-owned recovery inventory (keys on disk, never in a receipt), kept until zero residue.
        let inventory: FeedbackRecoveryInventory | null = null;
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
                    inventory?.stop();
                    pendingAfterDrain = await ledger.drain(15_000);
                    inventory?.recordWriterStopped(pendingAfterDrain);
                    const sink = aliveReceipt(receipt, alive);
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
            // Race-safe report cleanup (plan §3), step 1: capture the run's reports BEFORE the account deletion — the owner's rows
            // UNION the rows under every key the route saw.
            let capturedReports: CapturedReports | null = null;
            if (routeInstalled && owner.uid) {
                capturedReports = await steps.step('feedback report capture', () => captureRunReports(admin as never, owner.uid, ledger.seenKeys, null)) ?? null;
            }
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion. With a report, the retention proof deletes through it;
            // the deletion's own settlement then decides the row — a stalled readback never deletes again.
            if ((owner.uid || owner.email) && !accountDeleted) {
                const cleanup = new OwnedCleanup(() => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
                const report = owner.uid ? reportId : null;
                accountDeleted = (await finalizeOwnedCleanup(steps, receipt, cleanup, report
                    ? (alive) => feedbackRetentionAfterDeletionRow(aliveReceipt(receipt, alive), admin as never, report, () => cleanup.run())
                    : undefined)) === 'deleted';
            }
            // Steps 3–5, after the retention read (a product contract): re-capture right before the delete (the race), delete by
            // id only with an exact count, then the independent zero-residue reads. A step that could not finish HOLDs, naming ids.
            if (routeInstalled && owner.uid) {
                const written = await steps.step('feedback report cleanup', async (alive) => {
                    // Drained again right before the delete; what is still in flight, or was forwarded with no answer, keeps the
                    // row from PASS (an uncertain commit is never zero activity).
                    if (pendingAfterDrain !== null) pendingAfterDrain = await ledger.drain(5_000);
                    const uncertainty = writeUncertainty(ledger.attempts, pendingAfterDrain);
                    const verdict = await cleanupRunReports(admin as never, owner.uid, ledger.seenKeys, capturedReports, uncertainty);
                    if (!alive()) return false;
                    // Retired only on PASS (settlement plus zero readback); any other verdict keeps it and names the file.
                    writeZeroResidueRow(receipt, settleRecoveryInventory(verdict, inventory));
                    return true;
                }, FINALIZE_CLEANUP_MS);
                if (written !== true) writeZeroResidueRow(receipt, settleRecoveryInventory(zeroResidueNotRun(capturedReports), inventory));
            }
            await finishReceipt(receipt, testInfo, tap, claimed, steps, legJourneys);
        });
        try {
            // BEFORE the first navigation (the click recorder is an init script).
            await parity.attach(page.context());
            await suppressPageSnapshot(testInfo);
            // Sam, #1811 ff3922e9 RETURN: a verified recovery store that survives runner loss, before the first Production
            // write (the account), or HOLD. Never created here: provisioning it is the store owner's act.
            const storeCheck = verifyRecoveryStore(process.env);
            if (!storeCheck.ok) {
                receipt.halt(RECOVERY_STORE_STEP, `HOLD before Production writes: no verified recovery store (${storeCheck.reason})`);
                return;
            }
            const ready = await prepareDisposable(page, receipt, owner);
            claimed = ready;
            if (!ready) return;
            // AHT-07 bounded writes: the pre-send cap, installed only after the canary claim is visible (no write before preflight).
            // The recovery inventory is opened first: no route (and so no feedback write) without its durable binding.
            inventory = FeedbackRecoveryInventory.open({
                runId: process.env.GITHUB_RUN_ID || 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1', testId: testInfo.testId, ownerUid: owner.uid,
            }, storeCheck.store);
            await installFeedbackWriteRoute(page, ledger, inventory);
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

    test('No session feedback stores no take or coaching link', async ({ page }, testInfo) => {
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
        // AHT-08 report cleanup: the submit's observed inserts (its idempotency key) and its stored-row read.
        let insertSnapshot: NoSessionInsertSnapshot | null = null;
        let storedRows: number | null = null;
        // AHT-08 durable pre-send inventory: opened after the canary claim, before the route (no write without its binding).
        let inventory: FeedbackRecoveryInventory | null = null;
        let writeRoute: { pending: () => number } | null = null;
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
            // Every owned page is closed: stop the writer, then record its stopped state only if no route handler is in flight.
            if (inventory) {
                inventory.stop();
                inventory.recordWriterStopped(writeRoute ? writeRoute.pending() : null);
            }
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion. With a report, the retention proof deletes through it;
            // the deletion's own settlement then decides the row — a stalled readback never deletes again.
            // AHT-08 report cleanup (feedbackNoSessionCleanup.ts), AHT-07's race-safe steps unchanged. Step 1, after every owned page
            // closed and BEFORE the account deletion: capture the owner's reports UNION those under the submit's observed key.
            // The submit's key is also durable in the recovery inventory (fsynced before it was sent), so a lost runner's report
            // stays recoverable by `recoverFromInventory`; this in-run cleanup is the normal-exit path.
            const runKeys = insertSnapshot?.keys ?? [];
            let capturedReports: CapturedReports | null = null;
            if (owner.uid) {
                capturedReports = await steps.step('feedback report capture', () => captureRunReports(admin as never, owner.uid, runKeys, null)) ?? null;
            }
            if ((owner.uid || owner.email) && !accountDeleted) {
                const cleanup = new OwnedCleanup(() => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
                const report = owner.uid ? reportId : null;
                accountDeleted = (await finalizeOwnedCleanup(steps, receipt, cleanup, report
                    ? (alive) => feedbackRetentionAfterDeletionRow(aliveReceipt(receipt, alive), admin as never, report, () => cleanup.run())
                    : undefined)) === 'deleted';
            }
            // Steps 3–5, after the retention read: re-capture (the race), delete by id with an exact count, zero-residue reads. The
            // submit's own observation decides whether the one write's outcome is known; an unknown outcome HOLDs, naming the ids.
            if (owner.uid) {
                const written = await steps.step('feedback report cleanup', async (alive) => {
                    const uncertainty = noSessionWriteUncertainty({ submitted: submitWindow !== null, inserts: insertSnapshot, reportId, storedRows });
                    const verdict = await cleanupRunReports(admin as never, owner.uid, runKeys, capturedReports, uncertainty);
                    if (!alive()) return false;
                    writeZeroResidueRow(receipt, settleRecoveryInventory(verdict, inventory));
                    return true;
                }, FINALIZE_CLEANUP_MS);
                if (written !== true) writeZeroResidueRow(receipt, settleRecoveryInventory(zeroResidueNotRun(capturedReports), inventory));
            }
            await finishReceipt(receipt, testInfo, tap, claimed, steps);
        });
        try {
            // BEFORE the first navigation (the click recorder is an init script).
            await parity.attach(page.context());
            await suppressPageSnapshot(testInfo);
            // A verified recovery store that survives runner loss, before the first Production write (the account), or HOLD,
            // exactly as AHT-07. Never created here: provisioning it is the store owner's act.
            const storeCheck = verifyRecoveryStore(process.env);
            if (!storeCheck.ok) {
                receipt.halt(RECOVERY_STORE_STEP, `HOLD before Production writes: no verified recovery store (${storeCheck.reason})`);
                return;
            }
            const ready = await prepareDisposable(page, receipt, owner);
            claimed = ready;
            if (!ready) return;
            inventory = FeedbackRecoveryInventory.open({
                runId: process.env.GITHUB_RUN_ID || 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1', testId: testInfo.testId, ownerUid: owner.uid,
            }, storeCheck.store, 'aht08');
            writeRoute = await installNoSessionWriteRoute(page, inventory);
            const stored = await submitFeedback(page, tap, owner.uid, 'no_session', null, undefined, {
                onSubmitted: (submitted) => { submitWindow = submitted; },
                onFreshAcknowledgment: (observation) => writeFreshAcknowledgmentRow(receipt, observation),
                onInserts: (inserts) => { insertSnapshot = inserts; },
            });
            // Captured FIRST: whatever the stored reference holds, cleanup and retention bookkeeping keep this report id.
            reportId = stored.id;
            writeNoSessionReportRows(receipt, stored);
            storedRows = stored.storedRows;
        } catch (error) {
            receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
            throw error;
        } finally {
            await finish();
        }
    });
});
