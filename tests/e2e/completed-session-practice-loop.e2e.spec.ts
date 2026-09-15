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

  // #1466 PM acceptance lock — the Practice Loop is the primary result, so it must be at eye level WITHOUT
  // scrolling: heading and current state inside the initial viewport at scrollY 0, ahead of the transcript,
  // with the saved confirmation still on screen. The Product Owner found it below the transcript and the
  // secondary cards, reachable only by scrolling; a forced scroll would also have qualified a page that
  // still buries it, so the page is pinned to the top before anything is measured.
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: the practice loop is at eye level at scrollY 0`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await recordAndStop(page);
      await expect(page.getByTestId('post-save-review-session-link')).toBeVisible({ timeout: 15_000 });

      const card = page.getByTestId('ai-suggestions-card');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      const inViewport = async (box: { y: number; height: number } | null) =>
        Boolean(box && box.y >= 0 && box.y + box.height <= viewport.height);

      const heading = card.getByText('Practice Loop review', { exact: true });
      await expect(heading).toBeVisible();
      expect(await inViewport(await heading.boundingBox()), 'Practice Loop heading inside the first viewport').toBe(true);

      // The heading is not merely inside the rectangle — nothing fixed (header, mobile action bar) covers it.
      const headingOnTop = await heading.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit && (el === hit || el.contains(hit)));
      });
      expect(headingOnTop, 'Practice Loop heading is not obscured').toBe(true);

      // The card's current state starts inside the viewport too, whichever state it is in.
      const cardBox = await card.boundingBox();
      expect(cardBox && cardBox.y < viewport.height, 'review state begins inside the first viewport').toBe(true);

      // Ahead of the transcript detail, in layout and reading order.
      const transcriptBox = await page.getByTestId('session-slot-b').boundingBox();
      expect(cardBox && transcriptBox && cardBox.y < transcriptBox.y, 'review band sits above the transcript').toBe(true);

      // The saved confirmation is still visible, not scrolled away.
      expect(await inViewport(await page.getByTestId('live-session-header').boundingBox()), 'saved confirmation stays on screen').toBe(true);
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
