import { Page, expect } from '@playwright/test';

export class SessionPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/session');
    await expect(this.startButton).toBeVisible({ timeout: 15000 });
  }

  get startButton() {
    // Corrected selector to be more specific and robust
    return this.page.getByTestId('session-start-stop-button');
  }
}
