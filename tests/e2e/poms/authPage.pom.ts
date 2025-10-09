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
      console.log('[AUTH POM] Navigating to /auth...');
      await this.page.goto('/auth', { timeout: 10000 });
      await this.waitForMSWReady();
      await expect(this.emailInput).toBeVisible({ timeout: 5000 });
      console.log('[AUTH POM] /auth page loaded and ready ✅');
    } catch (err) {
      await this.dumpDiagnostics('goto() failure');
      console.error('[AUTH POM] Failed to navigate to /auth', err);
      throw err;
    }
  }

  async waitForMSWReady(timeout = 15000) {
    await this.page.waitForFunction(() => window.mswReady, { timeout }).catch(async (err) => {
        await this.dumpDiagnostics('MSW readiness timeout');
        throw new Error(`[AUTH POM] MSW never became ready: ${err.message}`);
    });
    console.log('[AUTH POM] MSW ready detected ✅');
  }

  async login(email: string, password_val: string) {
    try {
      console.log(`[AUTH POM] Logging in with ${email}`);
      await this.emailInput.fill(email, { timeout: 3000 });
      await this.passwordInput.fill(password_val, { timeout: 3000 });
      await this.signInButton.click({ timeout: 3000 });
    } catch (err) {
      await this.dumpDiagnostics('login() failure');
      console.error('[AUTH POM] Login failed', err);
      throw err;
    }
  }

  async signUp(email: string, password_val: string) {
    try {
      console.log(`[AUTH POM] Signing up with ${email}`);
      await this.modeToggleButton.click({ timeout: 3000 });
      await this.emailInput.fill(email, { timeout: 2000 });
      await this.passwordInput.fill(password_val, { timeout: 2000 });
      await this.signUpButton.click({ timeout: 2000 });
    } catch (err) {
      await this.dumpDiagnostics('signUp() failure');
      console.error('[AUTH POM] Sign-up failed', err);
      throw err;
    }
  }

  async assertUserExistsError() {
    try {
      await expect(
        this.page.getByText(/An account with this email already exists/i)
      ).toBeVisible({ timeout: 4000 });
    } catch (err) {
      await this.dumpDiagnostics('assertUserExistsError() failure');
      console.error('[AUTH POM] User exists error not found', err);
      throw err;
    }
  }

  async dumpDiagnostics(context: string) {
    try {
      const url = this.page.url();
      const title = await this.page.title().catch(() => 'unknown');
      const htmlSnippet = (await this.page.content()).slice(0, 500);
      const viteMode = await this.page
        .locator('[data-testid="vite-mode"]')
        .textContent()
        .catch(() => 'not found');
      console.log(`\n[AUTH DIAGNOSTICS] ${context}`);
      console.log(`  URL: ${url}`);
      console.log(`  TITLE: ${title}`);
      console.log(`  VITE MODE: ${viteMode}`);
      console.log(`  DOM SNIPPET:\n${htmlSnippet}\n`);
    } catch (innerErr) {
      console.error('[AUTH POM] Failed to dump diagnostics', innerErr);
    }
  }
}