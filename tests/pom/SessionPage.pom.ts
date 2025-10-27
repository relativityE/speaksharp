import { Page, expect } from '@playwright/test';

export class SessionPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/session');
    // First, wait for the main sidebar container to be visible. This confirms that
    // the auth hook has completed and the main page content has rendered,
    // elegantly handling the race condition.
    await expect(this.page.getByTestId('session-sidebar')).toBeVisible();
    // Once the sidebar is present, we can safely assert that our button is visible.
    await expect(this.startButton).toBeVisible();
  }

  get startButton() {
    // Corrected selector to be more specific and robust
    return this.page.getByTestId('session-start-stop-button');
  }
}
