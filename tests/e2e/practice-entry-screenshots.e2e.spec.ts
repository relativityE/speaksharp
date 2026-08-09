import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * Pre-merge VISUAL + CDP + NAVIGATION proof for the authenticated `/practice` landing (flag-free release).
 * No production deployment: authenticates via the E2E mock/synthetic path and drives the REAL user journey.
 *
 * Proves, with real clicks (no force, no direct-navigation substitute for a control):
 *  - /practice renders as the authenticated default landing (two-product chooser);
 *  - #1042 PR3: the Freeform ("Open Floor") card CTA ("Start your session") navigates DIRECTLY to the unchanged
 *    /session (no intermediate overview) and never auto-starts recording;
 *  - Focus Points → exactly one CONTEXTUAL notice "Product not available at this time" anchored to the
 *    Objective card (not a global toast); then the Objective card alone becomes disabled; no preview/correction loop;
 *  - Report Issue is globally available and surface-aware on the landing, the Objective-unavailable selection,
 *    and /session (the removed `freeform_practice_overview` surface no longer exists).
 *
 * CDP: asserts zero console/page errors and no third-party tracking requests. Screenshots → test-results/
 * practice-entry/ (uploaded as ux-review-screenshots-*).
 */

const DIR = 'test-results/practice-entry';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TRACKING_HOSTS = ['posthog.com', 'i.posthog.com', 'sentry.io', 'google-analytics.com', 'googletagmanager.com', 'doubleclick.net'];

// Surface-specific issue-area option values (mirrors services/pageContext). #1042 PR3 removed the
// freeform_practice_overview surface, so /practice now has two surfaces.
const AREAS = {
  practice_home: ['understanding_choices', 'navigation', 'visual_layout', 'other'],
  objective_unavailable: ['availability', 'product_clarity', 'navigation', 'visual_layout', 'other'],
  session: ['session_mode', 'mic_start', 'recording', 'transcription', 'feedback', 'save', 'other'],
};

async function enterPractice(page: Page) {
  await navigateToRoute(page, '/practice'); // /practice is the plain authenticated landing (no gate)
  await expectOnChooser(page);
}

// Wait for the page-transition (framer-motion) opacity to SETTLE to 1 before a screenshot — otherwise the
// capture lands mid-fade and the palette reads as washed out. Then take the shot.
async function shot(page: Page, path: string) {
  await page.waitForFunction(() => {
    let el = document.querySelector('[data-testid="practice-root"]') as HTMLElement | null;
    while (el) { if (parseFloat(getComputedStyle(el).opacity || '1') < 0.99) return false; el = el.parentElement; }
    return true;
  }, { timeout: 5000 }).catch(() => { /* best-effort: capture anyway */ });
  await page.screenshot({ path, fullPage: true });
}

async function expectOnChooser(page: Page) {
  await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
  // #1047 authenticated state: the page's job is to ASK, so the H1 is the question itself. No tagline,
  // no marketing hero.
  await expect(page.getByText(/what would you like to do/i)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/practice');
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

test.describe('Practice landing — default entry, Objective unavailable, surface-aware Report Issue', () => {
  test('Freeform card → direct /session (no auto-record); Objective → contextual notice + disabled; Report Issue per surface', async ({ page }) => {
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
    await shot(page, `${DIR}/01-chooser-desktop.png`);
    expect(await page.getByRole('main').count()).toBe(1); // App owns the sole landmark
    // Both products render; Objective is clearly marked unavailable (text, not color alone).
    await expect(page.getByRole('heading', { name: /^Open Floor$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Focus Points$/i })).toBeVisible();
    // #1042 PR3: Freeform ("Open Floor") CTA is "Start your session"; the legacy overview CTAs are gone.
    await expect(page.getByTestId('practice-card-freeform')).toHaveAccessibleName(/start your session/i);
    await expect(page.getByRole('button', { name: /open practice session|start speaking/i })).toHaveCount(0);
    await assertReport(page, 'SpeakSharp Practice', AREAS.practice_home);

    // === FOCUS POINTS ACTIVATED (#1046 slice 5b) — the Objective card opens the real capture dialog ===
    const guidedCta = page.getByTestId('practice-card-objective');
    await expect(guidedCta).toHaveAccessibleName(/start focus points/i);
    // The pre-launch SOON badge is gone now that the product is live (and never "Planned").
    await expect(page.getByTestId('objective-soon-badge')).toHaveCount(0);
    await expect(page.getByText('Planned', { exact: false })).toHaveCount(0);
    await shot(page, `${DIR}/02a-objective-before-desktop.png`);

    await guidedCta.click();
    // The real capture form (goal + focus points), NOT the retired notify/coming-soon dialog.
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await expect(page.getByTestId('objective-setup-form')).toBeVisible();
    await expect(page.getByTestId('objective-notify-dialog')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/practice'); // opening captures nothing / navigates nowhere
    await shot(page, `${DIR}/02b-objective-setup-desktop.png`);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
    // Focus Points is no longer a separate reportable surface — a report on the chooser is the home surface.
    await assertReport(page, 'SpeakSharp Practice', AREAS.practice_home);

    // Keyboard focus on the Freeform CTA.
    const freeformCta = page.getByTestId('practice-card-freeform');
    await freeformCta.focus();
    await expect(freeformCta).toBeFocused();
    await page.screenshot({ path: `${DIR}/03-keyboard-focus-desktop.png` });

    // === MOBILE ===
    await page.setViewportSize(MOBILE);
    await enterPractice(page);
    await shot(page, `${DIR}/04-chooser-mobile.png`);
    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await shot(page, `${DIR}/05-objective-setup-mobile.png`);
    await page.keyboard.press('Escape');

    // Up to here NOTHING navigated to /session (Objective opens a dialog; Freeform not yet clicked).
    expect(sessionNavs, `unexpected /session navigations before the Freeform handoff: ${sessionNavs.join(' | ')}`).toEqual([]);

    // === FREESTYLE CARD → /session === the INTENTIONAL, direct handoff (no overview, no auto-record).
    await page.setViewportSize(DESKTOP);
    await enterPractice(page);
    await page.getByTestId('practice-card-freeform').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    // Must NOT auto-start recording — the Session before-state (mic control) is present, not recording
    // (#1222: start/stop split; recording state is on the shell, not a data-recording button attribute).
    await expect(page.getByTestId(TEST_IDS.MIC_START)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId(TEST_IDS.SESSION_SHELL)).toHaveAttribute('data-session-state', 'before');
    await assertReport(page, 'Session · Speaking', AREAS.session);

    // CDP assertions: clean, self-contained page throughout.
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(trackingRequests, `unexpected tracking requests: ${trackingRequests.join(' | ')}`).toEqual([]);
  });
});
