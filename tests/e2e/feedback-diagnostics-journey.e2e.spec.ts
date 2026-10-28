/**
 * #1258 RWT-feedback-journey-preparation (PM 6110520212) — MOCKED feedback / coaching-failure journey.
 *
 * MOCKED EVIDENCE ONLY. Runs on the E2E build against a scripted boundary (`helpers/feedbackDiagnosticsJourney.ts`): it
 * proves the visible product flow and the report rows the client writes. It does NOT qualify Production, the real
 * `get-ai-suggestions` Edge function, Gemini, or CLI Dev's diagnostics — those are the deployed proof, run under its own
 * authority. The last case shows today's client cannot yet satisfy the diagnostic-chain contract: it HOLDs, never PASSes.
 */
import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';
import type { Page } from '@playwright/test';
import { boundaryRecord, installFeedbackDiagnosticsBoundary, scriptBoundary, type CoachingAnswer } from './helpers/feedbackDiagnosticsJourney';
import { validateFeedbackDiagnostics } from '../live/helpers/feedbackDiagnosticContract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAVED_COPY = "The review didn't load. Your session is saved.";
const NETWORK_COPY = 'The review could not connect. Check your connection and try again.';

/** One saved Open Mic take whose automatic coaching request gets `coaching`. Returns the saved session id. */
async function saveTake(page: Page, coaching: CoachingAnswer[]): Promise<string> {
    await scriptBoundary(page, { coaching });
    await startRecording(page);
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(5_200); // past the sub-5 s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
    const id = (await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'))) ?? '';
    expect(id, 'the saved session carries a Production-shaped (UUID) id').toMatch(UUID);
    return id;
}

/** Share Feedback: a "Something broke" report about `session` (a value of the session select, or 'none'). */
async function sendFeedback(page: Page, session: string | 'none' | 'default', note: string): Promise<void> {
    // The previous report's dialog must have finished closing before it is reopened, and the new one must own the keyboard
    // before it is used: a type click 23 ms after it appeared, while the last one was still closing, never took effect
    // and Send stayed disabled for the whole test timeout (run 40211203363).
    const dialog = page.getByTestId('issue-report-dialog');
    await expect(dialog, 'the previous feedback dialog finished closing').toBeHidden({ timeout: 5_000 });
    await page.getByTestId('nav-report-issue-button').first().click();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect.poll(
        () => dialog.evaluate((element) => element.contains(document.activeElement)),
        { message: 'the feedback dialog has keyboard focus', timeout: 5_000 },
    ).toBe(true);
    await page.getByTestId('feedback-type-broke').click();
    await expect(page.getByTestId('feedback-type-broke'), 'the "Something broke" choice took effect').toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('issue-report-description').fill(note);
    if (session !== 'default') {
        const select = page.getByTestId('feedback-session-select');
        if (session === 'none') await select.selectOption({ label: 'No session' });
        else await select.selectOption(session);
    }
    await page.getByTestId('issue-report-submit').click();
}

const acknowledged = (page: Page) => page.locator('li[data-sonner-toast]').filter({ hasText: 'Thanks — we’ve got it.' });

test.describe('#1258 MOCKED — coaching failure → Share Feedback journey', () => {
    test.beforeEach(async ({ page }) => {
        await installFeedbackDiagnosticsBoundary(page);
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');
    });

    test('coaching succeeds; feedback about the current take is stored exactly once and acknowledged', async ({ page }) => {
        const saved = await saveTake(page, ['success']);
        await expect(page.getByTestId('ai-suggestions-pair')).toBeVisible({ timeout: 15_000 });
        await sendFeedback(page, 'default', 'MOCKED journey: coaching was fine, testing the report path.');
        await expect(acknowledged(page)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('issue-report-dialog')).toHaveCount(0);
        const record = await boundaryRecord(page);
        expect(record.coachingRequests).toEqual([{ sessionId: saved }]);
        expect(record.storedReports.map((r) => r.sessionId), 'one row, linked to the current take').toEqual([saved]);
    });

    test('unavailable coaching is terminal and honest: one request, saved-session copy, a manual Try again that recovers', async ({ page }) => {
        const saved = await saveTake(page, ['unavailable']);
        const card = page.getByTestId('ai-suggestions-card');
        await expect(card).toHaveAttribute('data-lifecycle', 'terminal', { timeout: 15_000 });
        await expect(page.getByTestId('ai-suggestions-headline')).toHaveText(SAVED_COPY);
        await expect(card).toHaveAttribute('data-retry-scheduled', 'false');
        await page.waitForTimeout(3_500); // longer than the automatic-retry backoff: 503 must not be retried by itself
        expect((await boundaryRecord(page)).coachingRequests, 'unavailable consumes no automatic retry (#1486)').toHaveLength(1);
        await scriptBoundary(page, { coaching: ['success'] });
        await page.getByTestId('ai-suggestions-retry').click();
        await expect(page.getByTestId('ai-suggestions-pair')).toBeVisible({ timeout: 15_000 });
        expect((await boundaryRecord(page)).coachingRequests).toEqual([{ sessionId: saved }, { sessionId: saved }]);
    });

    test('a transport failure gets exactly one automatic retry, then honest copy and a manual Try again', async ({ page }) => {
        await saveTake(page, ['network', 'network']);
        const card = page.getByTestId('ai-suggestions-card');
        await expect(card).toHaveAttribute('data-lifecycle', 'terminal', { timeout: 20_000 });
        await expect(page.getByTestId('ai-suggestions-headline')).toHaveText(NETWORK_COPY);
        await expect(page.getByTestId('ai-suggestions-retry')).toBeVisible();
        await page.waitForTimeout(3_500);
        expect((await boundaryRecord(page)).coachingRequests, 'bounded: the first try plus one automatic retry').toHaveLength(2);
    });

    test('a delayed answer shows "on its way", then the pair, from a single request', async ({ page }) => {
        await saveTake(page, ['delayed:3000']);
        await expect(page.getByTestId('ai-suggestions-headline')).toHaveText('Your review is on its way.', { timeout: 10_000 });
        await expect(page.getByTestId('ai-suggestions-pair')).toBeVisible({ timeout: 15_000 });
        expect((await boundaryRecord(page)).coachingRequests).toHaveLength(1);
    });

    test('a storage failure is told truthfully, keeps the draft, and the retry stores exactly one row', async ({ page }) => {
        const saved = await saveTake(page, ['unavailable']);
        await scriptBoundary(page, { storage: ['failed'] });
        await sendFeedback(page, 'default', 'MOCKED journey: the review did not load.');
        await expect(page.getByRole('alert')).toHaveText('That didn’t go through. Try again?', { timeout: 15_000 });
        await expect(page.getByTestId('issue-report-dialog')).toBeVisible();
        await expect(page.getByTestId('issue-report-description')).toHaveValue('MOCKED journey: the review did not load.');
        await page.getByTestId('issue-report-submit').click();
        await expect(acknowledged(page)).toBeVisible({ timeout: 15_000 });
        const record = await boundaryRecord(page);
        expect(record.reportInserts.map((i) => i.outcome)).toEqual(['failed', 'stored']);
        expect(new Set(record.reportInserts.map((i) => i.idempotencyKey)).size, 'the retry is the same draft').toBe(1);
        expect(record.storedReports.map((r) => r.sessionId)).toEqual([saved]);
    });

    test('a SERVER-REJECTED insert (42501) is told truthfully, logged once, keeps the draft, and the retry stores one row', async ({ page }) => {
        // The service logs a rejected insert with logger.error before throwing; the harness treats any console error as
        // fatal. Replace that guard for THIS test with an equally strict one that tolerates only the service's own line.
        page.removeAllListeners('console');
        const serviceErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() !== 'error') return;
            if (msg.text().includes('[issueReportService.submit]')) { serviceErrors.push(msg.text()); return; }
            throw new Error(`[E2E_FATAL_CONSOLE_ERROR] ${msg.text()}`);
        });
        const saved = await saveTake(page, ['success']);
        await scriptBoundary(page, { storage: ['rejected'] });
        await sendFeedback(page, 'default', 'MOCKED journey: server refused the report.');
        await expect(page.getByRole('alert')).toHaveText('That didn’t go through. Try again?', { timeout: 15_000 });
        await expect(page.getByTestId('issue-report-description')).toHaveValue('MOCKED journey: server refused the report.');
        await expect(acknowledged(page)).toHaveCount(0);
        await page.getByTestId('issue-report-submit').click();
        await expect(acknowledged(page)).toBeVisible({ timeout: 15_000 });
        const record = await boundaryRecord(page);
        expect(record.reportInserts.map((i) => i.outcome)).toEqual(['rejected', 'stored']);
        expect(record.storedReports.map((r) => r.sessionId), 'one row, after the rejection').toEqual([saved]);
        expect(serviceErrors, 'the rejection is logged exactly once').toHaveLength(1);
    });

    test('a stored report whose reply was lost is not stored twice: the retry meets the idempotency index', async ({ page }) => {
        await saveTake(page, ['success']);
        await scriptBoundary(page, { storage: ['stored_reply_lost'] });
        await sendFeedback(page, 'default', 'MOCKED journey: reply lost after storage.');
        await expect(page.getByRole('alert')).toHaveText('That didn’t go through. Try again?', { timeout: 15_000 });
        await page.getByTestId('issue-report-submit').click();
        await expect(acknowledged(page)).toBeVisible({ timeout: 15_000 });
        const record = await boundaryRecord(page);
        expect(record.reportInserts.map((i) => i.outcome)).toEqual(['stored_reply_lost', 'replayed']);
        expect(record.storedReports, 'exactly once').toHaveLength(1);
    });

    test('a report about an OLDER take links that take; "No session" links none', async ({ page }) => {
        const older = await saveTake(page, ['success']);
        await expect(page.getByTestId('ai-suggestions-pair')).toBeVisible({ timeout: 15_000 });
        // The next take starts from a fresh session page, as the RWT's next Start does; the login (and its list) carries over.
        await navigateToRoute(page, '/session');
        const current = await saveTake(page, ['success']);
        expect(current).not.toBe(older);
        await sendFeedback(page, older, 'MOCKED journey: about my earlier take.');
        await expect(acknowledged(page)).toBeVisible({ timeout: 15_000 });
        // The first report's toast can still be on screen, so `.last()` alone could pass on it. Mark every toast already
        // shown; the second report is acknowledged only by an UNMARKED one, after its own dialog has closed. (A count
        // would race the first toast's own auto-dismissal.)
        await page.locator('li[data-sonner-toast]').evaluateAll((toasts) => toasts.forEach((t) => t.setAttribute('data-e2e-earlier', '')));
        await sendFeedback(page, 'none', 'MOCKED journey: not about a session.');
        await expect(page.getByTestId('issue-report-dialog'), 'the second report\'s dialog closed').toBeHidden({ timeout: 15_000 });
        await expect(
            page.locator('li[data-sonner-toast]:not([data-e2e-earlier])').filter({ hasText: 'Thanks — we’ve got it.' }),
            'the second report produced its own acknowledgement',
        ).toBeVisible({ timeout: 15_000 });
        const stored = (await boundaryRecord(page)).storedReports.map((r) => r.sessionId);
        expect(stored).toEqual([older, null]);
    });

    test('today\'s client cannot satisfy the diagnostic-chain contract: the lookup HOLDs, it never falsely PASSes', async ({ page }) => {
        const saved = await saveTake(page, ['unavailable']);
        await sendFeedback(page, 'default', 'MOCKED journey: the review did not load.');
        await expect(acknowledged(page)).toBeVisible({ timeout: 15_000 });
        const [row] = (await boundaryRecord(page)).storedReports;
        // What support can retrieve from today's client: the report and its session, but no AI request identity — the
        // client sends none yet (CLI Dev's RWT-ai-feedback-diagnostics). Built only from what the boundary recorded.
        const lookup = {
            report: {
                reportId: row.idempotencyKey ?? '', sessionId: row.sessionId, association: 'current_take' as const, linkedRequestId: null,
                storage: 'stored_once' as const, acknowledgementVisible: true, telemetryReceived: false,
            },
            requests: [],
        };
        const verdict = validateFeedbackDiagnostics(lookup, {
            reportId: row.idempotencyKey ?? '', association: 'current_take', sessionId: saved, requestId: 'unknown-until-diagnostics-land',
            outcome: 'provider_error', attemptId: null, failureCategory: 'unavailable', serverReason: 'provider_http_5xx', configuredModel: 'gemini-3.8-flash',
            currentRequestId: 'unknown-until-diagnostics-land',
        });
        expect(verdict.verdict).toBe('HOLD');
        expect(verdict.reasons).toEqual(expect.arrayContaining(['request_link_missing', 'telemetry_not_received']));
    });
});
