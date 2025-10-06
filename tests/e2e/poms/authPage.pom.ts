import { Page, Locator, expect } from '@playwright/test';

export class AuthPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly signUpButton: Locator;
  readonly modeToggleButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('email-input');
    this.passwordInput = page.getByTestId('password-input');
    this.signInButton = page.getByTestId('sign-in-submit');
    this.signUpButton = page.getByTestId('sign-up-submit');
    this.modeToggleButton = page.getByTestId('mode-toggle');
  }

  async goto() {
    try {
      console.log('[AUTH POM] Navigating to /auth');
      await this.page.goto('/auth', { timeout: 5000 });
      await expect(this.emailInput).toBeVisible({ timeout: 3000 });
    } catch (err) {
      console.error('[AUTH POM] Failed to navigate to /auth or email input not visible', err);
      throw err;
    }
  }

  async login(email: string, password_val: string) {
    try {
      console.log(`[AUTH POM] Logging in with ${email}`);
      await this.emailInput.fill(email, { timeout: 2000 });
      await this.passwordInput.fill(password_val, { timeout: 2000 });
      await this.signInButton.click({ timeout: 2000 });
      // Wait for the URL to change to the app, indicating successful login.
      await this.page.waitForURL(/\/app/, { timeout: 5000 });
      // Also wait for the main content area to be visible.
      await expect(this.page.locator('main')).toBeVisible({ timeout: 3000 });
    } catch (err) {
      console.error('[AUTH POM] Login failed', err);
      await this.page.screenshot({ path: `test-results/debug/login-failed.png` });
      throw err;
    }
  }

  async signUp(email: string, password_val: string) {
    try {
      console.log(`[AUTH POM] Signing up with ${email}`);
      await this.modeToggleButton.click({ timeout: 2000 });
      await this.emailInput.fill(email, { timeout: 2000 });
      await this.passwordInput.fill(password_val, { timeout: 2000 });
      await this.signUpButton.click({ timeout: 2000 });
      // Wait for the URL to change to the app, indicating successful sign-up.
      await this.page.waitForURL(/\/app/, { timeout: 5000 });
      // Also wait for the main content area to be visible.
      await expect(this.page.locator('main')).toBeVisible({ timeout: 3000 });
    } catch (err) {
      console.error('[AUTH POM] Sign-up failed', err);
      await this.page.screenshot({ path: `test-results/debug/signup-failed.png` });
      throw err;
    }
  }

  async assertUserExistsError() {
    const errorLocator = this.page.getByText(/An account with this email already exists/i);
    try {
      await errorLocator.waitFor({ state: 'visible', timeout: 3000 });
      await expect(errorLocator).toBeVisible();
    } catch (err) {
      console.error('[AUTH POM] User exists error not found', err);
      // Capture a screenshot for debugging if the element is not found.
      await this.page.screenshot({ path: `test-results/debug/user-exists-error-not-found.png` });
      throw err;
    }
  }
}