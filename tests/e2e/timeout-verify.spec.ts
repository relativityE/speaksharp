import { test } from '@playwright/test';
import { navigateToRoute } from './helpers';

test('intentional timeout for telemetry verification', async ({ page }) => {
  test.fail();
  await navigateToRoute(page, '/');
  // Trigger a timeout through an impossible expectation
  await page.locator('non-existent').waitFor({ timeout: 1000 });
});
