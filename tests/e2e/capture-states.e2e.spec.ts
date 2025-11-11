import { test } from '@playwright/test';
import { captureAuthStates } from './helpers';

test.describe('Screenshot Capture', () => {
  test('capture UI states', async ({ page }) => {
    await captureAuthStates(page);
  });
});
