// tests/auth.e2e.spec.ts - REFACTORED
import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Stub all third-party services
    await stubThirdParties(page);
  });

  test('a user can sign in and is redirected to the main page', async ({ page }) => {
    await page.goto('/auth');

    // Expect the sign-in form to be visible
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

    // Fill in the form with a pro user's credentials
    await page.getByLabel('Email').fill('pro@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // After successful login, user should be redirected to the root
    await page.waitForURL('/');

    // The header should now show the user's email and a "Sign Out" button
    await expect(page.getByText('pro@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible();
  });

  test('a logged-in user is redirected from auth page to root', async ({ page }) => {
    // This test simulates a user who is already logged in and navigates to /auth

    // Log the user in first
    await page.goto('/auth');
    await page.getByLabel('Email').fill('free@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/');

    // Now, navigate back to the auth page
    await page.goto('/auth');

    // User should be immediately redirected back to the root
    await page.waitForURL('/');
    await expect(page.getByText('free@example.com')).toBeVisible();
  });
});
