// tests/e2e/navigation.e2e.spec.ts
import { test, expect, MockUser } from './helpers';
import { stubThirdParties } from './sdkStubs';

test.describe('App Navigation', () => {
  // Array of pages to test for navigation.
  const pagesToTest = [
    { name: 'Analytics', url: '/analytics', heading: 'Speaking Analytics' },
    { name: 'Pricing', url: '/pricing', heading: 'Pricing Plans' },
  ];

  test.beforeEach(async ({ page, login }) => {
    // Stub out third-party services.
    await stubThirdParties(page);

    await test.step('Programmatically log in as a pro user', async () => {
      const mockUser: MockUser = {
        id: 'mock-user-id-pro',
        email: 'pro-user@test.com',
        subscription_status: 'pro',
      };
      await login(mockUser);
    });
  });

  test('should allow navigation between pages from the sidebar', async ({ page }) => {
    // After login, the user starts at the root. We can immediately start testing navigation.
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