import { test, expect } from '@playwright/test';
import { TEST_USER_FREE } from '../constants';

test.describe('Final Granular Debugging of Login Flow', () => {
  test('should execute and document each step of the login process', async ({ page }) => {
    // 1. Initial Navigation
    console.log('[DEBUG] Step 1: Navigating to homepage...');
    await page.goto('/');
    await page.screenshot({ path: 'debug-01-homepage.png' });
    console.log('[DEBUG] Step 1: Homepage loaded.');

    // 2. Clear localStorage
    console.log('[DEBUG] Step 2: Clearing localStorage...');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'debug-02-reloaded.png' });
    console.log('[DEBUG] Step 2: localStorage cleared and page reloaded.');

    // 3. Wait for MSW
    console.log('[DEBUG] Step 3: Waiting for MSW to be ready...');
    await page.waitForFunction(() => (window as any).mswReady, null, { timeout: 15000 });
    await page.screenshot({ path: 'debug-03-msw-ready.png' });
    console.log('[DEBUG] Step 3: MSW is ready.');

    // 4. Click the "Login" link
    console.log('[DEBUG] Step 4: Clicking the "Login" link...');
    const loginLink = page.getByRole('link', { name: 'Login' });
    await expect(loginLink, 'The "Login" link should be visible').toBeVisible();
    await loginLink.click();
    await page.waitForURL('**/auth');
    await page.screenshot({ path: 'debug-04-auth-page.png' });
    console.log('[DEBUG] Step 4: Successfully navigated to the auth page.');

    // 5. Fill in the email address
    console.log('[DEBUG] Step 5: Filling in the email address...');
    const emailInput = page.getByTestId('email-input');
    await expect(emailInput, 'The email input should be visible').toBeVisible();
    await emailInput.fill(TEST_USER_FREE.email);
    await page.screenshot({ path: 'debug-05-email-filled.png' });
    console.log('[DEBUG] Step 5: Email address filled.');

    // 6. Fill in the password
    console.log('[DEBUG] Step 6: Filling in the password...');
    const passwordInput = page.getByTestId('password-input');
    await expect(passwordInput, 'The password input should be visible').toBeVisible();
    await passwordInput.fill(TEST_USER_FREE.password);
    await page.screenshot({ path: 'debug-06-password-filled.png' });
    console.log('[DEBUG] Step 6: Password filled.');

    // 7. Click the "Sign In" button
    console.log('[DEBUG] Step 7: Clicking the "Sign In" button...');
    const signInButton = page.getByTestId('sign-in-submit');
    await expect(signInButton, 'The "Sign In" button should be visible').toBeVisible();
    await signInButton.click();
    await page.screenshot({ path: 'debug-07-after-signin-click.png' });
    console.log('[DEBUG] Step 7: "Sign In" button clicked.');

    // 8. Wait for redirection to homepage
    console.log('[DEBUG] Step 8: Waiting for redirection to homepage...');
    await page.waitForURL('/');
    await page.screenshot({ path: 'debug-08-redirected-to-home.png' });
    console.log('[DEBUG] Step 8: Successfully redirected to homepage.');

    // Final assertion to confirm success
    await expect(page).toHaveTitle(/SpeakSharp/);
  });
});