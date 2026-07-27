import { test, expect, type Page, type Locator } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * #1042 PR4: VISUAL proof for the new above-the-fold Practice Home continuity block (returning state).
 * Authenticates via the E2E mock path with a RETURNING session history (the default) and captures the
 * "Ready for your next practice?" summary — date + duration only (never WPM) — plus its two actions
 * ("Review last session" → /analytics/:id, "View analytics" → /analytics).
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
  // Returning state (a session exists): the continuity summary is present with date + duration, no WPM.
  const summary = page.getByTestId('practice-continuity-summary');
  await expect(summary).toBeVisible({ timeout: 30000 });
  await expect(summary).toContainText(/Last practice/i);
  await expect(summary).not.toContainText(/WPM/i);
  // Both actions exist above the fold; the two-product chooser still renders below.
  await expect(page.getByTestId('practice-continuity-review')).toBeVisible();
  await expect(page.getByTestId('practice-continuity-analytics')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Freestyle Practice$/i })).toBeVisible();
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
    const block = page.getByTestId('practice-continuity');
    // Centre the section in the safe area — clear of BOTH the fixed top header and the fixed bottom nav —
    // so neither overlays the card (scrolling to 'start' would tuck the heading under the top header).
    await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const heading = page.getByRole('heading', { name: /ready for your next practice/i });
    const review = page.getByTestId('practice-continuity-review');
    const analytics = page.getByTestId('practice-continuity-analytics');
    // The complete block is visible: heading + both actions.
    await expect(heading).toBeVisible();
    await expect(review).toBeVisible();
    await expect(analytics).toBeVisible();
    // Nothing in the block is obscured by a fixed bar — the heading clears the top header, and both actions
    // clear the bottom nav (toBeVisible alone does NOT detect occlusion, so hit-test each).
    expect(await isUnobscured(heading), 'Heading must clear the fixed top header').toBe(true);
    expect(await isUnobscured(review), 'Review action must not intersect the fixed bottom nav').toBe(true);
    expect(await isUnobscured(analytics), 'View analytics action must not intersect the fixed bottom nav').toBe(true);
    await settle(page);
    await block.screenshot({ path: `${DIR}/02-continuity-returning-mobile.png` });

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(trackingRequests, `unexpected tracking requests: ${trackingRequests.join(' | ')}`).toEqual([]);
  });
});
