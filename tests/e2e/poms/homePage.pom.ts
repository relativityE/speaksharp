import { Page, Locator } from '@playwright/test';

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
}
