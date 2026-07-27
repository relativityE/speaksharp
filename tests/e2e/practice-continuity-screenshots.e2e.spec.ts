import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * #1042 PR4: VISUAL proof for the new above-the-fold Practice Home continuity block (returning state).
 * Authenticates via the E2E mock path with a RETURNING session history (the default) and captures the
 * "Ready for your next practice?" summary — date + duration only (never WPM) — plus its two actions
 * ("Review last session" → /analytics/:id, "View analytics" → /analytics).
 *
 * One desktop + one mobile screenshot → test-results/practice-continuity/ (uploaded as
 * ux-review-screenshots-*, 1-day retention). Screenshots are NOT committed.
 *
 * CDP: asserts zero console/page errors and no third-party tracking requests on the landing.
 */

const DIR = 'test-results/practice-continuity';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TRACKING_HOSTS = ['posthog.com', 'i.posthog.com', 'sentry.io', 'google-analytics.com', 'googletagmanager.com', 'doubleclick.net'];

// Settle the page-transition (framer-motion) opacity to 1 before capturing, else the shot lands mid-fade.
async function shot(page: Page, path: string) {
  await page.waitForFunction(() => {
    let el = document.querySelector('[data-testid="practice-root"]') as HTMLElement | null;
    while (el) { if (parseFloat(getComputedStyle(el).opacity || '1') < 0.99) return false; el = el.parentElement; }
    return true;
  }, { timeout: 5000 }).catch(() => { /* best-effort: capture anyway */ });
  await page.screenshot({ path, fullPage: true });
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

    await page.setViewportSize(DESKTOP);
    await enterReturningPractice(page);
    await shot(page, `${DIR}/01-continuity-returning-desktop.png`);

    await page.setViewportSize(MOBILE);
    await enterReturningPractice(page);
    await shot(page, `${DIR}/02-continuity-returning-mobile.png`);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(trackingRequests, `unexpected tracking requests: ${trackingRequests.join(' | ')}`).toEqual([]);
  });
});
