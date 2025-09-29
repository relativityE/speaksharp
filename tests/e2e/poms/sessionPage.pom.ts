import { Page, Locator, expect } from '@playwright/test';

export class SessionPage {
  readonly page: Page;
  readonly startButton: Locator;
  readonly stopButton: Locator;
  readonly transcriptPanel: Locator;
  readonly upgradeButton: Locator;
  readonly sidebar: {
    cloudAiMode: Locator;
    onDeviceMode: Locator;
    nativeMode: Locator;
  };

  constructor(page: Page) {
    this.page = page;
    this.startButton = page.getByRole('button', { name: 'Start' });
    this.stopButton = page.getByRole('button', { name: 'Stop' });
    this.transcriptPanel = page.getByTestId('transcript-panel');
    this.upgradeButton = page.getByRole('button', { name: /upgrade/i });
    this.sidebar = {
        cloudAiMode: page.getByRole('menuitemradio', { name: 'Cloud AI' }),
        onDeviceMode: page.getByRole('menuitemradio', { name: 'On-Device' }),
        nativeMode: page.getByRole('menuitemradio', { name: 'Native' }),
    };
  }

  async goto() {
    await this.page.goto('/session');
  }

  async assertOnSessionPage() {
    await expect(this.page).toHaveURL(/.*session/);
    await expect(this.page.getByRole('heading', { name: 'Practice Session' })).toBeVisible();
  }

  async startSession() {
    await this.startButton.click();
  }

  async stopSession() {
    await this.stopButton.click();
  }

  async assertSessionIsActive() {
    await expect(this.page.getByText('LIVE')).toBeVisible();
  }

  async assertSessionIsStopped() {
    await expect(this.page.getByText('READY')).toBeVisible();
  }
}