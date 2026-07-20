/**
 * Track 1 — Post-save UX consolidation (mobile + desktop).
 *
 * Proves the settled post-save Session page has ONE authoritative saved-state surface: the single
 * StatusNotificationBar carrying "Session saved · Your transcript is ready.", the quiet Private CTA
 * (Native + eligible), and exactly one Analytics action (rightmost, /analytics) with the bounded →
 * persistent green cue. There is NO separate "Next: Analytics" toast, and the recording-card pill does
 * not duplicate the saved message (it resets to its ready state). Validated + screenshotted at
 * 320 / 375 / 390 / 1280px.
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

// The status bar is the ONLY saved-state surface: no toast overlay, and the recording-card pill does
// not echo the saved message (it was reset to its ready state).
async function assertSingleSavedSurface(page: Page) {
  await expect(page.getByTestId('post-save-toast')).toHaveCount(0);
  await expect(page.getByText('Next: Analytics')).toHaveCount(0);
  await expect(page.getByTestId('live-recording-card')).not.toContainText(/Session saved/i);
  await expect(page.getByTestId('live-recording-card')).not.toContainText(/Great practice/i);
}

test.describe('Post-save consolidation', () => {
  test('Native (eligible): ONE saved surface — bar + Analytics + quiet Private CTA, no toast, pill reset, bounded→persistent cue', async ({ page }) => {
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

    // No "Next: Analytics" toast overlay; the recording-card pill does not duplicate the saved message.
    await assertSingleSavedSurface(page);

    // Analytics cue: bounded PULSE on settle, then a PERSISTENT static green emphasis (never reverts to plain).
    const analyticsCue = page.getByTestId('post-save-review-session-link');
    await expect(analyticsCue).toHaveAttribute('data-cue-phase', 'pulsing');
    await expect(analyticsCue).toHaveAttribute('data-cue-active', 'true');
    await expect(analyticsCue).toHaveClass(/font-bold/);
    await expect(analyticsCue).toHaveClass(/text-emerald-800/);
    await page.waitForTimeout(7000);
    await expect(analyticsCue).toHaveAttribute('data-cue-phase', 'persistent');
    await expect(analyticsCue).toHaveAttribute('data-cue-active', 'true');
    await expect(analyticsCue).toHaveClass(/bg-\[hsl\(var\(--success/);
    const persistAnim = await analyticsCue.evaluate((el) => getComputedStyle(el).animationName);
    expect(persistAnim === 'none' || persistAnim === '' || persistAnim == null).toBeTruthy();

    // WCAG AA on the RENDERED foreground/background pair: measure the actual computed text colour against
    // the pill background composited over its opaque surface. Normal 13px text requires >=4.5:1.
    const renderedContrast = await analyticsCue.evaluate((el) => {
      const nums = (s: string): number[] => (s.match(/[\d.]+/g) || []).map(Number);
      const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
      const fg = nums(getComputedStyle(el).color);
      const bgParts = nums(getComputedStyle(el).backgroundColor);
      const alpha = bgParts.length === 4 ? bgParts[3] : 1;
      // Composite the semi-transparent pill bg over the nearest opaque ancestor background.
      let surface = [255, 255, 255];
      for (let p = el.parentElement; p; p = p.parentElement) {
        const pc = nums(getComputedStyle(p).backgroundColor);
        if ((pc.length === 4 ? pc[3] : 1) === 1 && pc.length >= 3) { surface = [pc[0], pc[1], pc[2]]; break; }
      }
      const bg = [0, 1, 2].map((i) => alpha * bgParts[i] + (1 - alpha) * surface[i]);
      const la = lum(fg), lb = lum(bg);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    });
    expect(renderedContrast).toBeGreaterThanOrEqual(4.5);

    // Per-width proof (320/375/390/1280): exactly one saved surface + one Analytics action, no toast, pill reset.
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await expect(page.getByTestId('live-session-header')).toHaveCount(1);
      await expect(page.getByTestId('post-save-review-session-link')).toHaveCount(1);
      await assertSingleSavedSurface(page);
      await page.screenshot({ path: `${SHOTS}/native-${vp.name}.png`, fullPage: false });
      await analyticsCue.screenshot({ path: `${SHOTS}/analytics-persistent-${vp.name}.png` });
    }
  });

  test('Private: one bar, Analytics only, NO Private CTA, NO toast, NEVER Browser-omission copy', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'private');
    await expect(page.getByTestId(TEST_IDS.STT_MODE_SELECT)).toHaveAttribute('data-state', 'private', { timeout: 10000 });

    await recordAndStop(page);

    await assertOneBarNoOldSurface(page);
    await expect(page.getByTestId('live-session-header')).toContainText(/Session saved ·/);
    await expect(page.getByTestId('post-save-private-cta')).toHaveCount(0);
    await expect(page.getByTestId('live-session-header')).not.toContainText(/Browser transcription may omit/i);
    await assertSingleSavedSurface(page);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/private-${vp.name}.png`, fullPage: false });
    }
  });

  test('Free (ineligible): Native session shows NO Private CTA and one saved surface', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');
    await recordAndStop(page);
    await assertOneBarNoOldSurface(page);
    await expect(page.getByTestId('post-save-private-cta')).toHaveCount(0);
    await assertSingleSavedSurface(page);
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
    // And still a single saved surface (no toast) under reduced motion.
    await assertSingleSavedSurface(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/native-reduced-motion.png` });
  });
});
