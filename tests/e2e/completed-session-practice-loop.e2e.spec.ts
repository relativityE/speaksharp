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
      // #1466 Codex P1 4010908720 — NO TEST SCROLL. This user never left the top of the page, so the result must
      // already be at eye level, and the product must not move them: a forced reset here would also have
      // qualified a page that buries the result for anyone who stopped further down.
      expect(await page.evaluate(() => window.scrollY), 'a top-of-page user stays stationary').toBe(0);

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

  // #1466 PM RETURN 5673020845 (Codex P1 4010908720) — the realistic path the top-of-page proof cannot see: the user
  // scrolls down through the stacked recording UI and stops there. Nothing in this test scrolls the page after Stop;
  // the application itself must bring the Practice Loop heading and current state into view, with the saved
  // confirmation still on screen. The stop control is operated without a helper click, because Playwright's click
  // scrolls its target into view and would silently undo the very position under test.
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: stopping while scrolled down brings the practice loop into view`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');

      await startRecording(page);
      await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
      await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(5_200);

      // The user scrolls down. Precondition: the page genuinely left the top, or this test proves nothing.
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 3_000);
      await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeGreaterThan(0);

      if (viewport.name === 'mobile') {
        // The phone's Stop lives in the fixed bottom bar — always on screen, so pressing it does not scroll.
        await page.getByTestId(`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`).dispatchEvent('click');
      } else {
        await page.getByTestId('recorder-stop').dispatchEvent('click');
      }
      await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
      await expect(page.getByTestId('post-save-review-session-link')).toBeAttached({ timeout: 15_000 });

      const card = page.getByTestId('ai-suggestions-card');
      await expect(card).toBeAttached({ timeout: 15_000 });
      const heading = card.getByText('Practice Loop review', { exact: true });
      const inViewport = async (box: { y: number; height: number } | null) =>
        Boolean(box && box.y >= 0 && box.y + box.height <= viewport.height);

      await expect.poll(async () => inViewport(await heading.boundingBox()), {
        timeout: 15_000,
        message: 'the application brought the Practice Loop heading into view without a test scroll',
      }).toBe(true);
      const headingOnTop = await heading.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit && (el === hit || el.contains(hit)));
      });
      expect(headingOnTop, 'Practice Loop heading is not obscured').toBe(true);
      expect(await inViewport(await page.getByTestId('live-session-header').boundingBox()), 'saved confirmation on screen').toBe(true);
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
