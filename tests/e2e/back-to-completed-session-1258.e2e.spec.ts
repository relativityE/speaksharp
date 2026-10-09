/**
 * #1258 PR 4 (Rev 2 §4, D1) — Back returns to the completed session.
 *
 * Production diagnostic run 37706942773 reproduced the defect: after a saved take, Progress → browser Back showed the
 * idle recorder (`mic-start`, no verdict, no THIS RUN) while the document still held the saved session id. The fix
 * names the saved session in the URL and restores it read-only on re-entry. This journey runs on the E2E build (mock
 * engine); the real-engine confirmation is the same Production diagnostic, rerun under its own authorization.
 */
import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

// A UUID in production; the E2E double mints `session-…` ids.
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

test.describe('#1258 PR 4 — Back returns to the completed session', () => {
    test('the save names the session in the URL; Progress → Back and a reload restore it read-only', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');
        const historyBeforeSave = await page.evaluate(() => window.history.length);

        await startRecording(page);
        await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
        await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
        await stopRecording(page);
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
        const savedId = (await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'))) ?? '';
        expect(savedId).toMatch(SESSION_ID);

        // §4.1: the saved session is in the URL, and the save added no history entry.
        await expect(page).toHaveURL(new RegExp(`/session\\?review=${savedId}$`));
        expect(await page.evaluate(() => window.history.length)).toBe(historyBeforeSave);

        // From here on, nothing may request coaching: the restored view is read-only.
        const coachingRequests: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('/functions/v1/get-ai-suggestions')) coachingRequests.push(request.method());
        });

        // CASUALTY (run 37706942773): Progress, then browser Back — the completed session, never the idle recorder.
        await page.getByTestId('nav-analytics-link').first().click();
        await page.waitForURL(/\/analytics(\?|$)/);
        // Stay until Progress has rendered and the session page's exit transition is over: pressing Back mid-exit
        // returns the SAME still-mounted page (state intact) and would never exercise the remount the person hit
        // (they stayed ~64 s on Progress in run 37706942773).
        await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(2_000);
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/session\\?review=${savedId}$`));
        const restored = page.getByTestId('saved-session-return');
        await expect(restored).toBeVisible({ timeout: 15_000 });
        await expect(restored).toHaveAttribute('data-session-id', savedId);
        await expect(page.getByTestId('this-run-card')).toBeVisible();
        await expect(page.getByTestId('saved-review')).toBeVisible();
        await expect(page.getByTestId('mic-start')).toHaveCount(0);
        await expect(page.getByText(/^0 words$/)).toHaveCount(0);

        // A reload on the same URL restores it too.
        await page.reload();
        await expect(page.getByTestId('saved-session-return')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('mic-start')).toHaveCount(0);
        expect(coachingRequests, 'a restored session never requests coaching').toEqual([]);

        // "See all sessions" leaves for Progress.
        await page.getByTestId('saved-session-return-see-all').click();
        await page.waitForURL(/\/analytics(\?|$)/);
    });

    // Durable RED for the Production defect (Browser PM 6050587122): no URL assertion first, so on a pre-fix build this
    // reaches Back and fails on the idle recorder — exactly what run 37706942773 saw — instead of stopping earlier.
    test('CASUALTY (run 37706942773): Progress → Back never shows the idle recorder', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');
        await startRecording(page);
        await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
        await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(5_200);
        await stopRecording(page);
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

        await page.getByTestId('nav-analytics-link').first().click();
        await page.waitForURL(/\/analytics(\?|$)/);
        await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(2_000); // past the session page's exit transition (see the test above)
        await page.goBack();
        await page.waitForURL(/\/session/);

        await expect(page.getByTestId('this-run-card')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('mic-start')).toHaveCount(0);
    });

    test('an unknown session id falls back to the plain session page with no error', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session?review=00000000-0000-4000-8000-000000000000');
        await expect(page).toHaveURL(/\/session$/, { timeout: 20_000 });
        await expect(page.getByTestId('saved-session-return')).toHaveCount(0);
        await expect(page.getByText(/could not be loaded|Unable to load this session/i)).toHaveCount(0);
    });
});
