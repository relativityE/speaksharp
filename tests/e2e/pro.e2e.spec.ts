// tests/e2e/pro.e2e.spec.ts
import { test, expect, MockUser } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { HomePage } from './poms/homePage.pom';
import { stubThirdParties } from './sdkStubs';

test.describe('Pro User Flow', () => {
  test.beforeEach(async ({ page, login }) => {
    // Stub out third-party services before logging in.
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

  test('should not see upgrade prompts as a pro user', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.assertOnHomePage();
    await expect(homePage.upgradeButton).not.toBeVisible();
  });

  test('should have access to all transcription modes', async ({ page }) => {
    const sessionPage = new SessionPage(page);
    await sessionPage.goto(); // Ensure we are on the session page

    await test.step('Verify all transcription modes are enabled', async () => {
      await expect(sessionPage.sidebar.cloudAiMode).toBeEnabled();
      await expect(sessionPage.sidebar.onDeviceMode).toBeEnabled();
      await expect(sessionPage.sidebar.nativeMode).toBeEnabled();
    });
  });
});