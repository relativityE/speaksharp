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
    // Use a more specific locator to avoid ambiguity with other "Start" buttons on the page.
    this.startButton = page.getByTestId('app-main').getByRole('button', { name: 'Start' });
    this.stopButton = page.getByRole('button', { name: 'Stop' });
    this.transcriptPanel = page.getByTestId('transcript-panel');
    this.upgradeButton = page.getByRole('button', { name: /upgrade to pro/i });
    this.sidebar = {
        cloudAiMode: page.getByRole('menuitemradio', { name: 'Cloud AI' }),
        onDeviceMode: page.getByRole('menuitemradio', { name: 'On-Device' }),
        nativeMode: page.getByRole('menuitemradio', { name: 'Native' }),
    };
  }

  async goto() {
    try {
      console.log('[SESSION POM] Navigating to /session');
      await this.page.goto('/session', { timeout: 5000 });
      await expect(this.page.getByRole('heading', { name: 'Practice Session' })).toBeVisible({ timeout: 3000 });
    } catch (err) {
      console.error('[SESSION POM] Failed to navigate or heading not visible', err);
      throw err;
    }
  }

  async assertOnSessionPage() {
    await expect(this.page.getByRole('heading', { name: 'Practice Session' })).toBeVisible({ timeout: 2000 });
  }

  async startSession() {
    console.log('[SESSION POM] Starting session');
    await this.startButton.click({ timeout: 2000 });
  }

  async stopSession() {
    console.log('[SESSION POM] Stopping session');
    await this.stopButton.click({ timeout: 2000 });
  }

  async assertSessionIsActive() {
    await expect(this.page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 2000 });
  }

  async assertSessionIsStopped() {
    await expect(this.page.getByText('READY')).toBeVisible({ timeout: 2000 });
  }
}