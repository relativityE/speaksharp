// tests/e2e/navigation.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin, MockUser } from './helpers';
import { stubThirdParties } from './sdkStubs';

// Define a mock user for this test suite. A pro user is required to access all pages.
const proUser: MockUser = {
  id: 'user-id-nav',
  email: 'nav-user@example.com',
  subscription_status: 'pro',
};

test.describe('App Navigation', () => {
  // Array of pages to test for navigation.
  const pagesToTest = [
    { name: 'Analytics', url: '/analytics', heading: 'Speaking Analytics' },
    { name: 'Pricing', url: '/pricing', heading: 'Pricing Plans' },
  ];

  test.beforeEach(async ({ page }) => {
    // Stub out third-party services.
    await stubThirdParties(page);

    await test.step('Programmatically log in as a pro user', async () => {
      await programmaticLogin(page, proUser);
    });
  });

  test('should allow navigation between pages from the sidebar', async ({ page }) => {
    // After login, the user starts at the root, which redirects to /session.
    await expect(page).toHaveURL('/session');

    for (const targetPage of pagesToTest) {
      await test.step(`Navigate to ${targetPage.name} page`, async () => {
        await page.getByRole('link', { name: targetPage.name }).click();
        await expect(page).toHaveURL(targetPage.url);
        await expect(page.getByRole('heading', { name: targetPage.heading })).toBeVisible();
      });
    }

    await test.step('Navigate back to the Session page', async () => {
      await page.getByRole('link', { name: 'Session' }).click();
      await expect(page).toHaveURL('/session');
      await expect(page.getByRole('heading', { name: 'Practice Session' })).toBeVisible();
    });
  });
});