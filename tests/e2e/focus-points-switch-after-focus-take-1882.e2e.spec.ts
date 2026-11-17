import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, simulateTranscription, startRecording, stopRecording } from './helpers';

/**
 * #1882 isolated reproduction of the live Focus switch row (rwtFocusPointsJourney, "take after switching products").
 * Live run 43715342978 reviewed the post-switch Focus take with no rail rows, so Start a new set was never offered.
 * The older mocked switch spec starts from a fresh login; the live journey reaches the switch from a completed Focus
 * take, then an Open Mic take, then Products → Focus Points with four points and a short take that hears point 1.
 * This replays that order on the mocked backend with the controller trace armed (states and counts only).
 */
const TOPIC = 'Quarterly update';
const POINTS = ['Name the revenue number', 'Explain the hiring plan', 'Describe the product launch', 'Ask for the budget'] as const;
const ALL_POINTS = POINTS.map((p) => `I will ${p.toLowerCase()}.`).join(' ');

type Page = Parameters<typeof programmaticLoginWithRoutes>[0];
type TraceEvent = Record<string, unknown> & { event?: string };

async function saveSet(page: Page) {
  await expect(page.getByTestId('objective-setup-dialog')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('objective-goal-select').selectOption('other');
  await page.getByTestId('objective-goal-input').fill(TOPIC);
  for (let i = 0; i < POINTS.length; i += 1) {
    if ((await page.getByTestId(`objective-point-label-${i}`).count()) === 0) await page.getByTestId('objective-add-point').click();
    await page.getByTestId(`objective-point-label-${i}`).fill(POINTS[i]);
  }
  await page.getByTestId('objective-setup-submit').click();
}

async function recordTake(page: Page, transcript: string, holdMs: number) {
  const before = await page.locator('html').getAttribute('data-session-persisted-id');
  await startRecording(page);
  await simulateTranscription(page, transcript, true);
  await page.waitForTimeout(holdMs); // past the app's 5 s minimum-duration persistence guard
  await stopRecording(page);
  await expect.poll(() => page.locator('html').getAttribute('data-session-persisted-id'), { timeout: 30_000 }).not.toBe(before);
  await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
}

async function controllerTrace(page: Page): Promise<TraceEvent[]> {
  const all = await page.evaluate(() => (window as unknown as { __NATIVE_BROWSER_TRACE__?: TraceEvent[] }).__NATIVE_BROWSER_TRACE__ ?? []);
  return all.filter((e) => String(e.event ?? '').startsWith('controller_'));
}

test.describe('#1882 Focus switch after a completed Focus take', () => {
  test('Focus take, Open Mic take, then Products → Focus: the short take keeps its rail and offers Start a new set', async ({ page }, testInfo) => {
    await page.addInitScript(() => { (window as unknown as { __NATIVE_BROWSER_TRACE__: unknown[] }).__NATIVE_BROWSER_TRACE__ = []; });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-objective').click();
    await saveSet(page);
    await recordTake(page, ALL_POINTS, 5_200);
    await expect(page.getByTestId('focus-point-0')).toBeVisible();

    await page.getByTestId('nav-products-button').click();
    await page.getByTestId('nav-products-open-mic').click();
    await page.waitForURL(/\/session/, { timeout: 45_000 });
    await recordTake(page, ALL_POINTS, 5_200);

    await page.getByTestId('nav-products-button').click();
    await page.getByTestId('nav-products-focus-points').click();
    await saveSet(page);
    await page.waitForURL(/\/session/, { timeout: 45_000 });
    await expect(page.getByTestId('focus-points-rail')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('focus-point-3')).toHaveAttribute('data-status', 'pending');

    const traceBefore = (await controllerTrace(page)).length;
    await recordTake(page, `I will ${POINTS[0].toLowerCase()}.`, 8_000);
    const switchTrace = (await controllerTrace(page)).slice(traceBefore);
    const rows = await page.locator('[data-testid^="focus-point-"]').evaluateAll(
      (els) => els.map((e) => `${e.getAttribute('data-testid')}=${e.getAttribute('data-status')}`));
    await testInfo.attach('switch-take-trace', {
      body: JSON.stringify({ switchTrace, rows, newSet: await page.getByTestId('focus-points-new-set').count() }, null, 2),
      contentType: 'application/json',
    });

    for (let i = 0; i < POINTS.length; i += 1) {
      await expect(page.getByTestId(`focus-point-${i}`), `switch take review row ${i}; trace ${JSON.stringify(switchTrace)}`).toBeVisible();
    }
    await expect(page.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
    await expect(page.getByTestId('focus-points-new-set'), `trace ${JSON.stringify(switchTrace)}`).toBeVisible({ timeout: 30_000 });
  });
});
