import { test, loginUser, expectSubscriptionButton } from './helpers';

test.describe('Free User Flow', () => {
  test.beforeEach(() => {
    test.setTimeout(15000);
  });

  test('free user sees upgrade prompt', async ({ page }) => {
    await loginUser(page, 'free@example.com', 'password');
    await page.goto('/session', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expectSubscriptionButton(page, 'free');
  });

  test('pro user does not see upgrade prompt', async ({ page }) => {
    await loginUser(page, 'pro@example.com', 'password');
    await page.goto('/session', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expectSubscriptionButton(page, 'pro');
  });
});

test.describe.configure({ timeout: 60000, retries: 1 });
