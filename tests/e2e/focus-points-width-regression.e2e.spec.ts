import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';

/**
 * #1046 G6/G7 §7.9 — the regression pass. The four slots must hold position across before/during/after at
 * 1280 / 1440 / 1024, and no card may stretch past its content or overflow the page horizontally.
 *
 * #1255 — Focus Points has NO per-product break from the shared slot map: Slot C (Coverage & pace) renders
 * in every state, before included (guide-only in before). All three states assert all four slots present and
 * the coverage-pace card visible.
 *
 * The AFTER sweep also guards a real regression this test caught: on save the LIVE brief is cleared (the
 * Open-Mic isolation invariant), which used to strip the whole FP review screen. The finished-brief SNAPSHOT
 * now keeps coverage-pace / delivery strip / highlights alive in after — this asserts that end to end.
 */

/**
 * #1429 E — seven points is the product's maximum, and the narrow widths are where a full set is
 * most likely to clip. A sweep that only ever renders three points at desktop widths cannot see the
 * regression a user with a full set would hit on a phone.
 */
const WIDTHS = [1280, 1440, 1024, 390, 375, 320] as const;

/** A full seven-point set — the maximum the setup form accepts. */
const SEVEN_POINTS = [
  'Name the price',
  'State the guarantee',
  'Explain the timeline',
  'Cover the onboarding',
  'Mention the support team',
  'Describe the migration plan',
  'Confirm the renewal terms',
] as const;
const HEIGHT = 900;
const DIR = 'test-results/fp-g6g7-widths';

/** No horizontal overflow: the document never scrolls wider than the viewport (±1px rounding). */
async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow at ${label}`).toBeLessThanOrEqual(1);
}

async function assertSlots(page: Page) {
  // #1255 — all four slots present in every state, Coverage & pace included (guide-only in before).
  await expect(page.getByTestId('session-slot-a')).toBeVisible();
  await expect(page.getByTestId('session-slot-b')).toBeVisible();
  await expect(page.getByTestId('session-slot-c')).toBeVisible();
  await expect(page.getByTestId('session-slot-d')).toBeVisible();
  await expect(page.getByTestId('coverage-pace')).toBeVisible();
}

async function sweepWidths(page: Page, state: 'before' | 'during' | 'after') {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: HEIGHT });
    await assertSlots(page);
    await assertNoHorizontalOverflow(page, `${state}@${w}`);
    await page.screenshot({ path: `${DIR}/fp-${state}-${w}.png`, fullPage: true });
  }
}

test.describe('#1046 G6/G7 — Focus Points slots hold at 1280/1440/1024', () => {
/** Every entered point renders, in order, and the rail never forces the page to scroll sideways. */
async function assertEveryPointUsable(page: Page, label: string) {
  for (const width of [320, 375, 390, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: HEIGHT });
    for (let i = 0; i < SEVEN_POINTS.length; i++) {
      await expect(page.getByTestId(`focus-point-${i}`), `point ${i} at ${width} in ${label}`).toBeVisible();
      await expect(page.getByTestId(`focus-point-${i}`), `point ${i} text at ${width} in ${label}`).toContainText(SEVEN_POINTS[i]);
    }
    await assertNoHorizontalOverflow(page, `${label} @${width}`);
  }
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
}

  test('before → during → after hold position with a full seven-point set at every supported width', async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await navigateToRoute(page, '/practice');

    // Open the Focus Points capture dialog and complete a FULL set (topic + all seven points).
    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
    for (let i = 3; i < SEVEN_POINTS.length; i++) {
      await page.getByTestId('objective-add-point').click();
    }
    for (let i = 0; i < SEVEN_POINTS.length; i++) {
      await page.getByTestId(`objective-point-label-${i}`).fill(SEVEN_POINTS[i]);
    }
    await page.getByTestId('objective-setup-submit').click();

    // ---- BEFORE ----
    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('focus-points-topic')).toContainText('Sales or product pitch');
    await assertEveryPointUsable(page, 'before');
    await sweepWidths(page, 'before');

    // ---- DURING ---- (this sweep measures LAYOUT; detection coverage is owned by the focused
    // coverage unit tests and the isolation journey, not by a width regression.)
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await startRecording(page);
    await simulateTranscription(page, 'So first I will name the price clearly, and then state the guarantee we offer to every customer.', true);
    await expect(page.getByTestId('coverage-pace')).toBeVisible({ timeout: 15_000 });
    await assertEveryPointUsable(page, 'during');
    await sweepWidths(page, 'during');

    // ---- AFTER ---- (proves the finished-brief snapshot keeps the FP review screen after save)
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard (matches post-save-consolidation)
    await stopRecording(page);
    // Gate on the app's OWN deterministic saved + after-state signals, not a component testid race.
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    await assertEveryPointUsable(page, 'after');
    // The after-state actions must stay reachable with a full set — a seven-row rail that pushes
    // Retry and Start a new set off the surface is a dead end for the user on a narrow screen.
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: HEIGHT });
      await expect(page.getByTestId('focus-points-retry'), `retry at ${width}`).toBeVisible();
      await expect(page.getByTestId('focus-points-new-set'), `new set at ${width}`).toBeVisible();
      await assertNoHorizontalOverflow(page, `after actions @${width}`);
    }
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await sweepWidths(page, 'after');
  });
});
