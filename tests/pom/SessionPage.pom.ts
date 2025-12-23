import { Page, expect } from '@playwright/test';
import { navigateToRoute } from '../e2e/helpers';

export class SessionPage {
  constructor(private page: Page) { }

  /**
   * Navigate to the session page using client-side React Router navigation.
   * 
   * ⚠️ IMPORTANT: This POM is designed for use AFTER programmaticLogin().
   * Using page.goto() here would destroy the MSW mock context.
   * See: docs/ARCHITECTURE.md#e2e-anti-pattern
   */
  async navigate() {
    console.log('[DEBUG] SessionPage.pom: Using client-side navigation to /session');
    await navigateToRoute(this.page, '/session');
    // Wait directly for the functional element, the start/stop button. This button
    // exists in both the desktop sidebar and the mobile drawer, making the check
    // viewport-agnostic and resilient to responsive design changes. This also
    // implicitly confirms that the page is loaded and ready for interaction.
    console.log('[DEBUG] SessionPage.pom: Waiting for startButton visible');
    await expect(this.startButton).toBeVisible({ timeout: 15000 });
    console.log('[DEBUG] SessionPage.pom: startButton is visible');
  }

  get startButton() {
    // Corrected selector to be more specific and robust
    return this.page.getByTestId('session-start-stop-button');
  }
}

