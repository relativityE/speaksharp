import { test, expect, loginUser, startSession, stopSession, expectSubscriptionButton } from './helpers';
import { TEST_USER_PRO, TEST_USER_PREMIUM } from '../constants';
import { HomePage } from './poms/homePage.pom';

const paidUsers = [
  { name: 'Pro', user: TEST_USER_PRO },
  { name: 'Premium', user: TEST_USER_PREMIUM },
];

for (const { name, user } of paidUsers) {
  test.describe(`${name} User E2E Flow`, () => {
    test.beforeEach(async ({ page }) => {
      await loginUser(page, user.email, user.password);
    });

    test(`allows a ${name.toLowerCase()} user to start and stop a session`, async ({ page }) => {
      const homePage = new HomePage(page);
      await homePage.assertOnHomePage();
      await homePage.assertNotUpgradeButton();
      await homePage.startSession();
      await homePage.stopSession();
    });
  });
}
