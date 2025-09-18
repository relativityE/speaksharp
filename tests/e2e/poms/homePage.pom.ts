import { Page, Locator, expect } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly startFreeSessionButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.startFreeSessionButton = page.getByTestId('start-free-session-button');
  }

  async goto() {
    await this.page.goto('/');
  }

  async startFreeSession() {
    await this.startFreeSessionButton.click();
  }

  async assertOnHomePage() {
    await expect(this.page).toHaveURL('/');
  }

  async assertNotUpgradeButton() {
    await expect(this.page.getByRole('button', { name: /Upgrade/ })).toBeHidden();
  }

  async startSession() {
    await this.page.getByRole('button', { name: /Start Session/ }).click();
  }
}
