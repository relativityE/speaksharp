import { test, expect } from '../setup/verifyOnlyStepTracker';
import { HomePage } from './poms/homePage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { TEST_USER_PRO } from '../constants';

test.describe('Pro User Flow', () => {
  test.use({ storageState: 'storage/pro.json' });

  test('should not see upgrade prompts as a pro user', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.assertOnHomePage();
    await expect(homePage.upgradeButton).not.toBeVisible();

    const sessionPage = new SessionPage(page);
    await sessionPage.goto();
    await sessionPage.assertOnSessionPage();
    await expect(sessionPage.upgradeButton).not.toBeVisible();
  });

  test('should have access to all transcription modes', async ({ page }) => {
    const sessionPage = new SessionPage(page);
    await sessionPage.goto();
    await sessionPage.assertOnSessionPage();
    await expect(sessionPage.sidebar.cloudAiMode).toBeEnabled();
    await expect(sessionPage.sidebar.onDeviceMode).toBeEnabled();
    await expect(sessionPage.sidebar.nativeMode).toBeEnabled();
  });
});