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
      // The form defaults to Sign In, so we do NOT toggle.
      await this.emailInput.fill(email, { timeout: 2000 });
      await this.passwordInput.fill(password_val, { timeout: 2000 });
      await expect(this.signInButton).toBeEnabled({ timeout: 3000 });
      await this.signInButton.click({ timeout: 2000 });
      // Wait for navigation to complete after login, indicating success
      await this.page.waitForURL(/\/(?!auth)/, { timeout: 10000 });
    } catch (err) {
      console.error('[AUTH POM] Login failed', err);
      throw err;
    }
  }

  async signUp(email: string, password_val: string) {
    try {
      console.log('[AUTH POM] Toggling to Sign Up form');
      // The form defaults to Sign In, so we must toggle to Sign Up.
      await this.modeToggleButton.click({ timeout: 2000 });
      console.log(`[AUTH POM] Signing up with ${email}`);
      await this.emailInput.fill(email, { timeout: 2000 });
      await this.passwordInput.fill(password_val, { timeout: 2000 });
      await expect(this.signUpButton).toBeEnabled({ timeout: 3000 });
      await this.signUpButton.click({ timeout: 2000 });
    } catch (err) {
      console.error('[AUTH POM] Sign-up failed', err);
      throw err;
    }
  }

  async assertUserExistsError() {
    try {
      await expect(this.page.getByText(/User already registered/i)).toBeVisible({ timeout: 2000 });
    } catch (err) {
      console.error('[AUTH POM] User exists error not found', err);
      throw err;
    }
  }
}