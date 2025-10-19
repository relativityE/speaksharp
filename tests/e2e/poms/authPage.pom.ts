import { Page, Locator, expect } from '@playwright/test';

export class AuthPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signUpButton: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.signUpButton = page.getByRole('button', { name: 'Sign Up' });
    this.loginButton = page.getByRole('button', { name: 'Log In' });
    this.errorMessage = page.locator('[data-testid="auth-error-message"]');
  }

  async goto() {
    await this.page.goto('/auth', { waitUntil: 'domcontentloaded' });
  }

  async signUp(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signUpButton.click();
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async assertUserExistsError() {
    // Make the assertion more flexible and robust.
    // It should check for any text containing "User already registered".
    await expect(this.errorMessage).toBeVisible({ timeout: 10000 });
    await expect(this.errorMessage).toContainText(/user already registered/i);
  }

  /**
   * Waits for the page to stabilize after login/sign-up.
   * Ensures the main navigation and a stable home page element are visible.
   */
  async waitForPostAuth() {
    // Wait for the main navigation to be rendered, which is a good indicator of being logged in.
    const navElement = this.page.locator('nav');
    await expect(navElement).toBeVisible({ timeout: 15000 });

    // Wait for the correct stable element on the logged-in home page.
    const startSpeakingButton = this.page.getByTestId('start-speaking-button');
    await expect(startSpeakingButton).toBeVisible({ timeout: 15000 });
  }
}
