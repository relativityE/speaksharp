/**
 * Track 1 — Post-save UX consolidation.
 *
 * Proves the settled post-save Session page: ONE status bar (no separate post-save surface, never two
 * Analytics actions), the Analytics action (rightmost, /analytics), the quiet Private CTA visibility
 * conditions (Native + eligible only; never for Private), mode-aware reconciliation copy (Browser-omission
 * is Native-only), and the one-shot completion toast. Captures Native/Private × desktop/mobile settled
 * screenshots for the review evidence.
 */
import { test, expect } from './fixtures';
import {
  navigateToRoute,
  mockLiveTranscript,
  selectTranscriptionEngine,
  programmaticLoginWithRoutes,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const SHOTS = 'test-results/post-save-consolidation';

async function recordAndStop(page: import('@playwright/test').Page) {
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

async function assertOneBarNoOldSurface(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('live-session-header')).toHaveCount(1);
  await expect(page.getByTestId('post-save-review-actions')).toHaveCount(0);
  const analytics = page.getByTestId('post-save-review-session-link');
  await expect(analytics).toHaveCount(1);               // exactly one Analytics action, ever
  await expect(analytics).toHaveAttribute('href', '/analytics');
}

test.describe('Post-save consolidation', () => {
  test('Native (eligible): one bar, Analytics + quiet Private CTA, toast, no Browser-omission surprise', async ({ page }) => {
    // Pro user who stays on the default Native engine → canUsePrivateStt true → Private CTA shows.
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await expect(page.getByText(/Practice Session/i)).toBeVisible();

    await recordAndStop(page);

    await assertOneBarNoOldSurface(page);
    // Left side carries the mode-aware reconciliation copy (not the generic save message).
    await expect(page.getByTestId('live-session-header')).toContainText(/Session saved ·/);
    // Quiet Private CTA present with the exact existing copy (Native + eligible).
    const cta = page.getByTestId('post-save-private-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/Set up Private for cleaner local transcription/i);
    // One-shot completion toast, informational (no CTA inside).
    const toast = page.getByTestId('post-save-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Next: Analytics');
    await expect(toast.locator('button, a')).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: `${SHOTS}/native-desktop.png`, fullPage: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/native-mobile.png`, fullPage: false });
  });

  test('Private: one bar, Analytics only, NO Private CTA, NEVER Browser-omission copy', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await expect(page.getByText(/Practice Session/i)).toBeVisible();
    await selectTranscriptionEngine(page, 'private');
    await expect(page.getByTestId(TEST_IDS.STT_MODE_SELECT)).toHaveAttribute('data-state', 'private', { timeout: 10000 });

    await recordAndStop(page);

    await assertOneBarNoOldSurface(page);
    // Private never offers the Native→Private CTA...
    await expect(page.getByTestId('post-save-private-cta')).toHaveCount(0);
    // ...and never receives Browser-specific copy, but still shows the reconciliation copy.
    await expect(page.getByTestId('live-session-header')).toContainText(/Session saved ·/);
    await expect(page.getByTestId('live-session-header')).not.toContainText(/Browser transcription may omit/i);
    await expect(page.getByTestId('post-save-toast')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: `${SHOTS}/private-desktop.png`, fullPage: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/private-mobile.png`, fullPage: false });
  });

  test('Free (ineligible): Native session shows NO Private CTA', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');
    await expect(page.getByText(/Practice Session/i)).toBeVisible();

    await recordAndStop(page);

    await assertOneBarNoOldSurface(page);
    await expect(page.getByTestId('post-save-private-cta')).toHaveCount(0); // ineligible → hidden
  });
});
