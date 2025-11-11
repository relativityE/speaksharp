// tests/e2e/health-check.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Health Check', () => {
  test('should successfully authenticate @health-check', async ({ page }) => {
    await programmaticLogin(page);
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
  });
});
