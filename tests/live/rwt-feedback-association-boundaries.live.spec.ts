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
import { coachingContract } from './helpers/rwtCoachingEvidence';
import { openProductsItem } from './helpers/productsMenu';
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
): Promise<{ id: string | null; sessionId: string | null; diagnosticRef: string | null; storedRows: number; acknowledged: boolean }> {
    await page.goto('/analytics');
    await expect(page.getByTestId('nav-report-issue-button').first()).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('nav-report-issue-button').first().click();
    await expect(page.getByTestId('issue-report-dialog')).toBeVisible({ timeout: 20_000 });
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
    const since = new Date(Date.now() - 60_000).toISOString();
    // A missing action-time binding is retained as HOLD by bindReadbackJourneys; it must never be
    // guessed from a same-number or unrelated journey.
    await page.getByTestId('issue-report-submit').click();
    const acknowledged = await page.getByText('Thanks — we’ve got it.').first()
        .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    if (!acknowledged) throw new Error('the feedback acknowledgement was not shown');
    const { data, error } = await admin!.from('user_issue_reports')
        .select('id,session_id,metadata').eq('user_id', uid).gte('created_at', since);
    if (error) throw new Error(`feedback row read failed (fail closed): ${error.code ?? 'unknown'}`);
    const rows = data ?? [];
    const row = rows.length === 1 ? rows[0] : null;
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
    const storedSession = typeof row?.session_id === 'string' ? row.session_id : null;
    const diagnosticRef = typeof metadata.coaching_diagnostic_ref === 'string' ? metadata.coaching_diagnostic_ref : null;
    return { id: row ? String(row.id) : null, sessionId: storedSession, diagnosticRef, storedRows: rows.length, acknowledged };
}

async function finishReceipt(
    receipt: RwtReceipt,
    testInfo: TestInfo,
    tap: AnalyticsTap,
    claimed: boolean,
): Promise<void> {
    telemetryClassRows(receipt, tap, claimed, true);
    receipt.write(testInfo, bindReadbackJourneys(tap.events, {
        recording: [], feedback: true, actionBindings: tap.actionBindings,
        expectedReleaseSha: expectedReleaseSha(), expectedRunId: process.env.GITHUB_RUN_ID,
        expectedRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    }), tap.trafficTypes());
}

test.describe('RWT — Share Feedback association boundaries @live', () => {
    test('feedback selected for an older take links only to that take', async ({ page }, testInfo) => {
        test.setTimeout(1_800_000);
        const owner: Owner = { email: '', uid: '' };
        const receipt = new RwtReceipt(`${SUITE}-older-take`);
        const tap = new AnalyticsTap();
        const generations = new CoachingGenerationTap();
        tap.attach(page); generations.attach(page);
        let claimed = false;
        let accountDeleted = false;
        let reportId: string | null = null;
        // #1594: the takes this scenario saved, for the end-of-scenario one-request-per-take budget.
        const takes: string[] = [];
        try {
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
            reportId = stored.id;
            receipt.row('older-take report stored once', stored.storedRows === 1 && stored.id ? 'PASS' : 'FAIL',
                stored.storedRows === 1 && stored.id ? 'one feedback report was acknowledged and read back' : 'feedback was not stored exactly once',
                { storedRows: stored.storedRows });
            const correctSession = stored.sessionId === olderId;
            receipt.row('older-take association', correctSession ? 'PASS' : 'FAIL',
                correctSession ? 'the persisted report references the selected older take' : 'the persisted report does not reference the selected older take');
            // #1594 (PM 6120326867): the #1590 contract on the SELECTED OLDER take — its own sent request, never the newer
            // take's (named as current so the contract refuses a borrowed link). Settled only by the received readback.
            await generations.settle();
            await feedbackDiagnosticChainRow({
                receipt, admin: admin as never, userId: owner.uid, reportId, currentSessionId: newerId, reportedSessionId: olderId,
                acknowledgementVisible: stored.acknowledged,
                exchanges: generations.exchanges, observedEvents: tap.events, configuredModel: coachingContract.model, product: 'open_mic',
            });
            const exactOlderRequest = Boolean(stored.diagnosticRef && olderRequests.includes(stored.diagnosticRef));
            const excludesCurrent = stored.diagnosticRef === null || !newerRequests.includes(stored.diagnosticRef);
            // Codex P1 r4247450898: "not the newer take" is proven only against an OBSERVED newer-take request; with none, HOLD.
            const bindingVerdict = olderRequests.length === 0 || newerRequests.length === 0 || stored.diagnosticRef === null ? 'HOLD'
                : exactOlderRequest && excludesCurrent ? 'PASS' : 'FAIL';
            receipt.row('older-take diagnostic binding', bindingVerdict,
                bindingVerdict === 'PASS' ? 'the report references a request sent for the older take and not the newer take'
                    : bindingVerdict === 'HOLD' ? (newerRequests.length === 0 && olderRequests.length > 0 && stored.diagnosticRef !== null
                        ? 'the newer take sent no observed coaching request, so excluding it is unproven'
                        : 'the older take has no captured request link, so binding is unproven')
                        : 'the report references an unrelated or newer-take diagnostic request',
                { olderRequests: olderRequests.length, newerRequests: newerRequests.length });
        } catch (error) {
            receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
            throw error;
        } finally {
            await generations.settle();
            // The WHOLE scenario, after feedback and navigation: at most one request per saved take (two in all).
            coachingRequestBudgetRow(receipt, generations, { maximum: 2, oneRequestPerSession: takes });
            if (owner.uid && reportId) {
                accountDeleted = await feedbackRetentionAfterDeletionRow(receipt, admin as never, reportId,
                    () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
            } else if (owner.uid && !accountDeleted) {
                try {
                    await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
                    accountDeleted = true;
                    receipt.row('run-owned cleanup', 'PASS', 'the run-owned account was deleted; no report retention row was available to check');
                } catch {
                    receipt.row('run-owned cleanup', 'FAIL', 'run-owned account deletion or residue readback failed');
                }
            }
            if (owner.uid && !accountDeleted) {
                await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }).catch(() => undefined);
            }
            await finishReceipt(receipt, testInfo, tap, claimed);
        }
    });

    test('No session feedback stores no take or coaching link', async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        const owner: Owner = { email: '', uid: '' };
        const receipt = new RwtReceipt(`${SUITE}-no-session`);
        const tap = new AnalyticsTap();
        const generations = new CoachingGenerationTap();
        tap.attach(page); generations.attach(page);
        let claimed = false;
        let accountDeleted = false;
        let reportId: string | null = null;
        try {
            await suppressPageSnapshot(testInfo);
            const ready = await prepareDisposable(page, receipt, owner);
            claimed = ready;
            if (!ready) return;
            const stored = await submitFeedback(page, tap, owner.uid, 'no_session', null);
            reportId = stored.id;
            receipt.row('no-session report stored once', stored.storedRows === 1 && stored.id ? 'PASS' : 'FAIL',
                stored.storedRows === 1 && stored.id ? 'one no-session feedback report was acknowledged and read back' : 'feedback was not stored exactly once',
                { storedRows: stored.storedRows });
            receipt.row('no-session association', stored.sessionId === null ? 'PASS' : 'FAIL',
                stored.sessionId === null ? 'the report has no session association' : 'the report was linked to a session despite No session being selected');
            receipt.row('no-session diagnostic binding', stored.diagnosticRef === null ? 'PASS' : 'FAIL',
                stored.diagnosticRef === null ? 'the report has no coaching diagnostic reference' : 'the report borrowed a coaching diagnostic reference');
        } catch (error) {
            receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
            throw error;
        } finally {
            await generations.settle();
            // No session links no take, so the whole scenario must send no coaching request at all.
            coachingRequestBudgetRow(receipt, generations, { maximum: 0 });
            if (owner.uid && reportId) {
                accountDeleted = await feedbackRetentionAfterDeletionRow(receipt, admin as never, reportId,
                    () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
            } else if (owner.uid && !accountDeleted) {
                try {
                    await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
                    accountDeleted = true;
                    receipt.row('run-owned cleanup', 'PASS', 'the run-owned account was deleted; no report retention row was available to check');
                } catch {
                    receipt.row('run-owned cleanup', 'FAIL', 'run-owned account deletion or residue readback failed');
                }
            }
            if (owner.uid && !accountDeleted) {
                await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }).catch(() => undefined);
            }
            await finishReceipt(receipt, testInfo, tap, claimed);
        }
    });
});
