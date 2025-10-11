import { test, expect } from '@playwright/test';

test('should allow a new user to sign up and see the authenticated state', async ({ page }) => {
  await page.goto('/auth');

  // Switch to the sign-up view
  await page.getByTestId('mode-toggle').click();

  const email = `test-verify-${Date.now()}@example.com`;
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill('password123');
  await page.getByTestId('sign-up-submit').click();

  // Assert that the "Sign Out" button is now visible
  await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 15000 });

  // Take a screenshot of the authenticated state
  await page.screenshot({ path: 'jules-scratch/verification/verification.png' });
});
