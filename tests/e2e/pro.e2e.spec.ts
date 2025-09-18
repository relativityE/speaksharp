import { test, expect } from './helpers';
import { HomePage } from './poms/homePage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { TEST_USER_PRO } from '../constants';
import { loginUser } from './helpers';

test.describe('Pro User E2E Flow', () => {

  test('allows a standard (cloud) pro user to start and stop a session', async ({ page }) => {
    // Standard login for pro user
    await loginUser(page, TEST_USER_PRO.email, TEST_USER_PRO.password);
    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.assertOnHomePage();
    await homePage.assertNotUpgradeButton();
    await homePage.startFreeSession();

    const sessionPage = new SessionPage(page);
    await sessionPage.verifyOnPage();
    // TODO: Add assertion to confirm cloud mode is active

    await sessionPage.startStopButton.click();
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();
  });

  test('allows a pro user to use on-device transcription', async ({ page }) => {
    // This test mocks the user's 'preferred_mode' to 'on-device' via a network intercept.

    await loginUser(page, TEST_USER_PRO.email, TEST_USER_PRO.password);

    // Mock the user profile to have preferred_mode = 'on-device'
    await page.route('**/*.supabase.co/rest/v1/user_profiles*', async (route) => {
        const originalResponse = await route.fetch();
        const json = await originalResponse.json();
        if (json && json.length > 0) {
            json[0].preferred_mode = 'on-device';
        }
        await route.fulfill({ json });
    });

    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.startFreeSession();

    const sessionPage = new SessionPage(page);
    await sessionPage.verifyOnPage();

    // Verify that the on-device mode was initialized by listening for its log message
    const whisperLog = page.waitForEvent('console', msg => msg.text().includes('[LocalWhisper] Initialized.'));
    await expect(whisperLog).resolves.toBeTruthy();
  });
});
