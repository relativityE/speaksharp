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
    try {
      console.log('[SESSION POM] Navigating to /session...');
      await this.page.goto('/session', { timeout: 10000 });
      await expect(
        this.page.getByRole('heading', { name: 'Practice Session' })
      ).toBeVisible({ timeout: 5000 });
      console.log('[SESSION POM] /session page ready ✅');
    } catch (err) {
      await this.dumpDiagnostics('goto() failure');
      console.error('[SESSION POM] Failed to navigate to /session', err);
      throw err;
    }
  }

  async assertOnSessionPage() {
    try {
      await expect(
        this.page.getByRole('heading', { name: 'Practice Session' })
      ).toBeVisible({ timeout: 4000 });
    } catch (err) {
      await this.dumpDiagnostics('assertOnSessionPage() failure');
      console.error('[SESSION POM] Not on session page', err);
      throw err;
    }
  }

  async startSession() {
    console.log('[SESSION POM] Starting session');
    await this.startButton.click({ timeout: 3000 });
  }

  async stopSession() {
    console.log('[SESSION POM] Stopping session');
    await this.stopButton.click({ timeout: 3000 });
  }

  async assertSessionIsActive() {
    await expect(this.page.getByText('LIVE')).toBeVisible({ timeout: 4000 });
  }

  async assertSessionIsStopped() {
    await expect(this.page.getByText('READY')).toBeVisible({ timeout: 4000 });
  }

  async dumpDiagnostics(context: string) {
    try {
      const url = this.page.url();
      const htmlSnippet = (await this.page.content()).slice(0, 500);
      console.log(`\n[SESSION DIAGNOSTICS] ${context}`);
      console.log(`  URL: ${url}`);
      console.log(`  DOM SNIPPET:\n${htmlSnippet}\n`);
    } catch (innerErr) {
      console.error('[SESSION POM] Failed to dump diagnostics', innerErr);
    }
  }
}