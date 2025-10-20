import { Page, expect } from '@playwright/test';

export class AnalyticsPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/analytics');
    await expect(this.heading).toBeVisible({ timeout: 15000 });
  }

  get heading() {
    return this.page.getByTestId('dashboard-heading');
  }

  get upgradeBanner() {
    return this.page.getByTestId('analytics-page-upgrade-button');
  }
}
