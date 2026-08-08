import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, simulateTranscription } from './helpers';

/**
 * #1046 full-loop hardening proof (PO option B).
 *
 * Proves the Focus Points loop end-to-end as ONE unbroken run — the gap the per-slice tests did not
 * cover: Focus Points card → capture form → bound brief → /session → a real (mock-engine) recording →
 * stop → finalize → the coverage rail rendered with one row per declared point.
 *
 * The objective RPC chain (issue_objective_project/brief, register-source, start-session,
 * finalize-evidence) + the brief-point read are mocked in mock-routes.ts, so this exercises the real
 * client orchestration (setup form → stop-seam finalize → store → rail) without a live backend.
 *
 * Coverage matching is client-side and its threshold is intentionally NOT asserted here (that is unit-
 * tested in objectiveCoverage.test): computeObjectiveCoverage emits exactly one entry per declared point,
 * so the rail always shows both rows + the derived "n/2 covered" summary. This test proves the loop is
 * wired end-to-end, not the matcher's tuning.
 */
test.describe('#1046 Focus Points — full loop (setup → record → coverage rail)', () => {
    test('a Focus Points session renders the coverage rail with one row per declared point', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { userType: 'pro' });

        // 1) Enter Focus Points from the authenticated practice home.
        await navigateToRoute(page, '/practice');
        await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('practice-card-objective').click();

        // 2) Capture the brief: a goal + two focus points.
        await expect(page.getByTestId('objective-setup-dialog')).toBeVisible({ timeout: 15000 });
        await page.getByTestId('objective-goal-input').fill('2-minute sales pitch');
        await page.getByTestId('objective-point-label-0').fill('Name the price');
        await page.getByTestId('objective-point-label-1').fill('Handle the objection');
        await page.getByTestId('objective-setup-submit').click();

        // 3) The saved brief routes into the session.
        await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
        await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 20000 });

        // 4) Record with the mock engine — a session must clear MIN_SESSION_DURATION_SECONDS (5s) and the
        // save-quality guard (real speech, enough meaningful words) to persist, so drive a multi-line,
        // word-rich recording spread across >5s of wall-clock. Point 1 ("Name the price") is covered by the
        // spoken text; point 2 is left unmentioned.
        await page.getByTestId('session-start-stop-button').click();
        await page.waitForSelector('html[data-runtime-state="RECORDING"]', { timeout: 15000 });
        const lines = [
            'Today I want to walk through the whole plan clearly and confidently for you.',
            'The price is nine ninety nine dollars per month for the complete plan.',
            'Let me make sure that first point lands well before we wrap everything up here.',
        ];
        for (const line of lines) {
            await simulateTranscription(page, line, true);
            await page.waitForTimeout(2200);
        }
        await page.getByTestId('session-start-stop-button').click();

        // 5) After finalize, the Focus Points coverage rail appears with one row per declared point.
        const rail = page.getByTestId('coverage-rail');
        await expect(rail).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('coverage-rail-summary')).toHaveText(/\d\/2 covered/);
        await expect(page.getByTestId('coverage-point-0')).toBeVisible();
        await expect(page.getByTestId('coverage-point-1')).toBeVisible();
        await expect(rail).toContainText('Name the price');
        await expect(rail).toContainText('Handle the objection');
    });
});
