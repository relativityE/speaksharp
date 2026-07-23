import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * Pre-merge VISUAL + CDP + NAVIGATION proof for the authenticated `/practice` landing (flag-free release).
 * No production deployment: authenticates via the E2E mock/synthetic path and drives the REAL user journey.
 *
 * Proves, with real clicks (no force, no direct-navigation substitute for a control):
 *  - /practice renders as the authenticated default landing;
 *  - Quick Practice → overview → "Open Practice Session" → the unchanged /session (no auto-record);
 *  - Guided Rehearsal → exactly one toast "Product not available at this time"; stays on /practice; no
 *    preview / walkthrough / correction loop;
 *  - Report Issue is globally available and surface-aware on the landing, Quick overview, Guided-unavailable
 *    selection, and /session;
 *  - the Back controls (top + bottom) work through normal clicks below the fixed nav.
 *
 * CDP: asserts zero console/page errors and no third-party tracking requests. Screenshots → test-results/
 * practice-entry/ (uploaded as ux-review-screenshots-*).
 */

const DIR = 'test-results/practice-entry';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TRACKING_HOSTS = ['posthog.com', 'i.posthog.com', 'sentry.io', 'google-analytics.com', 'googletagmanager.com', 'doubleclick.net'];
const GUIDED_TOAST = 'Product not available at this time';

// Surface-specific issue-area option values (mirrors services/pageContext).
const AREAS = {
  practice_home: ['understanding_choices', 'navigation', 'visual_layout', 'other'],
  quick_practice_overview: ['walkthrough', 'open_practice_session', 'navigation', 'visual_layout', 'other'],
  guided_rehearsal_unavailable: ['availability', 'product_clarity', 'navigation', 'visual_layout', 'other'],
  session: ['session_mode', 'mic_start', 'recording', 'transcription', 'feedback', 'save', 'other'],
};

async function enterPractice(page: Page) {
  await navigateToRoute(page, '/practice'); // /practice is the plain authenticated landing (no gate)
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
// proves the fixed nav does not intercept it. Then verify we are back on the chooser at /practice.
async function clickBackToChooser(page: Page, testid: string) {
  const back = page.getByTestId(testid);
  await back.scrollIntoViewIfNeeded();
  await expect(back).toBeVisible();
  await expect(back).toBeEnabled();
  await back.click();
  await expectOnChooser(page);
  await expect(page.getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toHaveCount(0);
}

// Open the GLOBAL Report Issue dialog, assert the visible page label + surface issue areas, then close it
// WITHOUT submitting (Escape).
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

test.describe('Practice landing — default entry, Guided unavailable, surface-aware Report Issue', () => {
  test('Quick → Open Practice Session → /session; Guided → exact toast; Report Issue on every surface', async ({ page }) => {
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

    // === DESKTOP LANDING ===
    await page.setViewportSize(DESKTOP);
    await enterPractice(page);
    await page.screenshot({ path: `${DIR}/01-chooser-desktop.png`, fullPage: true });
    expect(await page.getByRole('main').count()).toBe(1); // App owns the sole landmark
    // Both products render; Guided is clearly marked unavailable (text, not color alone).
    await expect(page.getByRole('heading', { name: /^Quick Practice$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeVisible();
    await expect(page.getByTestId('practice-card-guided')).toHaveText(/guided rehearsal/i);
    await assertReport(page, 'SpeakSharp Practice', AREAS.practice_home);

    // === QUICK OVERVIEW ===
    await openQuickOverview(page);
    await page.screenshot({ path: `${DIR}/02-quick-overview-desktop.png`, fullPage: true });
    // Final CTA reads exactly "Open Practice Session" (never "Start speaking").
    await expect(page.getByRole('button', { name: /open practice session/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /start speaking/i })).toHaveCount(0);
    await assertReport(page, 'Quick Practice overview', AREAS.quick_practice_overview);
    await page.screenshot({ path: `${DIR}/03-quick-walkthrough-desktop.png`, fullPage: true });

    // Back to chooser. BEFORE: the Guided card is at normal emphasis, CTA "Guided Rehearsal", enabled.
    await clickBackToChooser(page, 'practice-back-top');
    const guidedCta = page.getByTestId('practice-card-guided');
    await expect(guidedCta).toHaveText(/guided rehearsal/i);
    await expect(guidedCta).toBeEnabled();
    await page.screenshot({ path: `${DIR}/04a-guided-before-desktop.png`, fullPage: true });

    await guidedCta.click();
    // Exactly the approved toast; stays on /practice; no preview/walkthrough/correction loop.
    await expect(page.getByText(GUIDED_TOAST)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/practice');
    await expect(page.getByText(/preview · coming soon/i)).toHaveCount(0);
    await expect(page.getByText(/the correction loop/i)).toHaveCount(0);
    // AFTER: the Guided card ALONE is disabled — CTA "Unavailable", natively disabled; Quick stays enabled.
    await expect(guidedCta).toHaveText(/unavailable/i);
    await expect(guidedCta).toBeDisabled();
    await expect(guidedCta).toHaveAccessibleName(/guided rehearsal — unavailable/i);
    await expect(page.getByTestId('practice-card-quick')).toBeEnabled();
    await page.screenshot({ path: `${DIR}/04b-guided-after-disabled-desktop.png`, fullPage: true });
    // Visible Report Issue label is EXACTLY "Guided Rehearsal" (never "(unavailable)").
    await page.getByTestId('nav-report-issue-button').click();
    await expect(page.getByTestId('issue-report-title')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('issue-report-page-context')).toContainText('Guided Rehearsal');
    await expect(page.getByTestId('issue-report-page-context')).not.toContainText(/unavailable/i);
    const guidedAreas = await page.getByTestId('issue-report-area').locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(guidedAreas).toEqual(AREAS.guided_rehearsal_unavailable);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-report-title')).toHaveCount(0);

    // Bottom Back journey.
    await openQuickOverview(page);
    await clickBackToChooser(page, 'practice-back-bottom');

    // Keyboard focus on the Quick CTA.
    const quickCta = page.getByTestId('practice-card-quick');
    await quickCta.focus();
    await expect(quickCta).toBeFocused();
    await page.screenshot({ path: `${DIR}/05-keyboard-focus-desktop.png` });

    // === MOBILE === (fresh page instance → Guided starts enabled again; capture before/after at MOBILE).
    await page.setViewportSize(MOBILE);
    await enterPractice(page);
    await page.screenshot({ path: `${DIR}/06-chooser-mobile.png`, fullPage: true });
    const guidedMobile = page.getByTestId('practice-card-guided');
    await expect(guidedMobile).toBeEnabled();
    await page.screenshot({ path: `${DIR}/07a-guided-before-mobile.png`, fullPage: true });
    await guidedMobile.click();
    await expect(page.getByText(GUIDED_TOAST)).toBeVisible();
    await expect(guidedMobile).toHaveText(/unavailable/i);
    await expect(guidedMobile).toBeDisabled();
    await expect(page.getByTestId('practice-card-quick')).toBeEnabled();
    await page.screenshot({ path: `${DIR}/07b-guided-after-disabled-mobile.png`, fullPage: true });
    await openQuickOverview(page);
    await clickBackToChooser(page, 'practice-back-top');

    // Up to here NOTHING navigated to /session (Quick opens an overview, Guided shows a toast).
    expect(sessionNavs, `unexpected /session navigations before Open Practice Session: ${sessionNavs.join(' | ')}`).toEqual([]);

    // === OPEN PRACTICE SESSION → /session === the INTENTIONAL handoff (no auto-record).
    await page.setViewportSize(DESKTOP);
    await enterPractice(page);
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
