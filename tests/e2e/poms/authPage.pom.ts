import { Page, Locator } from '@playwright/test';

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
    await this.page.goto('/auth');
  }

  async login(email: string, password_val: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password_val);
    await this.signInButton.click();
    await this.page.waitForURL('**/');
  }
}
