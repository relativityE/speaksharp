import { test, expect, programmaticLogin } from './helpers';
import { AnalyticsPage } from '../pom';

test.describe('User Tier Flows', () => {
  let analyticsPage: AnalyticsPage;

  test.beforeEach(async ({ page }) => {
    analyticsPage = new AnalyticsPage(page);
  });

  const userTiers = [
    { type: 'pro', email: 'pro-user@example.com', shouldSeeBanner: false },
    { type: 'free', email: 'free-user@example.com', shouldSeeBanner: true },
  ];

  for (const user of userTiers) {
    test(`should handle upgrade banner correctly for ${user.type} user`, async ({ page }) => {
      await programmaticLogin(page, user.email);
      await analyticsPage.navigate();
      await expect(analyticsPage.heading).toBeVisible();

      if (user.shouldSeeBanner) {
        await expect(analyticsPage.upgradeBanner).toBeVisible();
      } else {
        await expect(analyticsPage.upgradeBanner).toHaveCount(0);
      }
    });
  }
});
