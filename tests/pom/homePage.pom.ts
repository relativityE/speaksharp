import { Page, Locator, expect } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly startBasicSessionButton: Locator;
  readonly upgradeButton: Locator;
  readonly upgradePrompt: Locator;

  constructor(page: Page) {
    this.page = page;
    this.startBasicSessionButton = page.getByTestId('start-basic-session-button');
    this.upgradeButton = page.getByRole('button', { name: /Upgrade/i });
    this.upgradePrompt = page.getByText('Upgrade to unlock more features');
  }

  async goto() {
    await this.page.goto('/');
    await expect(this.startBasicSessionButton).toBeVisible({ timeout: 15000 });
  }

  async startBasicSession() {
    await this.startBasicSessionButton.click();
  }

  async assertOnHomePage() {
    await expect(this.page).toHaveURL('/');
  }

  async assertNotUpgradeButton() {
    await expect(this.upgradeButton).toBeHidden();
  }

  async assertUpgradePromptIsVisible() {
    await expect(this.upgradePrompt).toBeVisible();
  }

  async startSession() {
    await this.page.getByRole('button', { name: /Start Session/ }).click();
  }
}
