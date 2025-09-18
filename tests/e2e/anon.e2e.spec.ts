import { test, expect } from './helpers';
import { HomePage } from './poms/homePage.pom';
import { SessionPage } from './poms/sessionPage.pom';

test.describe('Anonymous User Flow', () => {
  let homePage: HomePage;
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    homePage = new HomePage(page);
    sessionPage = new SessionPage(page);
  });

  test('start temporary session', async ({ page }) => {
    test.setTimeout(60000);
    await homePage.goto();
    await homePage.startFreeSession();
    await sessionPage.verifyOnPage();
    await expect(page.getByText('Live Transcript')).toBeVisible();
  });

  test('prompted to sign up after session', async ({ page }) => {
    test.setTimeout(60000);
    await homePage.goto();
    await homePage.startFreeSession();
    await sessionPage.verifyOnPage();

    await sessionPage.startStopButton.click();

    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();
  });
});
