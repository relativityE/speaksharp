import { test, expect } from './helpers';
import { loginUser } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { TEST_USER_FREE } from '../constants';

test.describe('Free User Flow', () => {
  test('free user is on session page and sees upgrade prompt', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);
    await page.goto('/session');

    const sessionPage = new SessionPage(page);
    await sessionPage.verifyOnPage(); // Use POM to wait for page to be ready

    // The 'Start Session' button in the SessionSidebar component has the upgrade prompt logic
    // We can check for the button that contains the text 'Upgrade'
    const upgradeButton = page.locator('button', { hasText: 'Upgrade' });
    await expect(upgradeButton).toBeVisible();
  });
});
