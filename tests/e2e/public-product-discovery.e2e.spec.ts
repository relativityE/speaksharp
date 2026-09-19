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

/**
 * G17 L3/L5 — what only a real browser can prove: every price and term renders at >= 15px, both pricing-card control
 * slots compute to 52px (so the cards stay level with the Pro slot as plain text), and with payments disabled the
 * pricing block has exactly one focusable control.
 */
async function assertLandingTermsRender(page: Page) {
  const r = await page.evaluate(() => {
    const px = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : -1);
    const pricing = document.querySelector('section[aria-label="Pricing"]');
    const terms = document.querySelector('[data-testid="hero-terms"]');
    const priceNodes = pricing ? Array.from(pricing.querySelectorAll('article p span')) : [];
    const trial = document.querySelector('[data-testid="landing-trial-cta"]');
    const proSlot = document.querySelector('[data-testid="landing-pro-unavailable"], [data-testid="landing-pro-continue"]');
    const focusable = pricing ? pricing.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])').length : -1;
    return {
      termsPx: px(terms),
      termsPricePx: px(terms?.querySelector('span') ?? null),
      pricePx: priceNodes.map(px),
      trialH: trial ? (trial as HTMLElement).getBoundingClientRect().height : -1,
      proH: proSlot ? (proSlot as HTMLElement).getBoundingClientRect().height : -1,
      proDisabled: Boolean(document.querySelector('[data-testid="landing-pro-unavailable"]')),
      focusable,
    };
  });
  expect(r.termsPx, 'hero terms line size').toBeGreaterThanOrEqual(15);
  expect(r.termsPricePx, 'hero price size').toBeGreaterThanOrEqual(15);
  expect(r.pricePx.length, 'pricing prices found').toBeGreaterThan(0);
  for (const size of r.pricePx) expect(size, 'pricing price size').toBeGreaterThanOrEqual(15);
  expect(r.trialH, 'trial CTA slot height').toBe(52);
  expect(r.proH, 'Pro CTA slot height').toBe(52);
  if (r.proDisabled) expect(r.focusable, 'focusable controls in the pricing block (payments disabled)').toBe(1);
}

test.describe('#1061 one canonical auth-aware page', () => {
  test('anonymous `/`: #1475 G12 hero with the complete offer + product cards + pricing; NO continuity', async ({ page }) => {
    await bootAnonymous(page);

    await page.setViewportSize(DESKTOP);
    await enterAnonLanding(page);
    await expect(page.getByTestId('practice-hero-start-free')).toBeVisible();
    // #1475: the retired trial strip is replaced by the complete offer at every signup decision point.
    await expect(page.getByTestId('freeform-trial-strip')).toHaveCount(0);
    // G17 L1: one hero terms line pairs the trial with its price; the closing band states neither (supersedes #1470's
    // closing-band copy, PO + PM 2026-09-19). L2: `no card` nowhere on the route.
    await expect(page.getByTestId('hero-terms')).toHaveText('Free for 30 days, $10/month after.');
    await expect(page.getByRole('region', { name: /call to action/i })).not.toContainText(/30 day|\$10/i);
    await expect(page.locator('body')).not.toContainText(/no card/i);
    await expect(page.getByRole('region', { name: /pricing/i })).toBeVisible();
    await assertLandingTermsRender(page);
    await expect(page.getByTestId('support-freeform-explain')).toHaveCount(0);
    // Focus Points is activated (#1046 5b): no SOON badge, a real start CTA; never "Planned"; no continuity for anon.
    await expect(page.getByTestId('objective-soon-badge')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /start focus points/i })).toContainText(/start focus points/i);
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
    // H-4: a returning user's continuity is the promoted resume band, which owns the review action — the
    // legacy corner chip is hidden so two controls never point at the same place.
    await expect(page.getByTestId('home-resume-band')).toBeVisible();
    await expect(page.getByTestId('home-resume-meta')).toBeVisible();
    await expect(page.getByTestId('home-last-session')).toHaveCount(0);
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
