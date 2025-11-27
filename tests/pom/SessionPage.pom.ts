import { Page, expect } from '@playwright/test';

export class SessionPage {
  constructor(private page: Page) { }

  async navigate() {
    console.log('[DEBUG] SessionPage.pom: Navigating to /session');
    await this.page.goto('/session');
    // Wait directly for the functional element, the start/stop button. This button
    // exists in both the desktop sidebar and the mobile drawer, making the check
    // viewport-agnostic and resilient to responsive design changes. This also
    // implicitly confirms that the page is loaded and ready for interaction.
    console.log('[DEBUG] SessionPage.pom: Waiting for startButton visible');
    await expect(this.startButton).toBeVisible();
    console.log('[DEBUG] SessionPage.pom: startButton is visible');
  }

  get startButton() {
    // Corrected selector to be more specific and robust
    return this.page.getByTestId('session-start-stop-button');
  }
}
