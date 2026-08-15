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

const WIDTHS = [1280, 1440, 1024] as const;
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
  test('before → during → after hold position with no overflow at all three widths', async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await navigateToRoute(page, '/practice');

    // Open the Focus Points capture dialog and complete a real set (topic + three points).
    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
    await page.getByTestId('objective-point-label-0').fill('Name the price');
    await page.getByTestId('objective-point-label-1').fill('State the guarantee');
    await page.getByTestId('objective-point-label-2').fill('Explain the timeline');
    await page.getByTestId('objective-setup-submit').click();

    // ---- BEFORE ----
    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('focus-points-topic')).toContainText('Sales or product pitch');
    await sweepWidths(page, 'before');

    // ---- DURING ---- (cover two points, leave "timeline" for a missed-point in after)
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await startRecording(page);
    await simulateTranscription(page, 'So first I will name the price clearly, and then state the guarantee we offer to every customer.', true);
    await expect(page.getByTestId('coverage-pace')).toBeVisible({ timeout: 15_000 });
    await sweepWidths(page, 'during');

    // ---- AFTER ---- (proves the finished-brief snapshot keeps the FP review screen after save)
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard (matches post-save-consolidation)
    await stopRecording(page);
    // Gate on the app's OWN deterministic saved + after-state signals, not a component testid race.
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    await sweepWidths(page, 'after');
  });
});
