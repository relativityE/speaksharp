/**
 * Track 1 — Post-save UX consolidation (mobile + desktop).
 *
 * Proves the settled post-save Session page: ONE status bar (no separate post-save surface, never two
 * Analytics actions), the Analytics action (rightmost, /analytics) with a bounded cue, the quiet Private
 * CTA visibility + de-duplication (exactly one visible "Set up Private" nudge after a Native save), the
 * mode-aware reconciliation copy (Browser-omission is Native-only), and the boundary-anchored completion toast that
 * never obscures the transcript or moves the cards. Captures 320 / 375 / 390 / desktop screenshots for Native and Private.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  navigateToRoute,
  mockLiveTranscript,
  selectTranscriptionEngine,
  programmaticLoginWithRoutes,
  openSessionDetailFromHistoryItem,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const SHOTS = 'test-results/post-save-consolidation';
const VIEWPORTS = [
  { name: '320', width: 320, height: 720 },
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

async function recordAndStop(page: Page) {
  const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
  await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15000 });
  await startButton.click();
  await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
  await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
  await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).not.toContainText('Listening...');
  await page.waitForTimeout(5200); // clear the sub-5s no-persist guard
  await startButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });
}

async function assertOneBarNoOldSurface(page: Page) {
  await expect(page.getByTestId('live-session-header')).toHaveCount(1);
  await expect(page.getByTestId('post-save-review-actions')).toHaveCount(0);
  const analytics = page.getByTestId('post-save-review-session-link');
  await expect(analytics).toHaveCount(1);
  await expect(analytics).toHaveAttribute('href', '/analytics');
}

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box | null, b: Box | null) =>
  !!(a && b) && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

// The toast must STRADDLE the recording/transcript boundary (overlap both cards' adjacent edges) while
// never intersecting the transcript heading, the transcript content, or the mobile sticky action bar.
async function assertToastStraddleGeometry(page: Page) {
  const toast = await page.getByTestId('post-save-toast').boundingBox();
  const rec = await page.getByTestId('live-recording-card').boundingBox();
  const panel = await page.getByTestId(TEST_IDS.TRANSCRIPT_PANEL).boundingBox();
  const heading = await page.getByRole('heading', { name: 'Live Transcript' }).boundingBox();
  const content = await page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).boundingBox();
  expect(toast && rec && panel && heading && content).toBeTruthy();
  if (!toast || !rec || !panel || !heading || !content) return;
  const recBottom = rec.y + rec.height;
  const toastBottom = toast.y + toast.height;
  // Overlaps the recording card's bottom boundary...
  expect(toast.y).toBeLessThan(recBottom);
  expect(toastBottom).toBeGreaterThan(recBottom);
  // ...and the transcript card's top boundary.
  expect(toast.y).toBeLessThan(panel.y);
  expect(toastBottom).toBeGreaterThan(panel.y);
  // Never covers the left "Live Transcript" heading or the transcript content.
  expect(intersects(toast, heading)).toBeFalsy();
  expect(intersects(toast, content)).toBeFalsy();
  // ~12–16px from the right card edge.
  const rightGap = (panel.x + panel.width) - (toast.x + toast.width);
  expect(rightGap).toBeGreaterThanOrEqual(6);
  expect(rightGap).toBeLessThanOrEqual(28);
}

async function shoot(page: Page, prefix: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${prefix}-${vp.name}.png`, fullPage: false });
  }
}

test.describe('Post-save consolidation', () => {
  test('Native (eligible): one bar, one Private nudge, boundary-anchored toast, bounded cue', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await expect(page.getByText(/Practice Session/i)).toBeVisible();

    await recordAndStop(page);

    await assertOneBarNoOldSurface(page);
    await expect(page.getByTestId('live-session-header')).toContainText(/Session saved ·/);

    // De-dup: exactly ONE visible "Set up Private" nudge after save — the status-bar CTA, NOT the card nudge.
    const cta = page.getByTestId('post-save-private-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/Try Private — the main beta experience/i);
    await expect(page.getByTestId('first-run-setup-private')).toHaveCount(0);

    // Toast: absolute (anchored to the boundary, not fixed/sticky), informational (no inner CTA).
    const toast = page.getByTestId('post-save-toast');
    await expect(toast).toContainText('Next: Analytics');
    await expect(toast).toContainText('See your trends and deeper feedback.');
    await expect(toast).not.toContainText(/full transcript/i);
    await expect(toast.locator('button, a')).toHaveCount(0);
    const pos = await toast.evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe('absolute');
    await assertToastStraddleGeometry(page);

    // Analytics cue: bounded PULSE on settle, then a PERSISTENT static green emphasis (never reverts to plain).
    const analyticsCue = page.getByTestId('post-save-review-session-link');
    await expect(analyticsCue).toHaveAttribute('data-cue-phase', 'pulsing');
    await expect(analyticsCue).toHaveAttribute('data-cue-active', 'true');
    // Bold + success-green base emphasis.
    await expect(analyticsCue).toHaveClass(/font-bold/);
    await expect(analyticsCue).toHaveClass(/text-\[hsl\(var\(--success/);
    await page.waitForTimeout(7000);
    // Pulse ends → PERSISTENT static emphasis remains (still actionable, no animation).
    await expect(analyticsCue).toHaveAttribute('data-cue-phase', 'persistent');
    await expect(analyticsCue).toHaveAttribute('data-cue-active', 'true');
    await expect(analyticsCue).toHaveClass(/bg-\[hsl\(var\(--success/);
    const persistAnim = await analyticsCue.evaluate((el) => getComputedStyle(el).animationName);
    expect(persistAnim === 'none' || persistAnim === '' || persistAnim == null).toBeTruthy();

    await shoot(page, 'native');
    // Persistent-state close-up per width for review (settled green emphasis, no pulse).
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await analyticsCue.screenshot({ path: `${SHOTS}/analytics-persistent-${vp.name}.png` });
    }
  });

  test('Native: toast adds no layout movement, clears the sticky bar, and auto-dismisses', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await recordAndStop(page);
    await expect(page.getByTestId('post-save-toast')).toBeVisible();

    // Card coordinates WITH the toast present.
    const recDuring = await page.getByTestId('live-recording-card').boundingBox();
    const panelDuring = await page.getByTestId(TEST_IDS.TRANSCRIPT_PANEL).boundingBox();
    // Toast must not intersect the mobile sticky Start Recording bar.
    const toastBox = await page.getByTestId('post-save-toast').boundingBox();
    const stickyBar = await page.getByTestId(`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`).boundingBox();
    expect(intersects(toastBox, stickyBar)).toBeFalsy();
    await page.screenshot({ path: `${SHOTS}/native-toast-visible.png` });

    await page.waitForTimeout(9000); // > 8s + fade
    await expect(page.getByTestId('post-save-toast')).toHaveCount(0);

    // Card coordinates AFTER the toast is gone must be identical (absolute toast → no layout movement).
    const recAfter = await page.getByTestId('live-recording-card').boundingBox();
    const panelAfter = await page.getByTestId(TEST_IDS.TRANSCRIPT_PANEL).boundingBox();
    expect(recAfter?.y).toBeCloseTo(recDuring?.y ?? -1, 0);
    expect(panelAfter?.y).toBeCloseTo(panelDuring?.y ?? -1, 0);
    await page.screenshot({ path: `${SHOTS}/native-toast-expired.png` });
  });

  test('Private: one bar, Analytics only, NO Private CTA, NEVER Browser-omission copy', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'private');
    await expect(page.getByTestId(TEST_IDS.STT_MODE_SELECT)).toHaveAttribute('data-state', 'private', { timeout: 10000 });

    await recordAndStop(page);

    await assertOneBarNoOldSurface(page);
    await expect(page.getByTestId('live-session-header')).toContainText(/Session saved ·/);
    await expect(page.getByTestId('post-save-private-cta')).toHaveCount(0);
    await expect(page.getByTestId('live-session-header')).not.toContainText(/Browser transcription may omit/i);
    await assertToastStraddleGeometry(page);

    await shoot(page, 'private');
  });

  test('Free (ineligible): Native session shows NO Private CTA', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');
    await recordAndStop(page);
    await assertOneBarNoOldSurface(page);
    await expect(page.getByTestId('post-save-private-cta')).toHaveCount(0);
  });

  test('SessionPage final transcript equals the persisted Analytics/detail transcript', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await recordAndStop(page);
    // Let the native formatter reach terminal (the displayed final text is settled).
    await expect(page.getByTestId('post-save-review-session-link')).toBeVisible({ timeout: 15000 });
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const sessionText = norm(await page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).innerText());
    expect(sessionText.length).toBeGreaterThan(0);

    await navigateToRoute(page, '/analytics');
    const latest = page.getByTestId(/session-history-item-/).first();
    await openSessionDetailFromHistoryItem(page, latest);
    const detailText = norm(await page.getByTestId('session-detail-transcript').innerText());

    // The persisted detail transcript must match what SessionPage displayed as final.
    expect(detailText).toContain(sessionText);
  });

  test('Reduced motion: the Analytics cue never pulses — it shows the persistent static green emphasis immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await recordAndStop(page);
    const analytics = page.getByTestId('post-save-review-session-link');
    // No pulsing phase at all — straight to persistent static emphasis.
    await expect(analytics).toHaveAttribute('data-cue-phase', 'persistent');
    await expect(analytics).toHaveAttribute('data-cue-active', 'true');
    await expect(analytics).toHaveClass(/bg-\[hsl\(var\(--success/);
    const anim = await analytics.evaluate((el) => getComputedStyle(el).animationName);
    expect(anim === 'none' || anim === '' || anim == null).toBeTruthy(); // pulse suppressed under reduced-motion
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/native-reduced-motion.png` });
  });
});
