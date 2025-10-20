// tests/pom/SessionPage.pom.ts
import type { Page } from '@playwright/test';

export class SessionPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/session');
    await this.page.waitForLoadState('domcontentloaded');
  }

  get startButton() {
    return this.page.getByRole('button', { name: /start/i });
  }
}
