import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
  waitForFeature,
} from './helpers';

/**
 * RWT item 3 (#1258) — a returning person opens a saved Focus Points take in Analytics.
 *
 * Runbook action through the rendered detail: finish a Focus take (two of three points spoken) → open that session in
 * Analytics → the SAVED point results are there, in the same words and colours as the live rail (2/3 detected; the
 * unspoken point red "Not detected") → reload: unchanged → the ONE practice action ("Practice this again") opens the
 * SAME set on the session page, ready for a new take.
 *
 * The E2E double stores Focus results with the server's verdict rule (a signal with a time is `detected`, else
 * `not_detected`) and keeps them across a reload. Synthetic speech proves wiring; matcher quality on real speech and the
 * received revisit telemetry belong to the deployed runbook rehearsal.
 */
const POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline'] as const;

async function newestSessionId(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const sb = (window as unknown as { supabase: { from: (t: string) => { select: (c: string) => PromiseLike<{ data: Array<{ id: string }> | null }> } } }).supabase;
    const { data } = await sb.from('sessions').select('id');
    return data?.[0]?.id ?? null;
  });
  expect(id, 'the saved session id').toBeTruthy();
  return id!;
}

async function assertSavedResults(page: Page, when: string) {
  const saved = page.getByTestId('saved-focus-points');
  await expect(saved, `saved Focus results ${when}`).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('saved-coverage-total')).toHaveText('2/3 points detected');
  for (const i of [0, 1]) {
    await expect(saved.getByTestId(`focus-point-${i}`)).toContainText(POINTS[i]);
    await expect(saved.getByTestId(`focus-point-${i}`), `point ${i} ${when}`).toHaveAttribute('data-status', 'covered');
    await expect(saved.getByTestId(`focus-point-${i}-verdict`)).toContainText(/^Detected/);
  }
  await expect(saved.getByTestId('focus-point-2')).toContainText(POINTS[2]);
  await expect(saved.getByTestId('focus-point-2'), `unspoken point ${when}`).toHaveAttribute('data-status', 'missing');
  await expect(saved.getByTestId('focus-point-2-verdict')).toHaveText('Not detected');
  await expect(saved.getByTestId('focus-point-2')).toContainText('You may have covered it in different words.');
  await expect(page.getByTestId('saved-focus-points-error')).toHaveCount(0);
  await expect(page.getByTestId('saved-review'), `the saved review is Focus Points ${when}`).toHaveAttribute('data-product', 'focus_points');
  await expect(page.getByTestId('saved-review-practice'), 'the ONE practice action').toHaveCount(1);
}

test.describe('RWT item 3 — saved Focus Points results in Analytics', () => {
  test('saved take: 2/3 detected with a red Not detected; survives reload; Practice again reopens the same set', async ({ page }) => {
    test.setTimeout(120_000);
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
    for (let i = 0; i < POINTS.length; i++) await page.getByTestId(`objective-point-label-${i}`).fill(POINTS[i]);
    await page.getByTestId('objective-setup-submit').click();
    await page.waitForURL('**/session');

    await startRecording(page);
    await simulateTranscription(page, 'First I will name the price clearly for everyone. Then I state the guarantee we offer on every order.', true);
    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    // The live verdict has published (so the results were written) before we leave the review.
    await expect(page.getByTestId('focus-point-2')).toHaveAttribute('data-status', 'missing', { timeout: 15_000 });
    const sessionId = await newestSessionId(page);

    // ── Analytics detail for this saved take ──
    await navigateToRoute(page, `/analytics/${sessionId}`);
    await waitForFeature(page, 'analytics');
    await assertSavedResults(page, 'on first open');

    // ── Reload: the saved results are read back, not remembered by the page ──
    await page.reload();
    await waitForFeature(page, 'analytics');
    await assertSavedResults(page, 'after reload');

    // ── The one next action: practise the SAME set again ──
    await page.getByTestId('saved-review-practice').click();
    await page.waitForURL('**/session', { timeout: 15_000 });
    const rail = page.getByTestId('focus-points-rail');
    await expect(rail, 'the same Focus set is ready').toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < POINTS.length; i++) {
      await expect(rail.getByTestId(`focus-point-${i}`)).toContainText(POINTS[i]);
      await expect(rail.getByTestId(`focus-point-${i}`), 'a fresh take: nothing judged yet').toHaveAttribute('data-status', 'pending');
    }
  });
});
