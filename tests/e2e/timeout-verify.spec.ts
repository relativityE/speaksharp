import { test } from '@playwright/test';

test('intentional timeout for telemetry verification', async ({ page }) => {
  test.fail();
  await page.goto('http://localhost:5173');
  // Trigger a timeout through an impossible expectation
  await page.locator('non-existent').waitFor({ timeout: 1000 });
});
