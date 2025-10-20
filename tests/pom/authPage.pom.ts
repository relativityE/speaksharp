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
    await this.page.goto('/auth');
    await expect(this.loginButton).toBeVisible({ timeout: 15000 });
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
    await expect(this.errorMessage).toBeVisible({ timeout: 10000 });
    await expect(this.errorMessage).toContainText(/user already registered/i);
  }

  async waitForPostAuth() {
    const navElement = this.page.locator('nav');
    await expect(navElement).toBeVisible({ timeout: 15000 });
    const startSpeakingButton = this.page.getByTestId('start-speaking-button');
    await expect(startSpeakingButton).toBeVisible({ timeout: 15000 });
  }
}
