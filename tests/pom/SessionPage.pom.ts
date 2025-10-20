import { Page, expect } from '@playwright/test';

export class SessionPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/session');
    await expect(this.startButton).toBeVisible({ timeout: 15000 });
  }

  get startButton() {
    return this.page.getByRole('button', { name: /start/i });
  }
}
