import { Page, Locator, expect } from '@playwright/test';

export class AuthPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signUpButton: Locator;
  readonly loginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.signUpButton = page.getByRole('button', { name: 'Sign Up' });
    this.loginButton = page.getByRole('button', { name: 'Log In' });
  }

  async goto() {
    await this.page.goto('/auth');
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
    await this.waitForPostAuth();
  }

  async assertUserExistsError() {
    await expect(this.page.getByText('User already exists')).toBeVisible();
  }

  /**
   * Waits for the page to stabilize after login/sign-up.
   * Ensures the "Sign Out" button and the home page stable elements are visible.
   */
  async waitForPostAuth() {
    // Wait for the "Sign Out" button
    await expect(this.page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 15000 });

    // Wait for a known stable element on the home page
    const homePageStartButton = this.page.getByTestId('start-free-session-button');
    await expect(homePageStartButton).toBeVisible({ timeout: 15000 });
  }
}
