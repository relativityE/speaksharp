import { test, expect, type Page } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { setupE2EManifest } from './helpers/setupE2EManifest';
import { setupBrowserLogging, goToApp, programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * #1061 — ONE canonical auth-aware page (PracticePage) at BOTH `/` (anonymous marketing state) and
 * `/practice` (authenticated product state).
 *
 *  - Anonymous `/`: large hero + Start free; one honest Free Trial strip; product cards WITHOUT duplicate
 *    CTAs. Freeform product CTA → signup → /session (real account-access composition, intent preserved);
 *    Focus Points CTA → signup first (the brief RPCs require auth).
 *  - Authenticated `/practice`: compact welcome + continuity; product cards own their actions; Freeform →
 *    /session directly; Focus Points opens the real capture dialog (#1046 slice 5b — activated, no "Planned").
 *
 * Screenshots: anonymous `/` and authenticated `/practice`, desktop + mobile → test-results/product-discovery.
 */

const DIR = 'test-results/product-discovery';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const PW = 'Test1234!pass';

async function bootAnonymous(page: Page) {
  await setupE2EMocks(page, { userType: 'free' });
  setupBrowserLogging(page);
  await setupE2EManifest(page, { engineType: 'mock', userType: 'free', emptySessions: true });
}

async function enterAnonLanding(page: Page) {
  await goToApp(page, '/');
  await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: /^Open Mic$/i })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
}

async function settle(page: Page) {
  await page.waitForFunction(() => {
    let el = document.querySelector('[data-testid="practice-root"]') as HTMLElement | null;
    while (el) { if (parseFloat(getComputedStyle(el).opacity || '1') < 0.99) return false; el = el.parentElement; }
    return true;
  }, { timeout: 10000 });
}

test.describe('#1061 one canonical auth-aware page', () => {
  test('anonymous `/`: hero + Free Trial strip + product cards; NO continuity; Coming Soon!', async ({ page }) => {
    await bootAnonymous(page);

    await page.setViewportSize(DESKTOP);
    await enterAnonLanding(page);
    await expect(page.getByTestId('practice-hero-start-free')).toBeVisible();
    // Freeform FREE TRIAL strip (the four support cards are removed); product cards own their CTAs.
    await expect(page.getByTestId('freeform-trial-strip')).toBeVisible();
    await expect(page.getByTestId('freeform-trial-strip')).toContainText(/free trial/i);
    await expect(page.getByTestId('support-freeform-explain')).toHaveCount(0);
    // Focus Points is activated (#1046 5b): no SOON badge, a real start CTA; never "Planned"; no continuity for anon.
    await expect(page.getByTestId('objective-soon-badge')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /start focus points/i })).toContainText(/start your session/i);
    await expect(page.getByText('Planned', { exact: false })).toHaveCount(0);
    await expect(page.getByTestId('home-last-session')).toHaveCount(0);
    await settle(page);
    await page.screenshot({ path: `${DIR}/01-anonymous-root-desktop.png`, fullPage: true });

    await page.setViewportSize(MOBILE);
    await enterAnonLanding(page);
    await settle(page);
    await page.screenshot({ path: `${DIR}/02-anonymous-root-mobile.png`, fullPage: true });

    // Freeform (product card CTA) → real account access → /session (intent preserved), no auto-record.
    await page.setViewportSize(DESKTOP);
    await enterAnonLanding(page);
    await page.getByTestId('practice-card-freeform').click();
    await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 15000 });
    await page.getByTestId('email-input').fill('anon-freeform@example.com');
    await page.getByTestId('password-input').fill(PW);
    await page.getByTestId('sign-up-submit').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    // #1222: landed on the session page in the idle before-state (mic card shown, not auto-recording).
    await expect(page.getByTestId(TEST_IDS.MIC_CARD)).toBeVisible({ timeout: 20000 });
  });

  test('anonymous `/`: Focus Points routes to sign-up first (the brief RPCs require auth)', async ({ page }) => {
    await bootAnonymous(page);
    await enterAnonLanding(page);
    await page.getByTestId('practice-card-objective').click();
    // Anonymous users authenticate before capturing a brief — no capture dialog is shown here.
    await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 15000 });
    await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
  });

  test('authenticated `/practice`: the choice question + continuity cluster; Freeform → /session; Focus Points → capture dialog', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('practice-welcome-authed')).toContainText(/what would you like to do/i);
    await expect(page.getByTestId('home-last-session-secondary')).toBeVisible();
    // No anonymous marketing support section after login.
    await expect(page.getByTestId('practice-support')).toHaveCount(0);
    await expect(page.getByTestId('objective-soon-badge')).toHaveCount(0); // Focus Points is activated (#1046 5b)

    await page.setViewportSize(DESKTOP);
    await settle(page);
    await page.screenshot({ path: `${DIR}/03-authenticated-practice-desktop.png`, fullPage: true });
    await page.setViewportSize(MOBILE);
    await settle(page);
    await page.screenshot({ path: `${DIR}/04-authenticated-practice-mobile.png`, fullPage: true });

    // Focus Points opens the real capture dialog; Freeform goes directly to /session.
    await page.setViewportSize(DESKTOP);
    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await expect(page.getByTestId('objective-setup-form')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('practice-card-freeform').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });

    // A user who finishes or enters Open Mic can move directly to Focus Points from the header;
    // returning Home is never a prerequisite for switching products.
    await page.getByTestId('nav-products-button').click();
    await expect(page.getByTestId('nav-products-open-mic')).toBeVisible();
    await page.getByTestId('nav-products-focus-points').click();
    await expect(page).toHaveURL(/\/practice(?:\?|$)/, { timeout: 30000 });
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
  });
});
