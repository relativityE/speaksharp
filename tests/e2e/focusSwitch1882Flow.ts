import { expect, type TestInfo } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes, simulateTranscription, startRecording } from './helpers';
import { openProductsItem } from '../live/helpers/productsMenu';

/**
 * #1882 isolated reproduction of the live Focus switch row (rwtFocusPointsJourney, "take after switching products").
 * Live run 43715342978 reviewed the post-switch Focus take with no rail rows, so Start a new set was never offered.
 * The older mocked switch spec starts from a fresh login; the live journey reaches the switch from a completed Focus
 * take, then an Open Mic take, then Products → Focus Points with four points and a short take that hears point 1.
 * This replays that order on the mocked backend with the controller trace armed (states and counts only).
 *
 * The flow only asserts the harness steps (each take saved, each review reached). Run 43991852001 timed every spec out
 * at the full budget with no step named (shard logs show no test names), so every wait here is bounded and the specs
 * stop at different steps in different shards: the first red shard names the step that fails.
 */
export const TOPIC = 'Quarterly update';
export const POINTS = ['Name the revenue number', 'Explain the hiring plan', 'Describe the product launch', 'Ask for the budget'] as const;
const ALL_POINTS = POINTS.map((p) => `I will ${p.toLowerCase()}.`).join(' ');

/** Three recorded takes with 5–8 s holds each; the default 60 s test budget is too short. */
export const SWITCH_FLOW_TIMEOUT_MS = 240_000;
/** Every single action is bounded, so a missing control fails in seconds instead of eating the whole budget. */
const STEP_MS = 20_000;

/**
 * Where the flow stops. bb7786ce (run 43995026716) passed the first Focus take and failed somewhere in the Open Mic
 * step, so that step is now split: the Products choice, Start offered, recording, and the saved take with its review.
 */
export type SwitchFlowStop =
  | 'first-focus-take' | 'open-mic-menu' | 'open-mic-ready' | 'open-mic-recording' | 'open-mic-take' | 'switch-take';
type TakeStop = 'ready' | 'recording' | 'review';

type Page = Parameters<typeof programmaticLoginWithRoutes>[0];
export type TraceEvent = Record<string, unknown> & { event?: string };

async function saveSet(page: Page) {
  const dialog = page.getByTestId('objective-setup-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('objective-goal-select').selectOption('other', { timeout: STEP_MS });
  await page.getByTestId('objective-goal-input').fill(TOPIC, { timeout: STEP_MS });
  for (let i = 0; i < POINTS.length; i += 1) {
    if ((await page.getByTestId(`objective-point-label-${i}`).count()) === 0) {
      await page.getByTestId('objective-add-point').click({ timeout: STEP_MS });
    }
    await page.getByTestId(`objective-point-label-${i}`).fill(POINTS[i], { timeout: STEP_MS });
  }
  await page.getByTestId('objective-setup-submit').click({ timeout: STEP_MS });
  await expect(dialog).toHaveCount(0, { timeout: STEP_MS });
}

async function recordTake(page: Page, transcript: string, holdMs: number, until: TakeStop = 'review') {
  const before = await page.locator('html').getAttribute('data-session-persisted-id');
  // startRecording/stopRecording click without a bound; prove each control is there first.
  await expect(page.getByTestId('mic-start')).toBeVisible({ timeout: 30_000 });
  if (until === 'ready') return;
  await startRecording(page);
  if (until === 'recording') return;
  await simulateTranscription(page, transcript, true);
  await page.waitForTimeout(holdMs); // past the app's 5 s minimum-duration persistence guard
  await page.getByTestId('recorder-stop').click({ timeout: STEP_MS });
  await expect.poll(() => page.locator('html').getAttribute('data-session-persisted-id'), { timeout: 30_000 }).not.toBe(before);
  await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
}

async function controllerTrace(page: Page): Promise<TraceEvent[]> {
  const all = await page.evaluate(() => (window as unknown as { __NATIVE_BROWSER_TRACE__?: TraceEvent[] }).__NATIVE_BROWSER_TRACE__ ?? []);
  return all.filter((e) => String(e.event ?? '').startsWith('controller_'));
}

export type SwitchFlowResult = { switchTrace: TraceEvent[]; rows: string[]; newSet: number };

/** Focus take → Open Mic take → Products → Focus Points → short take that hears point 1; returns what the review shows. */
export async function runFocusSwitchFlow(page: Page, testInfo: TestInfo, stopAfter: SwitchFlowStop = 'switch-take'): Promise<SwitchFlowResult> {
  const stopped: SwitchFlowResult = { switchTrace: [], rows: [], newSet: 0 };
  // Same heartbeat stub as the shared page fixture, so a spec on plain fixtures runs the identical flow.
  await page.route(/\/rest\/v1\/rpc\/heartbeat_session(\?.*)?$/, (route) => route.fulfill({
    status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true }),
  }));
  await page.addInitScript(() => { (window as unknown as { __NATIVE_BROWSER_TRACE__: unknown[] }).__NATIVE_BROWSER_TRACE__ = []; });
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/practice');
  await page.getByTestId('practice-card-objective').click({ timeout: STEP_MS });
  await saveSet(page);
  await recordTake(page, ALL_POINTS, 5_200);
  if (stopAfter === 'first-focus-take') return stopped;

  await openProductsItem(page, 'open-mic', STEP_MS);
  await page.waitForURL(/\/session/, { timeout: 45_000 });
  if (stopAfter === 'open-mic-menu') return stopped;
  const openMicStop: Partial<Record<SwitchFlowStop, TakeStop>> = { 'open-mic-ready': 'ready', 'open-mic-recording': 'recording' };
  await recordTake(page, ALL_POINTS, 5_200, openMicStop[stopAfter] ?? 'review');
  if (stopAfter in openMicStop || stopAfter === 'open-mic-take') return stopped;

  await openProductsItem(page, 'focus-points', STEP_MS);
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
