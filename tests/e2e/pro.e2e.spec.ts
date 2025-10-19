import { test, expect, programmaticLogin } from './helpers';
import { SessionPage } from '../pom';

test.describe('Pro User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    sessionPage = new SessionPage(page);
  });

  test('should not see upgrade prompts as a pro user', async ({ page }) => {
    await programmaticLogin(page, 'pro-user@example.com');
    await sessionPage.goto();
    await expect(sessionPage.heading).toBeVisible();
    await expect(page.getByTestId('upgrade-banner')).toHaveCount(0);
  });

  test('should have access to the session page', async ({ page }) => {
    await programmaticLogin(page, 'pro-user@example.com');
    await sessionPage.goto();
    await expect(sessionPage.heading).toBeVisible();
  });
});
