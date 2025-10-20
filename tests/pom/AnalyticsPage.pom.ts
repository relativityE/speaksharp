import type { Page } from '@playwright/test';

export class AnalyticsPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/analytics');  // ✅ FIXED: Correct route
    await this.page.waitForLoadState('domcontentloaded');  // ✅ FIXED: More reliable

    // Wait for heading to confirm page loaded
    await this.page.waitForSelector('[data-testid="dashboard-heading"]', { timeout: 10000 });
  }

  get heading() {
    return this.page.getByTestId('dashboard-heading');
  }

  get upgradeBanner() {
    return this.page.getByTestId('analytics-page-upgrade-button');
  }
}
