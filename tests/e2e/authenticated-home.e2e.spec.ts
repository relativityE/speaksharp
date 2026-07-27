import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * P0 hotfix proof: the authenticated HOME is `/practice`, not the old public Index.
 * Real clicks (no force). #1061: anonymous `/` now renders the SHARED canonical PracticePage (anonymous
 * state — no continuity/account actions); protected deep-links are preserved.
 */

const onPractice = async (page: Page) => {
  await expect(page).toHaveURL(/\/practice(\?|$)/, { timeout: 30000 });
  await expect(page.getByTestId('practice-root')).toBeVisible();
};

test.describe('Authenticated home → /practice (root route + Navigation)', () => {
  test('root redirect, Home + logo → /practice, refresh persists, /session deep-link preserved, sign-out → /', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });

    // A · authenticated root visit (refresh-equivalent) redirects to /practice.
    await navigateToRoute(page, '/');
    await onPractice(page);
    await page.screenshot({ path: 'test-results/authenticated-home/01-authed-root-redirects-to-practice.png', fullPage: true });

    // B · authenticated Home nav → /practice, and Home reads as active there.
    await navigateToRoute(page, '/practice');
    const home = page.getByTestId('nav-home-link');
    await expect(home).toHaveAttribute('href', '/practice');
    await home.click();
    await onPractice(page);

    // B · authenticated logo → /practice.
    await page.getByRole('link', { name: 'SpeakSharp Home' }).click();
    await onPractice(page);

    // A · a browser refresh on /practice stays on /practice (no bounce to Index).
    await page.reload();
    await onPractice(page);

    // C · protected deep-link preserved: an authenticated /session refresh stays on /session
    //     (authenticated users are NOT globally force-redirected home).
    await navigateToRoute(page, '/session');
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });

    // C · sign-out returns to the public `/` and shows the anonymous surface (Sign In / Get Started).
    // #1061: `/` now renders the SHARED canonical PracticePage in its anonymous state — the same page +
    // product cards, but WITHOUT the authenticated continuity block / account actions.
    await navigateToRoute(page, '/practice');
    await page.getByTestId('nav-sign-out-button').click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });
    await expect(page.getByTestId('practice-root')).toHaveCount(1);
    await expect(page.getByTestId('practice-continuity')).toHaveCount(0); // no authenticated continuity for anon
    await expect(page.getByTestId('practice-continuity-empty')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /get started/i }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/authenticated-home/02-anonymous-root-shows-shared-page.png', fullPage: true });
  });
});
