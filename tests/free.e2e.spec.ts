import { test, expect, Page, Response } from './helpers';
import { stubThirdParties } from './sdkStubs';

test.describe('Free User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank', { timeout: 5000 }); // sandbox-safe
    await stubThirdParties(page); // stub third parties
  });

  // Safe login helper
  async function loginUser(page: Page, email: string, password: string) {
    console.log(`Logging in: ${email}`);

    // Navigation with hard timeout
    await page.goto('/auth', { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    const emailField = page.getByTestId('email-input');
    const passwordField = page.getByTestId('password-input');
    const signInButton = page.getByTestId('sign-in-submit');

    await expect(emailField).toBeVisible({ timeout: 5000 });
    await expect(passwordField).toBeVisible({ timeout: 5000 });
    await expect(signInButton).toBeVisible({ timeout: 5000 });

    await emailField.fill(email);
    await passwordField.fill(password);
    await expect(signInButton).toBeEnabled({ timeout: 5000 });

    // Wrap in catch so it never hangs forever
    const responsePromise = page.waitForResponse(
      (res: Response) => res.url().includes('/auth') || res.url().includes('/login'),
      { timeout: 10000 }
    ).catch(() => null);

    await signInButton.click();

    await responsePromise;

    // Fail fast if redirect never happens
    try {
      await page.waitForURL('/', { timeout: 15000 });
      console.log('Redirected to home page');
    } catch (error) {
      console.log('Login redirect failed. Current URL:', page.url());
      await page.screenshot({ path: `debug-login-${email.replace('@', '-')}.png` });
      throw error;
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 });
  }

  test('a free user sees the upgrade prompt', async ({ page }) => {
    await loginUser(page, 'free@example.com', 'password');

    try {
      await page.goto('/session', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (error) {
      console.log('Failed to navigate to /session', error);
      await page.screenshot({ path: 'debug-session-page.png' });
      throw error;
    }

    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    try {
      await expect(upgradeButton).toBeVisible({ timeout: 10000 });
    } catch {
      const altButton = page.locator('button:has-text("Upgrade")');
      await expect(altButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('a pro user does not see the upgrade prompt', async ({ page }) => {
    await loginUser(page, 'pro@example.com', 'password');

    await page.goto('/session', { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    await expect(upgradeButton).not.toBeVisible({ timeout: 5000 });

    const upgradeButtons = page.locator('button:has-text("Upgrade")');
    await expect(upgradeButtons).toHaveCount(0, { timeout: 5000 });
  });
});

// Suite-wide fallback timeout (safety net)
test.describe.configure({
  timeout: 60000,
  retries: 1,
});
