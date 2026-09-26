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
 * RWT item 2 (#1258) — the Focus Points rail as the person SEES it, through the runbook action: set three points,
 * speak two of them, stop.
 *
 *   DURING: a spoken point is green "Detected at m:ss"; the unspoken one is NOT red — it is "Still to cover" /
 *           "Not heard yet" (a verdict before Stop would accuse the speaker mid-take).
 *   AFTER:  the unspoken point turns red (numbered ring) with a visible "Not detected"; the colour key and exactly ONE
 *           detector-limitation note below the list appear — no row repeats the paraphrase caveat (G20); the spoken
 *           points stay Detected; the one next action (Retry) is there.
 *
 * Synthetic speech proves the WIRING from transcript to rendered rail. It is not a judgement of the matcher on real
 * speech, and this local build cannot observe RECEIVED telemetry (posthog-js is not a readable stub here) — both
 * belong to the deployed runbook rehearsal and its receipts.
 */
const POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline'] as const;
const SPEAKS_TWO = 'First I will name the price clearly for everyone. Then I state the guarantee we offer on every order.';

async function enterPoints(page: Page) {
  await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
  await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
  for (let i = 0; i < POINTS.length; i++) {
    await page.getByTestId(`objective-point-label-${i}`).fill(POINTS[i]);
  }
  await page.getByTestId('objective-setup-submit').click();
}

test.describe('RWT item 2 — the Focus Points rail during and after a take', () => {
  test('two of three points spoken: green while speaking, no red before Stop; red "Not detected" + key + note after Stop', async ({ page }) => {
    test.setTimeout(120_000);
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-objective').click();
    await enterPoints(page);
    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();

    // ── DURING ──
    await startRecording(page);
    await simulateTranscription(page, SPEAKS_TWO, true);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    for (const i of [0, 1]) {
      await expect(page.getByTestId(`focus-point-${i}`), `point ${i} detected while speaking`).toHaveAttribute('data-status', 'covered', { timeout: 15_000 });
      await expect(page.getByTestId(`focus-point-${i}-covered-at`)).toContainText(/Detected at \d+:\d{2}/);
    }
    await expect(page.getByTestId('focus-point-2'), 'the unspoken point is not a verdict mid-take').toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('focus-point-2')).toContainText(/Still to cover|Not heard yet/);
    await expect(page.getByTestId('focus-points-rail').getByText('Not detected', { exact: true }), 'no red before Stop').toHaveCount(0);
    await expect(page.getByTestId('focus-points-detection-note'), 'no verdict note mid-take').toHaveCount(0);

    // ── STOP → SAVED REVIEW ──
    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });

    for (const i of [0, 1]) {
      await expect(page.getByTestId(`focus-point-${i}`), `point ${i} stays detected`).toHaveAttribute('data-status', 'covered', { timeout: 15_000 });
    }
    await expect(page.getByTestId('focus-point-2'), 'the unspoken point is red after Stop').toHaveAttribute('data-status', 'missing', { timeout: 15_000 });
    await expect(page.getByTestId('focus-point-2-status')).toHaveText('Not detected');
    await expect(page.getByTestId('focus-point-2-not-detected')).toHaveText('We couldn’t detect this point in the transcript.');
    await expect(page.getByTestId('focus-point-2-marker')).toBeVisible();
    await expect(page.getByTestId('focus-point-2-marker')).toHaveAttribute('data-marker', 'missed');
    await expect(page.getByTestId('focus-point-2-marker')).toHaveText('3');
    await expect(page.getByTestId('focus-points-legend'), 'the colour key is shown with the verdict').toBeVisible();
    // G20: the limitation is stated ONCE, below the list — never repeated inside a row.
    await expect(page.getByTestId('focus-points-detection-note'), 'exactly one detection note').toHaveCount(1);
    await expect(page.getByTestId('focus-points-rail-list').getByText(/different words|covered it differently/i), 'no row repeats the caveat').toHaveCount(0);
    expect(await page.evaluate(() => {
      const list = document.querySelector('[data-testid="focus-points-rail-list"]');
      const note = document.querySelector('[data-testid="focus-points-detection-note"]');
      return Boolean(list && note && (list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING) && !list.contains(note));
    }), 'the note sits below the list').toBe(true);
    await expect(page.getByTestId('focus-points-retry'), 'the next action').toBeEnabled();
  });
});
