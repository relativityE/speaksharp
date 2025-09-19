import { test, expect } from './helpers';
import { HomePage } from './poms/homePage.pom';
import { TEST_USER_PRO } from '../constants';
import { loginUser } from './helpers';

test.describe('Visual Regression', () => {

  test('should match the homepage screenshot for a pro user', async ({ page }) => {
    // Arrange: Log in as a pro user to ensure all UI elements are visible
    await loginUser(page, TEST_USER_PRO.email, TEST_USER_PRO.password);
    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.assertOnHomePage();

    // Act & Assert: Take a screenshot and compare it to the baseline.
    // The first time this test is run, it will fail and generate a new
    // baseline screenshot. Subsequent runs will compare against this baseline.
    await expect(page).toHaveScreenshot('homepage-pro-user.png', {
      fullPage: true,
      // A threshold of 0.2 is a reasonable starting point to account for
      // minor rendering differences between local and CI environments.
      threshold: 0.2
    });
  });

});
