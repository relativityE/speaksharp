import { test, expect } from './fixtures';
import { TEST_IDS } from '../constants';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';

const OLD_TOPIC = 'Sales or product pitch';
const OLD_POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline'] as const;
const EDITED_POINT = 'State the updated guarantee';
const NEW_TOPIC = 'Conference talk / keynote';
const NEW_POINT = 'Close with the main takeaway';
const OPEN_MIC_MARKER = 'open mic take before switching products';
const FOCUS_MARKER = 'focus points take after switching products';

async function saveFocusSet(page: Parameters<typeof programmaticLoginWithRoutes>[0], topic: string, points: readonly string[]) {
  await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
  await page.getByTestId('objective-goal-select').selectOption(topic);
  for (let i = 3; i < points.length; i++) await page.getByTestId('objective-add-point').click();
  for (let i = 0; i < points.length; i++) await page.getByTestId(`objective-point-label-${i}`).fill(points[i]);
  await page.getByTestId('objective-setup-submit').click();
}

async function recordAndSave(page: Parameters<typeof programmaticLoginWithRoutes>[0], transcript: string) {
  await startRecording(page);
  await simulateTranscription(page, transcript, true);
  await page.waitForTimeout(5_200); // satisfy the app's minimum-duration persistence guard
  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
  await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('#1258 Focus Points controls and product-switch isolation', () => {
  test('Edit before the first take reopens the saved set and returns to the before state', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-objective').click();
    await saveFocusSet(page, OLD_TOPIC, OLD_POINTS);

    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();
    await expect(page.getByTestId('focus-points-topic')).toHaveText(OLD_TOPIC);
    await expect(page.getByTestId('focus-points-edit')).toBeVisible();
    await page.getByTestId('focus-points-edit').click();

    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await expect(page.getByTestId('objective-goal-select')).toHaveValue(OLD_TOPIC);
    for (let i = 0; i < OLD_POINTS.length; i++) {
      await expect(page.getByTestId(`objective-point-label-${i}`)).toHaveValue(OLD_POINTS[i]);
    }
    await page.getByTestId('objective-point-label-1').fill(EDITED_POINT);
    await page.getByTestId('objective-setup-submit').click();

    // Editing changes the declared set but does not start a recording or show a completed review.
    await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();
    await expect(page.getByTestId('focus-points-topic')).toHaveText(OLD_TOPIC);
    await expect(page.getByTestId('focus-point-1')).toContainText(EDITED_POINT);
    await expect(page.getByTestId('focus-point-1')).not.toContainText(OLD_POINTS[1]);
  });

  test('Start a new set opens blank after review, clears the prior take, and can record the new set', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-objective').click();
    await saveFocusSet(page, OLD_TOPIC, OLD_POINTS.slice(0, 1));
    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();

    const oldTake = 'the previous set says price';
    await recordAndSave(page, oldTake);
    await expect(page.getByTestId('focus-points-new-set')).toBeVisible();
    await page.getByTestId('focus-points-new-set').click();

    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await expect(page.getByTestId('objective-goal-select')).toHaveValue('');
    await expect(page.getByTestId('objective-point-label-0')).toHaveValue('');
    await expect(page.getByTestId('objective-point-label-1')).toHaveValue('');
    await expect(page.getByTestId('objective-point-label-2')).toHaveValue('');
    await expect(page.getByTestId('objective-setup-submit')).toBeDisabled();

    await saveFocusSet(page, NEW_TOPIC, [NEW_POINT]);
    await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();
    await expect(page.getByTestId('focus-points-topic')).toHaveText(NEW_TOPIC);
    await expect(page.getByTestId('focus-points-rail-list').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByTestId('focus-point-0')).toContainText(NEW_POINT);
    await expect(page.getByTestId('coverage-pace-plan')).toBeVisible();
    await expect(page.getByTestId('coverage-pace-covered')).toHaveCount(0); // before-state is a plan, not a score
    await expect(page.getByTestId('review-transcript')).toHaveCount(0);

    await recordAndSave(page, `Today ${NEW_POINT.toLowerCase()}.`);
    await expect(page.getByTestId('focus-points-topic')).toHaveText(NEW_TOPIC);
    await expect(page.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
    await expect(page.getByTestId('review-transcript')).not.toContainText(oldTake);
  });

  test('Open Mic → Focus Points switch starts a fresh Focus take with its own transcript and points', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await expect(page).toHaveURL(/\/session(?:\?|$)/);

    await recordAndSave(page, `Today ${OPEN_MIC_MARKER}.`);
    await expect(page.getByTestId('review-transcript')).toContainText(OPEN_MIC_MARKER);

    await page.getByTestId('nav-products-button').click();
    await page.getByTestId('nav-products-focus-points').click();
    await expect(page).toHaveURL(/\/practice\?product=focus-points$/);
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await saveFocusSet(page, NEW_TOPIC, [NEW_POINT]);

    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('prompt-offer')).toHaveCount(0);
    await expect(page.getByTestId('review-transcript')).toHaveCount(0);

    await startRecording(page);
    await simulateTranscription(page, `Now ${FOCUS_MARKER}. I will ${NEW_POINT.toLowerCase()}.`, true);
    const liveTranscript = page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT);
    await expect(liveTranscript).toContainText(new RegExp(FOCUS_MARKER, 'i'));
    await expect(liveTranscript).not.toContainText(new RegExp(OPEN_MIC_MARKER, 'i'));
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('focus-point-0')).toContainText(NEW_POINT);
    await expect(page.getByTestId('prompt-offer')).toHaveCount(0);

    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('focus-points-topic')).toHaveText(NEW_TOPIC);
    await expect(page.getByTestId('review-transcript')).toContainText(new RegExp(FOCUS_MARKER, 'i'));
    await expect(page.getByTestId('review-transcript')).not.toContainText(new RegExp(OPEN_MIC_MARKER, 'i'));
  });
});
