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
 *    CTAs. Freestyle product CTA → signup → /session (real account-access composition, intent preserved);
 *    Guided product CTA → real "Notify me" dialog.
 *  - Authenticated `/practice`: compact welcome + continuity; product cards own their actions; Freestyle →
 *    /session directly; Guided "Notify me" opens the same dialog. Guided is "Coming Soon!" (no "Planned").
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
  await expect(page.getByRole('heading', { name: /^Freestyle Practice$/i })).toBeVisible();
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
    // Freestyle FREE TRIAL strip (the four support cards are removed); product cards own their CTAs.
    await expect(page.getByTestId('freestyle-trial-strip')).toBeVisible();
    await expect(page.getByTestId('freestyle-trial-strip')).toContainText(/free trial/i);
    await expect(page.getByTestId('support-freestyle-explain')).toHaveCount(0);
    // Guided status is the SOON header badge + the "Notify me at launch" CTA, never "Planned"; no continuity for anon.
    await expect(page.getByTestId('practice-card-guided-card').getByTestId('guided-soon-badge')).toBeVisible();
    await expect(page.getByRole('button', { name: /notify me about guided rehearsal/i })).toContainText(/notify me at launch/i);
    await expect(page.getByText('Planned', { exact: false })).toHaveCount(0);
    await expect(page.getByTestId('home-last-session')).toHaveCount(0);
    await settle(page);
    await page.screenshot({ path: `${DIR}/01-anonymous-root-desktop.png`, fullPage: true });

    await page.setViewportSize(MOBILE);
    await enterAnonLanding(page);
    await settle(page);
    await page.screenshot({ path: `${DIR}/02-anonymous-root-mobile.png`, fullPage: true });

    // Freestyle (product card CTA) → real account access → /session (intent preserved), no auto-record.
    await page.setViewportSize(DESKTOP);
    await enterAnonLanding(page);
    await page.getByTestId('practice-card-quick').click();
    await page.getByTestId('continue-freestyle-button').click();
    await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 15000 });
    await page.getByTestId('email-input').fill('anon-freestyle@example.com');
    await page.getByTestId('password-input').fill(PW);
    await page.getByTestId('sign-up-submit').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON))
      .toHaveAttribute('data-recording', 'false', { timeout: 20000 });
  });

  test('anonymous `/`: Guided "Notify me" opens the gated coming-soon dialog (waitlist OFF, no navigation)', async ({ page }) => {
    await bootAnonymous(page);
    await enterAnonLanding(page);
    await page.getByTestId('practice-card-guided').click();
    await expect(page.getByTestId('guided-notify-dialog')).toBeVisible();
    // Activation flag OFF in the shipped build → honest coming-soon acknowledgement, NOT a capture form.
    await expect(page.getByTestId('guided-notify-comingsoon')).toBeVisible();
    await expect(page.getByTestId('guided-notify-email')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('authenticated `/practice`: the choice question + continuity cluster; Freestyle → /session; Guided Notify me', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('practice-welcome-authed')).toContainText(/what would you like to do/i);
    await expect(page.getByTestId('home-last-session-secondary')).toBeVisible();
    // No anonymous marketing support section after login.
    await expect(page.getByTestId('practice-support')).toHaveCount(0);
    await expect(page.getByTestId('guided-soon-badge')).toBeVisible();

    await page.setViewportSize(DESKTOP);
    await settle(page);
    await page.screenshot({ path: `${DIR}/03-authenticated-practice-desktop.png`, fullPage: true });
    await page.setViewportSize(MOBILE);
    await settle(page);
    await page.screenshot({ path: `${DIR}/04-authenticated-practice-mobile.png`, fullPage: true });

    // Guided "Notify me" opens the gated coming-soon dialog (waitlist OFF); Freestyle goes directly to /session.
    await page.setViewportSize(DESKTOP);
    await page.getByTestId('practice-card-guided').click();
    await expect(page.getByTestId('guided-notify-dialog')).toBeVisible();
    await expect(page.getByTestId('guided-notify-comingsoon')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('practice-card-quick').click();
    await page.getByTestId('continue-freestyle-button').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
  });
});
