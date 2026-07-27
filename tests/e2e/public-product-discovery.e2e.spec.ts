import { test, expect, type Page } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { setupE2EManifest } from './helpers/setupE2EManifest';
import { setupBrowserLogging, goToApp } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * #1061 Increment A — public two-product discovery + Freestyle intent preservation.
 *
 * Exercises the REAL account-access composition (anonymous landing → the actual AuthPage form →
 * PostAuthRedirect), NOT an already-authenticated redirect stub, per the PO requirement. Proves:
 *  - Start free → signup → /practice
 *  - Start Freestyle → signup → /session (intent preserved through the real form)
 *  - Start Freestyle → switch signup→existing-account sign-in → /session
 *  - recording does not auto-start on /session
 * (Open-redirect rejection of an unsafe `from` is proven at the unit level in
 *  frontend/src/services/__tests__/postAuthRouting.test.ts; the UI only ever emits `/session`.)
 *
 * Desktop + mobile screenshots → test-results/product-discovery/ (1-day ux-review artifact; not committed).
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

async function gotoLanding(page: Page) {
  // Anonymous boot (no programmaticLogin) — goToApp performs the real public navigation + readiness wait.
  await goToApp(page, '/');
  await expect(page.getByTestId('product-discovery-section')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: /private practice\. public impact/i })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
}

// Fail-closed settle: the hero heading's opacity must reach 1 (framer-motion) before a screenshot.
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const h1 = document.querySelector('h1');
    return !!h1 && parseFloat(getComputedStyle(h1).opacity || '1') >= 0.99;
  }, { timeout: 10000 });
}

async function submitSignup(page: Page, email: string) {
  await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 15000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(PW);
  await page.getByTestId('sign-up-submit').click();
}

test.describe('#1061 public product discovery + Freestyle intent (real account-access composition)', () => {
  test('landing shows both products with truthful availability and CTA hierarchy (desktop + mobile)', async ({ page }) => {
    await bootAnonymous(page);

    await page.setViewportSize(DESKTOP);
    await gotoLanding(page);
    // Both products, truthful availability (text, not color alone).
    await expect(page.getByRole('heading', { name: /choose how you want to practice/i })).toBeVisible();
    await expect(page.getByTestId('product-discovery-freestyle-status')).toHaveText(/available now/i);
    await expect(page.getByTestId('product-discovery-guided-status')).toHaveText(/planned — not available yet/i);
    // Guided is truthful/inert: no actionable control inside its card.
    await expect(page.getByTestId('product-discovery-guided').getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('product-discovery-guided').getByRole('link')).toHaveCount(0);
    // Hero CTA hierarchy: Start free + Sign in + a tertiary sample-feedback link.
    await expect(page.getByTestId('start-free-session-button')).toBeVisible();
    await expect(page.getByTestId('hero-signin-button')).toBeVisible();
    await expect(page.getByTestId('hero-sample-feedback-link')).toBeVisible();
    // No testimonials on the public landing.
    await expect(page.getByText(/what our users say|testimonial/i)).toHaveCount(0);
    await settle(page);
    await page.screenshot({ path: `${DIR}/01-discovery-desktop.png`, fullPage: true });

    await page.setViewportSize(MOBILE);
    await gotoLanding(page);
    await settle(page);
    await page.screenshot({ path: `${DIR}/02-discovery-mobile.png`, fullPage: true });
  });

  test('Start free → signup → /practice', async ({ page }) => {
    await bootAnonymous(page);
    await gotoLanding(page);
    await page.getByTestId('start-free-session-button').click();
    await submitSignup(page, 'startfree@example.com');
    await expect(page).toHaveURL(/\/practice(\?|$)/, { timeout: 30000 });
  });

  test('Start Freestyle → signup → /session (intent preserved), no auto-record', async ({ page }) => {
    await bootAnonymous(page);
    await gotoLanding(page);
    await page.getByTestId('product-discovery-freestyle-cta').click();
    await submitSignup(page, 'freestyle@example.com');
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    // Must NOT auto-start recording.
    await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON))
      .toHaveAttribute('data-recording', 'false', { timeout: 20000 });
  });

  test('Start Freestyle → switch signup→sign-in → /session (intent survives the view switch)', async ({ page }) => {
    await bootAnonymous(page);
    await gotoLanding(page);
    await page.getByTestId('product-discovery-freestyle-cta').click();
    await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 15000 });
    // Switch to the existing-account sign-in view, then sign in.
    await page.getByTestId('mode-toggle').click();
    await page.getByTestId('email-input').fill('returning@example.com');
    await page.getByTestId('password-input').fill(PW);
    await page.getByTestId('sign-in-submit').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
  });
});
