/**
 * RWT gap coverage — deployed older-take and no-session feedback association.
 *
 * This file is intentionally independent of App Dev's #1587 files. It uses the real deployed UI,
 * a per-test disposable account, the accepted run-owned cleanup helper, and content-free receipts.
 * It is preparation only: do not dispatch without a fresh release-bound RWT authorization.
 */
import { createClient } from '@supabase/supabase-js';
import type { Page, TestInfo } from '@playwright/test';
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
    FeedbackInsertObserver, readStoredDiagnosticRef, writeNoSessionReportRows, writeOlderTakeBindingRow, writeOlderTakeReportRows,
    type ReceiptRowSink, type StoredFeedbackReport,
} from './helpers/feedbackDiagnosticRef';
import { HarnessParityTap, START_CONTROLS } from './helpers/rwtHarnessParity';
import { coachingContract } from './helpers/rwtCoachingEvidence';
import { openProductsItem } from './helpers/productsMenu';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, aliveReceipt, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
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
test.describe.configure({ mode: 'serial' });

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

async function submitFeedback(
    page: Page,
    tap: AnalyticsTap,
    uid: string,
    association: 'selected_older_session' | 'no_session',
    sessionId: string | null,
    newerSessionId?: string,
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
        return await submitOpenDialog(page, tap, uid, association, sessionId, inserts, newerSessionId);
    } finally {
        inserts.stop();
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
    await page.getByTestId('issue-report-submit').click();
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
        insertKeys: keys.length, insertRequests: inserts.insertRequests, acknowledged };
}

async function finishReceipt(
    receipt: RwtReceipt,
    testInfo: TestInfo,
    tap: AnalyticsTap,
    claimed: boolean,
    steps: FinalizationSteps,
): Promise<void> {
    await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, true));
    steps.report(receipt);
    receipt.write(testInfo, bindReadbackJourneys(tap.events, {
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
 *   2. the second take: the completed review's `verdict-practice-again` (this file:111, `again.click()` in createSavedOpenMicTake).
 * Feedback, navigation and sign-in press no Start control. So 2 in all (the catalog minimum), at most one each of
 * `mic-start`, `mic-download` and `verdict-practice-again`, and no Retry.
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
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion. With a report, the retention proof deletes through it;
            // the deletion's own settlement then decides the row — a stalled readback never deletes again.
            if ((owner.uid || owner.email) && !accountDeleted) {
                const cleanup = new OwnedCleanup(() => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
                const report = owner.uid ? reportId : null;
                accountDeleted = (await finalizeOwnedCleanup(steps, receipt, cleanup, report
                    ? (alive) => feedbackRetentionAfterDeletionRow(aliveReceipt(receipt, alive), admin as never, report, () => cleanup.run())
                    : undefined)) === 'deleted';
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
            const stored = await submitFeedback(page, tap, owner.uid, 'selected_older_session', olderId, newerId);
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
            // No session links no take, so the whole scenario must send no coaching request at all.
            await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 0 }));
            // Harness parity rows (catalog AHT-08: no-cloud-stt, start-press-budget at a cap of 0, owned-pages-closed), before
            // the account is deleted; the page close in its own bounded step.
            await steps.step('harness parity counts', (alive) => {
                parity.noCloudSttRow(aliveReceipt(receipt, alive));
                zeroStartPressRow(aliveReceipt(receipt, alive), parity);
            });
            await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion. With a report, the retention proof deletes through it;
            // the deletion's own settlement then decides the row — a stalled readback never deletes again.
            if ((owner.uid || owner.email) && !accountDeleted) {
                const cleanup = new OwnedCleanup(() => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
                const report = owner.uid ? reportId : null;
                accountDeleted = (await finalizeOwnedCleanup(steps, receipt, cleanup, report
                    ? (alive) => feedbackRetentionAfterDeletionRow(aliveReceipt(receipt, alive), admin as never, report, () => cleanup.run())
                    : undefined)) === 'deleted';
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
            const stored = await submitFeedback(page, tap, owner.uid, 'no_session', null);
            // Captured FIRST: whatever the stored reference holds, cleanup and retention bookkeeping keep this report id.
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
