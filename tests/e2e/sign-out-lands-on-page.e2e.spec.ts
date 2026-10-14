import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * PO 2026-09-19 (Production): Sign Out from inside the app left the user on `/auth` with ONLY the anonymous nav
 * and an empty body. `authenticated-home.e2e` never saw it: it asserts only that the nav flipped to anonymous
 * ("the exact post-sign-out URL … is a pre-existing redirect race"), which a blank body satisfies.
 *
 * This spec asserts what the user needs after signing out: a real page, exactly one route subtree, and the
 * destination the Sign Out handler intends (`/`, the anonymous landing), from each protected page a user
 * signs out of.
 */

async function signOutFrom(page: Page, route: string) {
  await programmaticLoginWithRoutes(page, { userType: 'free' });
  await navigateToRoute(page, route);
  await expect(page.getByTestId('nav-account-avatar')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('nav-account-avatar').click();
  await page.getByTestId('nav-sign-out-button').click();
  await expect(page.getByTestId('nav-account-avatar')).toHaveCount(0, { timeout: 30000 });
}

async function expectLandedOnAnonymousHome(page: Page, label: string) {
  // Let every in-flight redirect settle before judging where the user ended up.
  await expect(page.getByTestId('route-presence-child')).toHaveCount(1, { timeout: 10000 });
  await expect(page, `${label}: final URL`).toHaveURL(/^[^?#]*\/\/[^/]+\/(\?|#|$)/, { timeout: 10000 });
  await expect(page.getByTestId('practice-root'), `${label}: anonymous landing is rendered, not a blank body`).toBeVisible();
}

test.describe('Sign Out lands on a real page', () => {
  for (const route of ['/session', '/practice', '/analytics']) {
    test(`from ${route}`, async ({ page }) => {
      await signOutFrom(page, route);
      await expectLandedOnAnonymousHome(page, `sign-out from ${route}`);
      await page.screenshot({ path: `test-results/sign-out/from-${route.slice(1)}.png`, fullPage: true });
    });
  }
});
