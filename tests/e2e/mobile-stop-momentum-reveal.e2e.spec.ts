import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';
import { mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, startRecording } from './helpers';

/**
 * #1258 RWT (PM: VALID P2, direct journey impact) — "Stop → see that the take saved" on a real phone.
 *
 * A person flicks the recording page down and taps Stop while the momentum scroll is still running. The app reveals
 * the saved review once (scroll to the top when the review settles), but the fling's momentum carried on past that
 * reveal and parked the page at the bottom: the saved confirmation ended ~757 px above the screen (5/5 on main).
 *
 * The oracle is the rendered page once scrolling has come to rest: the saved confirmation is on screen. Controls:
 * Stop pressed after the page came to rest (already worked), and a person who deliberately scrolls after the save is
 * NOT pulled back up — the fix may re-reveal once when momentum ends, never fight the person's own scrolling.
 * The touch fling is a real Chrome touch gesture with momentum (CDP `Input.synthesizeScrollGesture`, fling allowed).
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const VIEWPORT_HEIGHT = 812;

/**
 * A fast upward swipe (the page scrolls down) whose momentum is allowed to run on after the finger lifts. Returns the
 * gesture's completion WRAPPED, so the caller can act while it is still in flight (an async function returning the bare
 * promise would be flattened by `await`, and the caller would only resume once the whole gesture had ended).
 */
async function fling(page: Page, yDistance = -600): Promise<{ done: Promise<unknown> }> {
  const cdp = await page.context().newCDPSession(page);
  const done = cdp.send('Input.synthesizeScrollGesture', {
    x: 187, y: 600, yDistance, speed: 4000, gestureSourceType: 'touch', preventFling: false,
  }).catch(() => undefined);
  return { done };
}

/** scrollY unchanged across `ms` — the page (and any momentum) has come to rest. */
async function waitForRest(page: Page, ms = 400, timeout = 20_000) {
  let last = -1;
  await expect.poll(async () => {
    const y = await page.evaluate(() => window.scrollY);
    const same = y === last;
    last = y;
    await page.waitForTimeout(ms);
    return same;
  }, { timeout, message: 'the page came to rest' }).toBe(true);
}

async function confirmationOnScreen(page: Page): Promise<boolean> {
  const box = await page.getByTestId('live-session-header').boundingBox();
  return Boolean(box && box.y >= 0 && box.y + box.height <= VIEWPORT_HEIGHT);
}

async function recordUntilSavable(page: Page) {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/session');
  await startRecording(page);
  await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
  await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
}

async function tapStopAndSave(page: Page) {
  // The phone's Stop lives in the fixed bottom bar; dispatching avoids Playwright's scroll-into-view.
  await page.getByTestId(`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`).dispatchEvent('click');
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
  await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('#1258 mobile — Stop during a fling still shows that the take saved', () => {
  test('CASUALTY: Stop tapped while the fling momentum is still running → once at rest, the saved confirmation is on screen', async ({ page }) => {
    test.setTimeout(90_000);
    await recordUntilSavable(page);
    const gesture = await fling(page);
    // Precondition: the page is genuinely moving when Stop is tapped (momentum, not at rest).
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeGreaterThan(0);
    await tapStopAndSave(page);
    await gesture.done;
    await waitForRest(page);
    expect(await confirmationOnScreen(page), 'the saved confirmation is on screen after the momentum ends').toBe(true);
    // The contract is the confirmation on screen. Traced: the one re-check returns the page to 0 when momentum ends; the
    // synthetic gesture can then add a single ~50 px end-of-gesture move (no input, no app scroll), which the bounded
    // guard deliberately does not chase. So: back within the first half-screen, never parked at the bottom.
    expect(await page.evaluate(() => window.scrollY), 'the page is back near its top, not parked at the bottom').toBeLessThan(VIEWPORT_HEIGHT / 2);
  });

  test('CONTROL: Stop tapped after the page came to rest → the saved confirmation is on screen', async ({ page }) => {
    test.setTimeout(90_000);
    await recordUntilSavable(page);
    await (await fling(page)).done;
    await waitForRest(page, 300, 10_000);
    expect(await page.evaluate(() => window.scrollY), 'precondition: scrolled down').toBeGreaterThan(0);
    await tapStopAndSave(page);
    await waitForRest(page);
    expect(await confirmationOnScreen(page)).toBe(true);
  });

  test('CONTROL: a person who scrolls down on purpose right after the save is not pulled back up', async ({ page }) => {
    test.setTimeout(90_000);
    await recordUntilSavable(page);
    await (await fling(page)).done;
    await waitForRest(page, 300, 10_000);
    await tapStopAndSave(page);
    await waitForRest(page);
    expect(await confirmationOnScreen(page), 'precondition: revealed').toBe(true);
    // The person immediately scrolls down to read the review — a deliberate gesture, within any re-check window.
    await (await fling(page, -400)).done;
    await waitForRest(page);
    expect(await page.evaluate(() => window.scrollY), 'the page stays where the person scrolled it').toBeGreaterThan(0);
  });
});
