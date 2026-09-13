/**
 * #1422 P7 — the completed-session journey, end to end.
 *
 * The individual pieces are unit-proven: the review fires itself, the disclosure is in the card body,
 * the verdict keeps its Practice-again action, errors are classified from the server's status. None of
 * that says the USER reaches a review. This walks the actual outcome — speak, stop, save, and arrive at
 * a completed session that offers coaching and a way to go again — at desktop AND mobile, because the
 * defect P1 fixed existed only at desktop widths where the mobile action bar is hidden.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  navigateToRoute,
  mockLiveTranscript,
  programmaticLoginWithRoutes,
  startRecording,
  stopRecording,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 812 },
];

async function recordAndStop(page: Page) {
  await startRecording(page);
  await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
  await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
  // Clears the sub-5s no-persist guard, so this is a genuinely completed session rather than a discard.
  await page.waitForTimeout(5_200);
  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
}

test.describe('#1422 P7 — a completed session offers coaching and a way to go again', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: the practice loop is reachable after save`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await recordAndStop(page);

      // The session settled into its review.
      await expect(page.getByTestId('post-save-review-session-link')).toBeVisible({ timeout: 15_000 });

      // P6 — the provider disclosure is visible in the card BODY, wherever the send happens. With the
      // request firing on its own, a user must not learn their transcript went to Google from text
      // attached to a button they never pressed.
      const disclosure = page.getByTestId('ai-suggestions-disclosure');
      await expect(disclosure).toBeVisible({ timeout: 15_000 });
      await expect(disclosure).toContainText(/Google Gemini/i);
      await expect(disclosure).toContainText(/Audio is never sent/i);

      // P1 — the desktop control that starts another take. This is the assertion that would have caught
      // the review evicting the verdict: at `md` and above the mobile action bar is hidden, so this is
      // the only way back into a recording from the completed screen.
      const practiceAgain = page.getByTestId('verdict-practice-again');
      await expect(practiceAgain).toBeVisible({ timeout: 15_000 });
      await expect(practiceAgain).toBeEnabled();
    });
  }

  test('desktop: Practice this again actually starts a new take', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await recordAndStop(page);

    await expect(page.getByTestId('post-save-review-session-link')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('verdict-practice-again').click();

    // Back in a session that can record: the control returns to its start affordance rather than the
    // page merely re-rendering the completed state.
    await expect(page.getByTestId('mic-start').or(page.getByTestId('recorder-stop')))
      .toBeVisible({ timeout: 15_000 });
    // And the completed-session review surface is gone, so this is a NEW attempt rather than the old one.
    await expect(page.getByTestId('post-save-review-session-link')).toHaveCount(0, { timeout: 15_000 });
  });
});
