import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, goToApp } from './helpers';

/**
 * Pre-merge VISUAL + CDP + NAVIGATION proof for #1019 (authenticated /practice entry). No production
 * deployment: authenticates via the E2E mock/synthetic path, forces the rollout flag ON through the E2E
 * manifest override (window.__SS_E2E__.flags.practiceEntry), and drives the REAL user journey.
 *
 * Crucially, this exercises the actual "Back to practice choices" controls with normal clicks (no force,
 * no direct-navigation bypass): a tester must be able to enter Quick Practice, click Back to return to the
 * chooser, and then open Guided Rehearsal — all on /practice with no page reload. A prior version of this
 * spec hid a real actionability defect (the top Back button sat under the fixed global <nav>, which
 * intercepted the click) by re-navigating instead of clicking; that product defect is now fixed (the
 * heroes clear the nav) and proven here through the control itself.
 *
 * CDP: asserts zero console/page errors and no third-party tracking requests on /practice. Screenshots go
 * to test-results/practice-entry/ (uploaded as ux-review-screenshots-*).
 */

const DIR = 'test-results/practice-entry';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TRACKING_HOSTS = ['posthog.com', 'i.posthog.com', 'sentry.io', 'google-analytics.com', 'googletagmanager.com', 'doubleclick.net'];

// MUST be registered AFTER programmaticLoginWithRoutes: that helper's E2E-manifest addInitScript rebuilds
// window.__SS_E2E__ on every page load, so a flag set by an EARLIER-registered script would be wiped. Init
// scripts run in registration order on each full navigation (navigateToRoute → page.goto), so registering
// this last makes it win. (This ordering bug is exactly what made a prior run fail 10/10.)
async function forcePracticeFlag(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __SS_E2E__?: { flags?: Record<string, unknown> } };
    w.__SS_E2E__ = w.__SS_E2E__ ?? {};
    w.__SS_E2E__.flags = { ...(w.__SS_E2E__.flags ?? {}), practiceEntry: true };
  });
}

// INITIAL page entry only (never used as a substitute for clicking Back mid-journey).
async function enterPractice(page: Page) {
  await navigateToRoute(page, '/practice');
  await expectOnChooser(page);
}

async function expectOnChooser(page: Page) {
  await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: /private practice\. public impact/i })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/practice');
}

async function openQuickOverview(page: Page) {
  await page.getByTestId('practice-card-quick').click();
  await expect(page.getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeVisible();
}

// Click a Back control the way a tester does — normal click, no force. Playwright's actionability check
// (visible, stable, ENABLED, receives pointer events / not obscured) must pass, proving the fixed nav no
// longer intercepts it. Then verify we are back on the chooser at /practice, with no /session navigation.
async function clickBackToChooser(page: Page, testid: string) {
  const back = page.getByTestId(testid);
  await back.scrollIntoViewIfNeeded();
  await expect(back).toBeVisible();
  await expect(back).toBeEnabled();
  await back.click();
  await expectOnChooser(page);
  await expect(page.getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toHaveCount(0);
}

// Expected surface-specific issue-area option values (mirrors services/pageContext).
const AREAS = {
  practice_home: ['understanding_choices', 'navigation', 'visual_layout', 'other'],
  quick_practice_overview: ['walkthrough', 'start_speaking', 'navigation', 'visual_layout', 'other'],
  guided_rehearsal_preview: ['walkthrough', 'correction_loop', 'feature_clarity', 'visual_layout', 'other'],
  session: ['session_mode', 'mic_start', 'recording', 'transcription', 'feedback', 'save', 'other'],
};

// Open the GLOBAL Report Issue dialog, assert the visible page label + surface-specific issue areas, then
// close it WITHOUT submitting (Escape) — normal interactions only.
async function assertReport(page: Page, expectedLabel: string | RegExp, expectedAreas: readonly string[]) {
  await page.getByTestId('nav-report-issue-button').click();
  await expect(page.getByTestId('issue-report-title')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('issue-report-page-context')).toContainText(expectedLabel);
  const areas = await page.getByTestId('issue-report-area').locator('option')
    .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
  expect(areas).toEqual([...expectedAreas]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('issue-report-title')).toHaveCount(0);
}

test.describe('Practice entry — real Back navigation, visual + CDP evidence', () => {
  test('Quick → Back → chooser → Guided in one uninterrupted journey (both Back controls), clean page', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const trackingRequests: string[] = [];
    const sessionNavs: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) => {
      try {
        const u = new URL(req.url());
        if (TRACKING_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) trackingRequests.push(req.url());
        if (req.isNavigationRequest() && u.pathname.startsWith('/session')) sessionNavs.push(req.url());
      } catch { /* ignore non-URL requests */ }
    });

    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await forcePracticeFlag(page); // AFTER login: must win over the manifest's init script (see note above)

    // === DESKTOP ===
    await page.setViewportSize(DESKTOP);
    await enterPractice(page);
    await page.screenshot({ path: `${DIR}/01-chooser-desktop.png`, fullPage: true });
    expect(await page.getByRole('main').count()).toBe(1); // App owns the sole landmark
    // Report Issue on the chooser → practice_home.
    await assertReport(page, 'SpeakSharp Practice', AREAS.practice_home);

    // 1) TOP Back journey: Quick → top Back → chooser → Guided (no reload, stays on /practice).
    await openQuickOverview(page);
    await page.screenshot({ path: `${DIR}/02-quick-overview-desktop.png`, fullPage: true });
    // Report Issue on the Quick overview → quick_practice_overview (distinct label + areas).
    await assertReport(page, 'Quick Practice overview', AREAS.quick_practice_overview);
    await clickBackToChooser(page, 'practice-back-top');
    await page.getByTestId('practice-card-guided').click();
    await expect(page.getByText(/preview · coming soon/i)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/practice');
    // Report Issue on the Guided preview → guided_rehearsal_preview (distinct label + areas).
    await assertReport(page, 'Guided Rehearsal preview', AREAS.guided_rehearsal_preview);
    await page.screenshot({ path: `${DIR}/03-guided-expanded-desktop.png`, fullPage: true });

    // 2) BOTTOM Back journey: re-enter overview, scroll the bottom Back into view, click it, return.
    await openQuickOverview(page);
    await clickBackToChooser(page, 'practice-back-bottom');

    // 3) Keyboard focus on the Quick CTA.
    const quickCta = page.getByTestId('practice-card-quick');
    await quickCta.focus();
    await expect(quickCta).toBeFocused();
    await page.screenshot({ path: `${DIR}/04-keyboard-focus-desktop.png` });

    // === MOBILE === (same top-Back journey on a phone viewport).
    await page.setViewportSize(MOBILE);
    await enterPractice(page);
    await page.screenshot({ path: `${DIR}/05-chooser-mobile.png`, fullPage: true });
    await openQuickOverview(page);
    await clickBackToChooser(page, 'practice-back-top');

    // === MAGIC-LINK CONTINUATION === the /auth/continue return target must defer to the SAME authenticated
    // decision as password sign-in: with an authenticated session + flag ON, it lands on the /practice
    // chooser (not /session). Proven at browser level with the recovered (mock) session.
    await page.setViewportSize(DESKTOP);
    await goToApp(page, '/auth/continue'); // helper preserves MSW init; PostAuthContinue redirects to /practice
    await expectOnChooser(page); // targeted → /practice chooser, via /auth/continue → PostAuthRedirect

    // Up to here NOTHING should have navigated to /session — Back/Guided/continuation all stay on /practice.
    expect(sessionNavs, `unexpected /session navigations before Start speaking: ${sessionNavs.join(' | ')}`).toEqual([]);

    // === START SPEAKING → /session === the INTENTIONAL handoff. Its Report Issue must use the existing,
    // unchanged Session · Speaking context (surface reset on leaving /practice).
    await openQuickOverview(page);
    await page.getByTestId('practice-quick-start').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    await assertReport(page, 'Session · Speaking', AREAS.session);

    // CDP assertions: clean, self-contained page throughout.
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(trackingRequests, `unexpected tracking requests: ${trackingRequests.join(' | ')}`).toEqual([]);
  });
});
