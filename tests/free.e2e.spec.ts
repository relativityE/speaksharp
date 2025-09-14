import { test, expect, Page, Response } from './helpers';
import { stubThirdParties } from './sdkStubs';

test.describe('Free User Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Sandbox: start with blank page
    await page.goto('about:blank');

    // Stub external services
    await stubThirdParties(page);

    // Monitor failing requests for debugging
    page.on('requestfailed', (r) =>
      console.log(`[REQUEST FAILED] ${r.url()}: ${r.failure()?.errorText}`)
    );
    page.on('response', (r) => {
      if (r.status() >= 400) console.log(`[HTTP ERROR] ${r.status()} ${r.url()}`);
    });

    // Safe maximum setup time
    test.setTimeout(15000);
  });

  // Login helper with safe waits and error handling
  async function loginUser(page: Page, email: string, password: string) {
    console.log(`Logging in: ${email}`);

    await page.goto('/auth', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const emailField = page.getByLabel('Email');
    const passwordField = page.getByLabel('Password');
    const signInButton = page.getByRole('button', { name: 'Sign In' });

    await expect(emailField).toBeVisible();
    await expect(passwordField).toBeVisible();
    await expect(signInButton).toBeVisible();

    await emailField.fill(email);
    await passwordField.fill(password);

    await expect(signInButton).toBeEnabled();

    const responsePromise = page.waitForResponse(
      (res: Response) => res.url().includes('/auth') || res.url().includes('/login'),
      { timeout: 10000 }
    );

    await signInButton.click();
    try { await responsePromise; } catch { console.log('No auth response, continuing...'); }

    try {
      await page.waitForURL('/', { timeout: 15000 });
      console.log('Redirected to home page');
    } catch (err) {
      console.log('Login redirect failed:', page.url());
      await page.screenshot({ path: `debug-login-${email.replace('@', '-')}.png` });
      throw err;
    }

    await page.waitForLoadState('networkidle');
  }

  test('free user sees upgrade prompt', async ({ page }) => {
    test.setTimeout(60000);
    await loginUser(page, 'free@example.com', 'password');

    await page.goto('/session', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    try {
      await expect(upgradeButton).toBeVisible({ timeout: 10000 });
    } catch {
      const altButton = page.locator('button:has-text("Upgrade")');
      await expect(altButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('pro user does not see upgrade prompt', async ({ page }) => {
    test.setTimeout(60000);
    await loginUser(page, 'pro@example.com', 'password');

    await page.goto('/session', { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    await expect(upgradeButton).not.toBeVisible();

    const upgradeButtons = page.locator('button:has-text("Upgrade")');
    await expect(upgradeButtons).toHaveCount(0);
  });
});

// Configure retries and global timeout
test.describe.configure({
  timeout: 60000,
  retries: 1,
});
