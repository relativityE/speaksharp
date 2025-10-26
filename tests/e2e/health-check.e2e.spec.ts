import { test } from '@playwright/test';
import { healthCheck } from './shared';

test.describe('Health Check', () => {
  test('should successfully authenticate and display the logged-in state on the homepage', async ({ page }) => {
    // This test simply calls the reusable healthCheck function.
    await healthCheck(page);
  });
});
