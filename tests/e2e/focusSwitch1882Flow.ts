import { expect, type TestInfo } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes, simulateTranscription, startRecording, stopRecording } from './helpers';

/**
 * #1882 isolated reproduction of the live Focus switch row (rwtFocusPointsJourney, "take after switching products").
 * Live run 43715342978 reviewed the post-switch Focus take with no rail rows, so Start a new set was never offered.
 * The older mocked switch spec starts from a fresh login; the live journey reaches the switch from a completed Focus
 * take, then an Open Mic take, then Products → Focus Points with four points and a short take that hears point 1.
 * This replays that order on the mocked backend with the controller trace armed (states and counts only).
 *
 * The flow only asserts the harness steps (each take saved, each review reached). The specs that use it judge the
 * switch take's review separately, so a red harness step and a red product verdict land in different shards.
 */
export const TOPIC = 'Quarterly update';
export const POINTS = ['Name the revenue number', 'Explain the hiring plan', 'Describe the product launch', 'Ask for the budget'] as const;
const ALL_POINTS = POINTS.map((p) => `I will ${p.toLowerCase()}.`).join(' ');

/** Three recorded takes with 5–8 s holds each; the default 60 s test budget is too short. */
export const SWITCH_FLOW_TIMEOUT_MS = 240_000;

type Page = Parameters<typeof programmaticLoginWithRoutes>[0];
export type TraceEvent = Record<string, unknown> & { event?: string };

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

export type SwitchFlowResult = { switchTrace: TraceEvent[]; rows: string[]; newSet: number };

/** Focus take → Open Mic take → Products → Focus Points → short take that hears point 1; returns what the review shows. */
export async function runFocusSwitchFlow(page: Page, testInfo: TestInfo): Promise<SwitchFlowResult> {
  // Same heartbeat stub as the shared page fixture, so a spec on plain fixtures runs the identical flow.
  await page.route(/\/rest\/v1\/rpc\/heartbeat_session(\?.*)?$/, (route) => route.fulfill({
    status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true }),
  }));
  await page.addInitScript(() => { (window as unknown as { __NATIVE_BROWSER_TRACE__: unknown[] }).__NATIVE_BROWSER_TRACE__ = []; });
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/practice');
  await page.getByTestId('practice-card-objective').click();
  await saveSet(page);
  await recordTake(page, ALL_POINTS, 5_200);

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
  await page.waitForTimeout(2_000); // let the after view settle before reading it
  const switchTrace = (await controllerTrace(page)).slice(traceBefore);
  const rows = await page.locator('[data-testid^="focus-point-"]').evaluateAll(
    (els) => els.map((e) => `${e.getAttribute('data-testid')}=${e.getAttribute('data-status')}`));
  const newSet = await page.getByTestId('focus-points-new-set').count();
  await testInfo.attach('switch-take-trace', {
    body: JSON.stringify({ switchTrace, rows, newSet }, null, 2),
    contentType: 'application/json',
  });
  return { switchTrace, rows, newSet };
}
