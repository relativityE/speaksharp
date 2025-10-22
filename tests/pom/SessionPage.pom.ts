import { Page } from '@playwright/test';

export class SessionPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/session');
  }

  get startButton() {
    return this.page.getByRole('button', { name: /start/i });
  }
}
