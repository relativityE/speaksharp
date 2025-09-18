import { Page, Locator, expect } from '@playwright/test';

export class SessionPage {
  readonly page: Page;
  readonly startStopButton: Locator;
  readonly transcriptContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.startStopButton = page.getByTestId('session-start-stop-button');
    this.transcriptContainer = page.getByTestId('transcript-panel');
  }

  async goto() {
    await this.page.goto('/session');
  }

  async verifyOnPage() {
    await expect(this.transcriptContainer).toBeAttached({ timeout: 15000 });
    await expect(this.startStopButton).toBeVisible({ timeout: 10000 });
    await expect(this.transcriptContainer).toBeVisible({ timeout: 10000 });
  }
}
