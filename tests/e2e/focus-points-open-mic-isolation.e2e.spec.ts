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
 * #1256 / PR #1271 — the DECISIVE isolation journey.
 *
 * Completing a Focus Points take must never leak the objective into the next Open Mic session. The store
 * clears the LIVE brief on save (so it can never attach to the next recording) and keeps a review-only
 * SNAPSHOT alive for the after-state; the snapshot is cleared the moment the next recording starts, and is
 * ignored outside the after-state. This spec proves that contract end-to-end through the real UI:
 *
 *   Focus Points setup → record → save → REVIEW (snapshot keeps the FP after-state alive)
 *     → return to Practice → start Open Mic → assert NO objective survives, even with matching keywords,
 *       across the fresh session's before / during / after.
 *
 * The Open Mic transcript deliberately repeats the prior brief's point keywords ("price", "guarantee",
 * "timeline"). If any stale objective state leaked, the local keyword matcher would light a coverage rail
 * on Open Mic — so re-using those exact words is the sharpest possible isolation probe.
 */

/**
 * The user may enter ANY number of Focus Points, and every point they enter must be captured and
 * detected. There is no criteria count. This journey uses four only because it is not the number of
 * rows the form happens to open with, so a set built by the user is exercised rather than the
 * default layout — four is a sample, never a specification.
 *
 * The Open Mic leg re-speaks these keywords on purpose.
 */
const POINT_LABELS = [
  'Name the price',
  'State the guarantee',
  'Explain the timeline',
  'Cover the onboarding',
] as const;

/** One sentence per entered point, so the take genuinely covers all four. */
const SPEAKS_EVERY_POINT =
  'First I will name the price clearly. Then I state the guarantee we offer. '
  + 'Next I explain the timeline for delivery. Finally I cover the onboarding steps.';

/** Enter every label into the setup dialog, adding rows beyond the three initial ones. */
async function enterEveryPoint(page: Page) {
  await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
  await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
  for (let i = 3; i < POINT_LABELS.length; i++) {
    await page.getByTestId('objective-add-point').click();
  }
  for (let i = 0; i < POINT_LABELS.length; i++) {
    await page.getByTestId(`objective-point-label-${i}`).fill(POINT_LABELS[i]);
  }
  await page.getByTestId('objective-setup-submit').click();
}

/** Every entered point is present, in order, and every one reports Detected. */
async function assertEveryPointDetected(page: Page, label: string) {
  await expect(page.getByTestId('coverage-pace-total'), `total in ${label}`).toHaveText(`/${POINT_LABELS.length}`);
  await expect(page.getByTestId('coverage-pace-covered'), `covered in ${label}`).toHaveText(String(POINT_LABELS.length));
  for (let i = 0; i < POINT_LABELS.length; i++) {
    await expect(page.getByTestId(`focus-point-${i}`), `point ${i} in ${label}`).toHaveAttribute('data-status', 'covered');
    await expect(page.getByTestId(`focus-point-${i}`), `point ${i} label in ${label}`).toContainText(POINT_LABELS[i]);
  }
}

/** Focus Points chrome that must be ABSENT from any Open Mic state. */
async function assertNoObjectiveChrome(page: Page, label: string) {
  await expect(page.getByTestId('focus-points-rail'), `focus-points-rail leaked into ${label}`).toHaveCount(0);
  await expect(page.getByTestId('coverage-pace'), `coverage-pace leaked into ${label}`).toHaveCount(0);
  await expect(page.getByTestId('focus-delivery-strip'), `focus-delivery-strip leaked into ${label}`).toHaveCount(0);
  // The transcript header must not carry the Focus Points "n of m points covered" scoreboard.
  await expect(page.getByText(/points covered/i), `coverage scoreboard leaked into ${label}`).toHaveCount(0);
}

/** Drive a full record → save → after-state cycle (clears the sub-5s no-persist guard). */
async function recordSaveAndSettle(page: Page, transcript: string) {
  await startRecording(page);
  await simulateTranscription(page, transcript, true);
  await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
  await expect(
    page.locator('[data-testid="session-shell"][data-session-state="after"]'),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('#1256 — Focus Points review state never leaks into the next Open Mic take', () => {
  test('Focus Points → save → review → Open Mic starts (and stays) clean', async ({ page }) => {
    test.setTimeout(120_000);

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');

    // ---- FOCUS POINTS: setup → session ----
    await page.getByTestId('practice-card-objective').click();
    await enterEveryPoint(page);

    // BEFORE (Focus Points): the plan rail is present — this is genuinely a Focus Points session.
    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('coverage-pace-total')).toHaveText(`/${POINT_LABELS.length}`);

    // RECORD → SAVE → REVIEW. EVERY entered point is spoken, so every one must be detected. There is
    // no case in which a point the user entered is allowed to go missing.
    await recordSaveAndSettle(page, SPEAKS_EVERY_POINT);

    // AFTER (Focus Points): the finished-brief SNAPSHOT keeps the review screen alive after the live brief
    // was cleared on save — coverage card + rail render, proving the snapshot path works, and the
    // snapshot preserves every entered point with its coverage.
    await expect(page.getByTestId('coverage-pace')).toBeVisible();
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await assertEveryPointDetected(page, 'Focus Points after-state');

    // ---- RETURN TO PRACTICE → OPEN MIC ----
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await page.waitForURL('**/session');

    // BEFORE (Open Mic): a fresh session shows the Open Mic prompt offer and NO objective chrome, even
    // though the completed-brief snapshot still sits in the store (it is ignored outside the after-state).
    await expect(page.getByTestId('prompt-offer')).toBeVisible();
    await assertNoObjectiveChrome(page, 'Open Mic before');

    // DURING (Open Mic): re-speak the EXACT prior point keywords. If any objective state leaked, the
    // keyword matcher would light a coverage rail — it must not.
    await startRecording(page);
    await simulateTranscription(
      page,
      'Let me talk about the price, the guarantee, the timeline and the onboarding for all of this today.',
      true,
    );
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({
      timeout: 15_000,
    });
    await assertNoObjectiveChrome(page, 'Open Mic during');

    // AFTER (Open Mic): save and settle; the review screen is the generic Open Mic one — still no
    // objective coverage, rail, delivery strip, or scoreboard.
    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(
      page.locator('[data-testid="session-shell"][data-session-state="after"]'),
    ).toBeVisible({ timeout: 15_000 });
    await assertNoObjectiveChrome(page, 'Open Mic after');
  });

  // #1256 P1 — "Retry these points" must REBIND the finished brief and start a Focus Points take, not an
  // Open Mic one. The live brief was cleared on save, so without the rebind the retry silently degrades to
  // Open Mic and can never re-score the saved point set.
  test('Retry these points restarts as Focus Points, not Open Mic', async ({ page }) => {
    test.setTimeout(120_000);

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');

    await page.getByTestId('practice-card-objective').click();
    await enterEveryPoint(page);
    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();

    await recordSaveAndSettle(page, SPEAKS_EVERY_POINT);
    // After-state Focus Points review is up (snapshot path); the retry control lives on the rail.
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await assertEveryPointDetected(page, 'before retry');

    // Retry → a fresh recording that is still Focus Points (rail present, Open Mic prompt offer absent).
    await page.getByTestId('focus-points-retry').click();
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('coverage-pace')).toBeVisible();
    await expect(page.getByTestId('prompt-offer')).toHaveCount(0);

    // The retry rebinds the SAME four points, in order, and starts them uncovered — a retry that
    // silently dropped to the three default rows, or carried the previous take's ticks, would be a
    // different set than the one the user asked to retry.
    await expect(page.getByTestId('coverage-pace-total')).toHaveText(`/${POINT_LABELS.length}`);
    await expect(page.getByTestId('coverage-pace-covered')).toHaveText('0');
    for (let i = 0; i < POINT_LABELS.length; i++) {
      await expect(page.getByTestId(`focus-point-${i}`)).toContainText(POINT_LABELS[i]);
    }
  });
});
