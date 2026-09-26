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
 * Momentum is modelled in the page (scroll motion with no input); the person's deliberate scroll is a real touch.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const VIEWPORT_HEIGHT = 812;

/**
 * Scroll MOMENTUM as the page experiences it: the page keeps moving with no touch, wheel, key or pointer input — a
 * `requestAnimationFrame`-driven `scrollBy` (relative, so it keeps carrying the page after the app's own scrollTo, as a
 * real fling does). Deterministic on every runner: a synthesized CDP touch fling scrolls on macOS Chromium but NOT on
 * the Linux CI runner (run 36261305864), so it cannot be the gate. Segments run in order; `pause` holds still.
 * Returns once the motion has STARTED; `window.__momentumDone` resolves when it ends.
 */
type Segment = { px: number; ms: number } | { pause: number };
async function momentum(page: Page, segments: Segment[]): Promise<void> {
  await page.evaluate((segs: Segment[]) => {
    const w = window as unknown as { __momentumDone?: Promise<void> };
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
    w.__momentumDone = (async () => {
      for (const seg of segs) {
        if ('pause' in seg) { await new Promise((r) => setTimeout(r, seg.pause)); continue; }
        const start = await frame();
        let moved = 0;
        for (let now = start; now - start < seg.ms; now = await frame()) {
          // Ease-out: a fling decelerates, as real momentum does.
          const t = Math.min(1, (now - start) / seg.ms);
          const target = Math.round(seg.px * (1 - (1 - t) * (1 - t)));
          window.scrollBy(0, target - moved);
          moved = target;
        }
      }
    })();
  }, segments);
}
const momentumDone = (page: Page) => page.evaluate(() => (window as unknown as { __momentumDone?: Promise<void> }).__momentumDone);

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
  test('CASUALTY: Stop tapped while momentum is still carrying the page → once at rest, the saved confirmation is on screen', async ({ page }) => {
    test.setTimeout(90_000);
    await recordUntilSavable(page);
    // The page is still moving down when Stop is tapped, keeps moving after the reveal, pauses (>150 ms), then resumes —
    // a decelerating fling that ends inside the guard's accepted 3 s bound (motion lasting beyond it is out of contract).
    await momentum(page, [{ px: 900, ms: 1200 }, { pause: 300 }, { px: 250, ms: 300 }]);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000, message: 'precondition: the page is moving' }).toBeGreaterThan(0);
    await tapStopAndSave(page);
    await momentumDone(page);
    await waitForRest(page);
    expect(await confirmationOnScreen(page), 'the saved confirmation is on screen after the momentum ends').toBe(true);
    expect(await page.evaluate(() => window.scrollY), 'the page is back at its top').toBe(0);
  });

  test('CONTROL: Stop tapped after the page came to rest → the saved confirmation is on screen', async ({ page }) => {
    test.setTimeout(90_000);
    await recordUntilSavable(page);
    await momentum(page, [{ px: 600, ms: 500 }]);
    await momentumDone(page);
    await waitForRest(page, 300, 10_000);
    expect(await page.evaluate(() => window.scrollY), 'precondition: scrolled down').toBeGreaterThan(0);
    await tapStopAndSave(page);
    await waitForRest(page);
    expect(await confirmationOnScreen(page)).toBe(true);
  });

  test('CONTROL: a person who scrolls down on purpose right after the save is not pulled back up', async ({ page }) => {
    test.setTimeout(90_000);
    await recordUntilSavable(page);
    await momentum(page, [{ px: 600, ms: 500 }]);
    await momentumDone(page);
    await waitForRest(page, 300, 10_000);
    await tapStopAndSave(page);
    await waitForRest(page);
    expect(await confirmationOnScreen(page), 'precondition: revealed').toBe(true);
    // The person touches the screen and scrolls down to read — deliberate input, inside any re-check window.
    await page.touchscreen.tap(187, 400);
    await momentum(page, [{ px: 400, ms: 300 }]);
    await momentumDone(page);
    await waitForRest(page);
    expect(await page.evaluate(() => window.scrollY), 'the page stays where the person scrolled it').toBeGreaterThan(0);
  });

  test('CASUALTY (Codex P2 r4112400154): a finger that went down BEFORE the review settled keeps control — its scroll is never snapped back', async ({ page }) => {
    test.setTimeout(90_000);
    await recordUntilSavable(page);
    await momentum(page, [{ px: 600, ms: 500 }]);
    await momentumDone(page);
    await waitForRest(page, 300, 10_000);
    const cdp = await page.context().newCDPSession(page);
    // The person's finger lands before Stop is handled and stays down (real DOM touch events; no OS scrolling needed).
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 187, y: 500 }] });
    await tapStopAndSave(page);
    await waitForRest(page);
    expect(await confirmationOnScreen(page), 'precondition: revealed').toBe(true);
    // The same finger drags down to read: only MOVE events arrive after the guard armed, with the page following it.
    for (const y of [480, 440, 380, 300]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 187, y }] });
    await momentum(page, [{ px: 350, ms: 300 }]);
    await momentumDone(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitForRest(page);
    expect(await page.evaluate(() => window.scrollY), 'the page stays where the finger took it').toBeGreaterThan(0);
  });
});
