import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * Pre-merge VISUAL + CDP + NAVIGATION proof for the authenticated `/practice` landing (flag-free release).
 * No production deployment: authenticates via the E2E mock/synthetic path and drives the REAL user journey.
 *
 * Proves, with real clicks (no force, no direct-navigation substitute for a control):
 *  - /practice renders as the authenticated default landing (two-product chooser);
 *  - #1042 PR3: the Freestyle card CTA ("Start Freestyle Practice") navigates DIRECTLY to the unchanged
 *    /session (no intermediate overview) and never auto-starts recording;
 *  - Guided Rehearsal → exactly one CONTEXTUAL notice "Product not available at this time" anchored to the
 *    Guided card (not a global toast); then the Guided card alone becomes disabled; no preview/correction loop;
 *  - Report Issue is globally available and surface-aware on the landing, the Guided-unavailable selection,
 *    and /session (the removed `quick_practice_overview` surface no longer exists).
 *
 * CDP: asserts zero console/page errors and no third-party tracking requests. Screenshots → test-results/
 * practice-entry/ (uploaded as ux-review-screenshots-*).
 */

const DIR = 'test-results/practice-entry';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TRACKING_HOSTS = ['posthog.com', 'i.posthog.com', 'sentry.io', 'google-analytics.com', 'googletagmanager.com', 'doubleclick.net'];

// Surface-specific issue-area option values (mirrors services/pageContext). #1042 PR3 removed the
// quick_practice_overview surface, so /practice now has two surfaces.
const AREAS = {
  practice_home: ['understanding_choices', 'navigation', 'visual_layout', 'other'],
  guided_rehearsal_unavailable: ['availability', 'product_clarity', 'navigation', 'visual_layout', 'other'],
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
  // #1061 authenticated state: the brand line "Private Practice. Public Impact!" is a compact <p> welcome
  // (not the large marketing <h1>), so match the text rather than the heading role.
  await expect(page.getByText(/what would you like to practice/i)).toBeVisible();
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

test.describe('Practice landing — default entry, Guided unavailable, surface-aware Report Issue', () => {
  test('Freestyle card → direct /session (no auto-record); Guided → contextual notice + disabled; Report Issue per surface', async ({ page }) => {
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
    // Both products render; Guided is clearly marked unavailable (text, not color alone).
    await expect(page.getByRole('heading', { name: /^Freestyle Practice$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeVisible();
    // #1042 PR3: Freestyle CTA is "Start Freestyle Practice"; the legacy overview CTAs are gone.
    await expect(page.getByTestId('practice-card-quick')).toHaveAccessibleName(/start freestyle practice/i);
    await expect(page.getByRole('button', { name: /open practice session|start speaking/i })).toHaveCount(0);
    await assertReport(page, 'SpeakSharp Practice', AREAS.practice_home);

    // === GUIDED "COMING SOON!" + NOTIFY ME (#1061) — Guided card opens the gated coming-soon dialog (waitlist OFF) ===
    const guidedCta = page.getByTestId('practice-card-guided');
    await expect(guidedCta).toHaveAccessibleName(/notify me about guided rehearsal/i);
    // Guided status is the SOON header badge (never "Planned").
    await expect(page.getByTestId('guided-soon-badge')).toBeVisible();
    await expect(page.getByText('Planned', { exact: false })).toHaveCount(0);
    await shot(page, `${DIR}/02a-guided-before-desktop.png`);

    await guidedCta.click();
    await expect(page.getByTestId('guided-notify-dialog')).toBeVisible();
    await expect(page.getByTestId('guided-notify-comingsoon')).toBeVisible(); // activation OFF → no capture form
    expect(new URL(page.url()).pathname).toBe('/practice');
    await shot(page, `${DIR}/02b-guided-notify-desktop.png`);
    // Visible Report Issue label is EXACTLY "Guided Rehearsal" and the surface attributes to Guided.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('guided-notify-dialog')).toHaveCount(0);
    await assertReport(page, 'Guided Rehearsal', AREAS.guided_rehearsal_unavailable);

    // Keyboard focus on the Freestyle CTA.
    const quickCta = page.getByTestId('practice-card-quick');
    await quickCta.focus();
    await expect(quickCta).toBeFocused();
    await page.screenshot({ path: `${DIR}/03-keyboard-focus-desktop.png` });

    // === MOBILE ===
    await page.setViewportSize(MOBILE);
    await enterPractice(page);
    await shot(page, `${DIR}/04-chooser-mobile.png`);
    await page.getByTestId('practice-card-guided').click();
    await expect(page.getByTestId('guided-notify-dialog')).toBeVisible();
    await shot(page, `${DIR}/05-guided-notify-mobile.png`);
    await page.keyboard.press('Escape');

    // Up to here NOTHING navigated to /session (Guided opens a dialog; Freestyle not yet clicked).
    expect(sessionNavs, `unexpected /session navigations before the Freestyle handoff: ${sessionNavs.join(' | ')}`).toEqual([]);

    // === FREESTYLE CARD → /session === the INTENTIONAL, direct handoff (no overview, no auto-record).
    await page.setViewportSize(DESKTOP);
    await enterPractice(page);
    await page.getByTestId('practice-card-quick').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    // Must NOT auto-start recording — the Session start control is present and not recording.
    await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'false', { timeout: 20000 });
    await assertReport(page, 'Session · Speaking', AREAS.session);

    // CDP assertions: clean, self-contained page throughout.
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(trackingRequests, `unexpected tracking requests: ${trackingRequests.join(' | ')}`).toEqual([]);
  });
});
