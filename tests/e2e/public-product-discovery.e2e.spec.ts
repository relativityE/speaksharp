import { test, expect, type Page } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { setupE2EManifest } from './helpers/setupE2EManifest';
import { setupBrowserLogging, goToApp, programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * #1061 — ONE canonical auth-aware page (PracticePage) rendered at BOTH `/` (anonymous) and `/practice`
 * (authenticated). Proves the shared page + only auth-dependent controls change, and that Freestyle intent
 * survives the REAL account-access composition (anonymous → real AuthPage form → PostAuthRedirect).
 *
 *  - Anonymous `/`: same hero + both product cards; NO session history/account actions; Freestyle →
 *    signup → /session (intent preserved); Guided truthfully planned; no auto-record.
 *  - Authenticated `/practice`: same hero + cards + the "Ready for your next practice?" continuity block;
 *    Freestyle → /session directly.
 *
 * Screenshots: anonymous `/` and authenticated `/practice`, desktop + mobile → test-results/product-discovery
 * (1-day ux-review artifact; not committed).
 */

const DIR = 'test-results/product-discovery';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const PW = 'Test1234!pass';

async function bootAnonymous(page: Page) {
  await setupE2EMocks(page, { userType: 'free' });
  setupBrowserLogging(page);
  await setupE2EManifest(page, { engineType: 'mock', userType: 'free', emptySessions: true }); // no storage → anonymous
}

async function enterAnonLanding(page: Page) {
  await goToApp(page, '/');
  await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: /private practice\. public impact/i })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
}

// Fail-closed settle: the practice-root page-transition opacity must reach 1 before a screenshot.
async function settle(page: Page) {
  await page.waitForFunction(() => {
    let el = document.querySelector('[data-testid="practice-root"]') as HTMLElement | null;
    while (el) { if (parseFloat(getComputedStyle(el).opacity || '1') < 0.99) return false; el = el.parentElement; }
    return true;
  }, { timeout: 10000 });
}

test.describe('#1061 one canonical auth-aware page (anonymous `/` + authenticated `/practice`)', () => {
  test('anonymous `/`: same hero + product choices, NO session history; Freestyle → signup → /session', async ({ page }) => {
    await bootAnonymous(page);

    // Desktop landing.
    await page.setViewportSize(DESKTOP);
    await enterAnonLanding(page);
    await expect(page.getByRole('heading', { name: /^Freestyle Practice$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeVisible();
    await expect(page.getByText(/choose how you want to practice/i)).toBeVisible();
    // Guided is truthfully planned; anonymous users get NO continuity/account actions.
    await expect(page.getByTestId('practice-card-guided')).toContainText(/guided rehearsal/i);
    await expect(page.getByTestId('practice-continuity')).toHaveCount(0);
    await expect(page.getByTestId('practice-continuity-empty')).toHaveCount(0);
    await settle(page);
    await page.screenshot({ path: `${DIR}/01-anonymous-root-desktop.png`, fullPage: true });

    // Mobile landing.
    await page.setViewportSize(MOBILE);
    await enterAnonLanding(page);
    await settle(page);
    await page.screenshot({ path: `${DIR}/02-anonymous-root-mobile.png`, fullPage: true });

    // Freestyle → real account access → /session (intent preserved), no auto-record.
    await page.setViewportSize(DESKTOP);
    await enterAnonLanding(page);
    await page.getByTestId('practice-card-quick').click();
    await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 15000 });
    await page.getByTestId('email-input').fill('anon-freestyle@example.com');
    await page.getByTestId('password-input').fill(PW);
    await page.getByTestId('sign-up-submit').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON))
      .toHaveAttribute('data-recording', 'false', { timeout: 20000 });
  });

  test('anonymous `/`: Guided is truthfully planned/unavailable (no navigation)', async ({ page }) => {
    await bootAnonymous(page);
    await enterAnonLanding(page);
    await page.getByTestId('practice-card-guided').click();
    await expect(page.getByTestId('guided-unavailable-notice')).toHaveText('Product not available at this time');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('authenticated `/practice`: SAME page + continuity; Freestyle → /session directly', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' }); // returning session history by default
    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
    // Same hero + cards…
    await expect(page.getByRole('heading', { name: /private practice\. public impact/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Freestyle Practice$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeVisible();
    // …PLUS the authenticated continuity block (the auth-dependent difference).
    await expect(page.getByTestId('practice-continuity-summary')).toBeVisible();

    await page.setViewportSize(DESKTOP);
    await settle(page);
    await page.screenshot({ path: `${DIR}/03-authenticated-practice-desktop.png`, fullPage: true });
    await page.setViewportSize(MOBILE);
    await settle(page);
    await page.screenshot({ path: `${DIR}/04-authenticated-practice-mobile.png`, fullPage: true });

    // Authenticated Freestyle goes DIRECTLY to /session.
    await page.setViewportSize(DESKTOP);
    await page.getByTestId('practice-card-quick').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
  });
});
