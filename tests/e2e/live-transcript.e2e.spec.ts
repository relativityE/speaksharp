import { test, expect } from '@playwright/test';
import { SessionPage } from '../pom';
import { programmaticLogin } from './helpers';

test.describe('Live Transcript Feature', () => {
  test.skip('should display live transcript after session starts', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await programmaticLogin(page);

    const sessionPage = new SessionPage(page);
    await sessionPage.navigate();

    await sessionPage.startButton.click();

    // Verify that the UI updates to show the session is active using a robust data-testid.
    const sessionActiveIndicator = page.getByTestId('session-status-indicator');
    await expect(sessionActiveIndicator).toHaveText('READY');

    // The transcript container should show that we're listening
    const transcriptContainer = page.getByTestId('transcript-container');
    await expect(transcriptContainer).toContainText('Listening...');

    // Give the transcription service time to fully initialize
    // The MockSpeechRecognition instance is created asynchronously
    await page.waitForTimeout(2000);

    // Simulate live transcription using the E2E bridge
    const dispatchResult = await page.evaluate(() => {
      // @ts-ignore - dispatchMockTranscript is added by e2e-bridge
      if (!window.dispatchMockTranscript) {
        return { error: 'dispatchMockTranscript not found' };
      }
      // @ts-ignore
      if (!window.__activeSpeechRecognition) {
        return { error: '__activeSpeechRecognition not found' };
      }
      // @ts-ignore - Dispatch as interim (isFinal: false) so it appears immediately
      window.dispatchMockTranscript('Hello from E2E test', false);
      return { success: true };
    });

    if ('error' in dispatchResult) {
      throw new Error(`Failed to dispatch mock transcript: ${dispatchResult.error}`);
    }

    // Verify that the transcribed text appears in the container
    await expect(transcriptContainer).toContainText('Hello from E2E test', { timeout: 10000 });
  });
});
