import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';

/**
 * RWT item 4 (#1258) — Focus-aware coaching as the person meets it: finish a Focus Points take and read the coaching.
 *
 * The coaching function refuses (425 focus_results_pending) until the take's point results are saved; the client waits
 * that out without an error and without spending a retry. This journey drives the rendered card through that window:
 *   PENDING: the card says coaching is still coming — no error, no "Try again", no pair;
 *   SETTLED: the persisted pair renders;
 *   REQUEST: every request names this saved session and `product: focus_points` (Open Mic control: `open_mic`).
 *
 * The E2E double serves the function's contract (opt-in `__E2E_COACHING_1258__`); the server's own 425 rule, Focus
 * context and cache binding are proven by `get-ai-suggestions/index.test.ts`. Whether the coaching is RELEVANT to the
 * points is a human judgement for the deployed runbook, not something synthetic speech or a stub can show.
 */
const POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline'] as const;
const PAIR = {
  version: 'gemini_coaching_v1',
  what_worked: 'You named the price early and plainly.',
  what_to_try_next: 'Explain the timeline before you close.',
};

async function enableCoaching(page: Page, pending: number) {
  await page.evaluate((cfg) => {
    (window as unknown as { __E2E_COACHING_1258__?: unknown }).__E2E_COACHING_1258__ = cfg;
  }, { pending, suggestions: PAIR });
}
type Shown = { stillComing: number; retry: number; pair: number };
type Sent = { body: { sessionId?: string | null; product?: string } | null; shown: Shown };
const requests = (page: Page): Promise<Sent[]> => page.evaluate(() =>
  ((window as unknown as { __E2E_COACHING_REQUESTS_1258__?: Sent[] }).__E2E_COACHING_REQUESTS_1258__ ?? []));

async function recordAndSave(page: Page, transcript: string) {
  await startRecording(page);
  await simulateTranscription(page, transcript, true);
  await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
  await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('RWT item 4 — Focus-aware coaching through the rendered review', () => {
  test('Focus Points: coaching waits for saved point results without an error, then the pair renders; the request is focus_points', async ({ page }) => {
    test.setTimeout(120_000);
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
    for (let i = 0; i < POINTS.length; i++) await page.getByTestId(`objective-point-label-${i}`).fill(POINTS[i]);
    await page.getByTestId('objective-setup-submit').click();
    await page.waitForURL('**/session');

    // The function will refuse twice (results not saved yet), then answer.
    await enableCoaching(page, 2);
    await recordAndSave(page, 'First I will name the price clearly for everyone. Then I state the guarantee we offer on every order.');

    await expect(page.getByTestId('ai-suggestions-card')).toBeVisible({ timeout: 15_000 });

    // SETTLED: the persisted pair renders.
    const pair = page.getByTestId('ai-suggestions-pair');
    await expect(pair).toBeVisible({ timeout: 30_000 });
    await expect(pair).toContainText(PAIR.what_worked);
    await expect(pair).toContainText(PAIR.what_to_try_next);
    await expect(page.getByTestId('ai-suggestions-retry'), 'no failure left behind').toHaveCount(0);

    // REQUEST: two refusals + one answer, each for this saved session, each Focus Points.
    const sent = await requests(page);
    expect(sent.length, 'two 425 waits then the answer').toBe(3);
    expect(sent[0].body?.sessionId, 'a saved session id').toBeTruthy();
    expect(new Set(sent.map((r) => r.body?.sessionId)).size, 'one saved session').toBe(1);
    expect(sent.map((r) => r.body?.product)).toEqual(['focus_points', 'focus_points', 'focus_points']);

    // PENDING, as rendered: at each re-ask (i.e. throughout each 425 wait) the card said coaching is still coming —
    // never an error or a retry offer, and no pair yet.
    for (const i of [1, 2]) {
      expect(sent[i].shown, `what the card showed during 425 wait ${i}`).toEqual({ stillComing: 1, retry: 0, pair: 0 });
    }
  });

  test('Open Mic control: the same card asks as open_mic and renders the pair on the first answer', async ({ page }) => {
    test.setTimeout(120_000);
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await enableCoaching(page, 0);
    await recordAndSave(page, 'Today I will explain the plan in three clear steps for the team.');

    await expect(page.getByTestId('ai-suggestions-pair')).toBeVisible({ timeout: 30_000 });
    const sent = await requests(page);
    expect(sent.map((r) => r.body?.product)).toEqual(['open_mic']);
  });
});
