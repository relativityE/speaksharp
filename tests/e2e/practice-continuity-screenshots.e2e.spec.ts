import { test, expect, type Page, type Locator } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * #1042 PR4 → #1061 → #1047: VISUAL proof for the above-the-fold continuity cluster on authenticated Home.
 * #1047 replaced the standalone continuity card with a greeting ROW: a streak chip, a "Last session"
 * button carrying the TRUTHFUL summary (date + duration only, never WPM) and an "Analytics" button. The
 * "Ready for your next practice?" heading is gone and the page header is now the question "What would you
 * like to do?". Authenticates via the E2E mock path with a RETURNING session history (the default).
 *
 * DESKTOP: full-page shot (no fixed bottom nav to obscure content).
 * MOBILE: a SECTION-scoped shot of the continuity block, taken only after asserting both actions clear the
 * fixed bottom navigation — a full-page mobile shot would let the fixed nav bisect the card.
 *
 * Screenshots → test-results/practice-continuity/ (uploaded as ux-review-screenshots-*, 1-day retention);
 * NOT committed. CDP: asserts zero console/page errors and no third-party tracking requests on the landing.
 */

const DIR = 'test-results/practice-continuity';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 720 };
const TRACKING_HOSTS = ['posthog.com', 'i.posthog.com', 'sentry.io', 'google-analytics.com', 'googletagmanager.com', 'doubleclick.net'];

// Fail CLOSED: the page-transition (framer-motion) opacity MUST settle to 1 before we capture. A settle
// timeout throws and fails the test — we never capture a mid-fade / washed-out frame "anyway".
async function settle(page: Page) {
  await page.waitForFunction(() => {
    let el = document.querySelector('[data-testid="practice-root"]') as HTMLElement | null;
    while (el) { if (parseFloat(getComputedStyle(el).opacity || '1') < 0.99) return false; el = el.parentElement; }
    return true;
  }, { timeout: 10000 });
}

async function enterReturningPractice(page: Page) {
  await navigateToRoute(page, '/practice');
  await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
  // Returning state (a session exists): H-4 promotes the former corner chip into the full-width resume
  // band (slot B). Its meta line carries date + duration, no WPM, and is NOT the em-dash placeholder a
  // missing/failed read would produce.
  const band = page.getByTestId('home-resume-band');
  await expect(band).toBeVisible({ timeout: 30000 });
  const summary = page.getByTestId('home-resume-meta');
  await expect(summary).toBeVisible();
  await expect(summary).not.toContainText(/WPM/i);
  await expect(summary).not.toHaveText('—');
  // A returning user has an active 3-day streak (>=2), so the chip renders and leads the cluster.
  const streakChip = page.getByTestId('home-streak-chip');
  await expect(streakChip).toBeVisible();
  await expect(streakChip).toHaveText(/3-day streak/);
  // The band owns the review action, so the legacy chip is gone — one action per destination. Analytics
  // stays in the cluster, and the two-product chooser still renders below.
  await expect(page.getByTestId('home-resume-cta')).toBeVisible();
  await expect(page.getByTestId('home-last-session')).toHaveCount(0);
  await expect(page.getByTestId('home-analytics')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Open Mic$/i })).toBeVisible();
}

// True only if the point at the element's centre hit-tests to the element itself (not an overlaying fixed
// nav) — i.e. the control is genuinely reachable, not obscured.
async function isUnobscured(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === node || node.contains(hit));
  });
}

test.describe('#1042 PR4 — Practice Home continuity (returning state)', () => {
  test('returning summary renders date + duration only, with both actions (desktop + mobile)', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const trackingRequests: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) => {
      try {
        const u = new URL(req.url());
        if (TRACKING_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) trackingRequests.push(req.url());
      } catch { /* ignore non-URL requests */ }
    });

    // Default login carries a returning session history (emptySessions defaults to false).
    await programmaticLoginWithRoutes(page, { userType: 'free' });

    // === DESKTOP === no fixed bottom nav; a full-page shot shows the block above the chooser.
    await page.setViewportSize(DESKTOP);
    await enterReturningPractice(page);
    await settle(page);
    await page.screenshot({ path: `${DIR}/01-continuity-returning-desktop.png`, fullPage: true });

    // === MOBILE === prove the complete block + both actions clear the FIXED bottom nav, then capture the
    // continuity SECTION (not full-page, which would let the fixed nav bisect the card).
    await page.setViewportSize(MOBILE);
    await enterReturningPractice(page);
    // Scroll/capture the CONTINUITY CLUSTER, not the whole authenticated surface. The surface is over
    // a viewport tall (greeting row + both product cards), so centring IT puts its top far above the
    // fold and tucks the summary under the fixed header — which is exactly what failed CI. The cluster
    // is a small element, so centring it clears both fixed bars, and `.ss-home-anchor` gives it
    // scroll-margin derived from --header-height for the non-centred cases.
    // H-4: continuity is now TWO surfaces — the resume band (the run's date/duration and the action that
    // reopens it) and the cluster (Analytics). Each is centred and hit-tested on its own, because a fixed
    // header or bottom nav can obscure either, and toBeVisible alone does NOT detect occlusion.
    const band = page.getByTestId('home-resume-band');
    await band.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const summary = page.getByTestId('home-resume-meta');
    const review = page.getByTestId('home-resume-cta');
    await expect(summary).toBeVisible();
    await expect(review).toBeVisible();
    expect(await isUnobscured(summary), 'The run summary must clear the fixed top header').toBe(true);
    expect(await isUnobscured(review), 'The resume action must not intersect the fixed bottom nav').toBe(true);
    // One action per destination: the legacy chip must not reappear beside the band.
    await expect(page.getByTestId('home-last-session')).toHaveCount(0);

    const block = page.getByTestId('home-continuity-cluster');
    await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const analytics = page.getByTestId('home-analytics');
    await expect(analytics).toBeVisible();
    expect(await isUnobscured(analytics), 'Analytics action must not intersect the fixed bottom nav').toBe(true);
    await settle(page);
    await band.screenshot({ path: `${DIR}/02-continuity-returning-mobile.png` });

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(trackingRequests, `unexpected tracking requests: ${trackingRequests.join(' | ')}`).toEqual([]);
  });

  /*
   * Brief H-3 deleted the outcome tiles, so the old proof (three ~75px tile labels per card at 320px)
   * has no subject. What still needs measuring at the narrowest supported width is the text that
   * replaced them: each card's ONE sentence and the resume band's quoted fix, neither of which may be
   * horizontally clipped, and the page must not scroll sideways. jsdom cannot measure this.
   */
  test('narrowest supported viewport: card and band text is never clipped and the page never scrolls sideways', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await page.setViewportSize(NARROW);
    await enterReturningPractice(page);
    await settle(page);

    // The card sentences, plus the resume band's headline and meta when a session is there to resume.
    const measured = page.locator([
      '[data-testid="practice-card-freeform-sentence"]',
      '[data-testid="practice-card-objective-sentence"]',
      '[data-testid="home-resume-headline"]',
      '[data-testid="home-resume-meta"]',
    ].join(', '));
    // At least the two card sentences always render; the band's two lines render for a returning user.
    const count = await measured.count();
    expect(count, 'both card sentences must render at 320px').toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i += 1) {
      const clipped = await measured.nth(i).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      const text = await measured.nth(i).innerText();
      expect(clipped, `"${text}" is clipped at ${NARROW.width}px`).toBe(false);
    }

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflows, 'the page must not scroll horizontally at 320px').toBe(false);

    // The nav bar must not overflow either (the account avatar replaced the full email for this reason).
    const navOverflows = await page.evaluate(() => {
      const header = document.querySelector('header');
      return header ? header.scrollWidth > header.clientWidth + 1 : false;
    });
    expect(navOverflows, 'the fixed header must not overflow at 320px').toBe(false);

    await page.screenshot({ path: `${DIR}/03-home-narrow-320.png`, fullPage: true });
  });
});
