import { test, expect } from './helpers';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';

test.describe('Pro User Flow', () => {
  let authPage: AuthPage;
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    sessionPage = new SessionPage(page);
  });

  test('no upgrade prompt for pro', async ({ page }) => {
    test.setTimeout(60000);
    await authPage.goto();
    await authPage.login('pro@example.com', 'password');
    await sessionPage.verifyOnPage();

    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');

    const upgradeButton = page.getByTestId('analytics-page-upgrade-button');
    await expect(upgradeButton).not.toBeVisible();
  });

  test('start and stop session for pro', async ({ page }) => {
    test.setTimeout(60000);
    await authPage.goto();
    await authPage.login('pro@example.com', 'password');

    await sessionPage.verifyOnPage();

    await sessionPage.startStopButton.click();
    await expect(sessionPage.startStopButton).toHaveText(/Stop Session/);

    await sessionPage.startStopButton.click();
    await expect(sessionPage.startStopButton).toHaveText(/Start Session/);
  });
});

test.describe.configure({ timeout: 60000, retries: 1 });
