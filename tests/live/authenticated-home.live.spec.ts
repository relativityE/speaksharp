import { type Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';
import { goToPublicRoute, navigateToRoute } from '../e2e/helpers';
import { ROUTES, TEST_IDS } from '../constants';

/**
 * Deployed-live proof of the P0 hotfix (#1025): the authenticated HOME is `/practice`.
 * Drives the REAL production app with a real BASIC (free) session — no mocks. Creates NO issue-report
 * rows (nothing to clean). Anonymous `/` must still show the public Index.
 */

const BASIC_EMAIL = (process.env.BASIC_TEST_EMAIL ?? process.env.E2E_BASIC_EMAIL ?? '').trim();
const BASIC_PASSWORD = (process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_BASIC_PASSWORD ?? '').trim();

const atPractice = async (page: Page, why: string) => {
  await expect(page.getByTestId('practice-root'), why).toBeVisible({ timeout: 20000 });
  expect(new URL(page.url()).pathname, why).toBe('/practice');
};

test.describe('Authenticated home = /practice (live P0 hotfix proof, BASIC free account)', () => {
  test.beforeAll(() => {
    test.skip(!BASIC_EMAIL || !BASIC_PASSWORD, 'Requires BASIC_TEST_EMAIL / BASIC_TEST_PASSWORD.');
  });

  async function signIn(page: Page) {
    await goToPublicRoute(page, ROUTES.SIGN_IN);
    await page.getByTestId(TEST_IDS.EMAIL_INPUT).fill(BASIC_EMAIL);
    await page.getByTestId(TEST_IDS.PASSWORD_INPUT).fill(BASIC_PASSWORD);
    await page.getByTestId(TEST_IDS.SIGN_IN_SUBMIT).click();
    await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible({ timeout: 20000 });
  }

  test('authenticated root redirect + Home/logo → /practice + refresh persists + deep-links preserved', async ({ page }) => {
    await signIn(page);

    // Authenticated visit to the ROOT `/` (the reported bug: this used to show the old Index) → /practice.
    await navigateToRoute(page, '/');
    await atPractice(page, 'authenticated / must redirect to /practice');

    // Home nav → /practice (and it points there).
    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('nav-home-link')).toHaveAttribute('href', '/practice');
    await page.getByTestId('nav-home-link').click();
    await atPractice(page, 'Home → /practice');

    // Logo → /practice.
    await page.getByRole('link', { name: 'SpeakSharp Home' }).click();
    await atPractice(page, 'logo → /practice');

    // A browser refresh on /practice stays on /practice.
    await page.reload();
    await atPractice(page, 'refresh on /practice stays /practice');

    // Deep-link preservation: an authenticated /session and /analytics refresh are NOT forced home.
    await navigateToRoute(page, '/session');
    await expect(page, '/session deep-link preserved').toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    await navigateToRoute(page, '/analytics');
    await expect(page, '/analytics deep-link preserved').toHaveURL(/\/analytics(\?|$)/, { timeout: 30000 });
  });

  test('anonymous root shows the public Index; /practice is auth-protected', async ({ page }) => {
    // Fresh (no sign-in) context: `/` is the public marketing Index, not the practice page.
    await goToPublicRoute(page, '/');
    await expect(page.getByRole('link', { name: /get started/i }).first(), 'anonymous / shows public Index').toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('practice-root')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');

    // Anonymous /practice is protected → bounced to the auth flow (never renders the practice page).
    await goToPublicRoute(page, '/practice');
    await expect(page, 'anonymous /practice → auth').toHaveURL(/\/auth(\/|$)/, { timeout: 20000 });
    await expect(page.getByTestId('practice-root')).toHaveCount(0);
  });
});
