import type { Page } from '@playwright/test';

export class SessionPage {
  constructor(public readonly page: Page) {}

  async navigate() {
    await this.page.goto('/session');
  }

  get heading() {
    return this.page.getByTestId('practice-session-heading');
  }
}
