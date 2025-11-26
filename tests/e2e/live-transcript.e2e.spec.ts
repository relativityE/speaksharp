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

    // The transcript panel should also show that recording is in progress.
    const recordingText = page.getByTestId('transcript-display');
    await expect(recordingText).toBeVisible();
    await expect(recordingText).toContainText('Recording in progress...');


    // Get the transcript container
    const transcriptContainer = page.getByTestId('transcript-container');

    // Simulate live transcription using the E2E bridge
    await page.evaluate(() => {
      // @ts-ignore - dispatchMockTranscript is added by e2e-bridge
      if (window.dispatchMockTranscript) {
        // @ts-ignore - Dispatch as interim (isFinal: false) so it appears immediately
        window.dispatchMockTranscript('Hello from E2E test', false);
      } else {
        throw new Error('dispatchMockTranscript not found on window object. Is e2e-bridge loaded?');
      }
    });

    // Wait for React state update
    await page.waitForTimeout(1000);

    // Verify that the transcribed text appears in the container
    await expect(transcriptContainer).toContainText('Hello from E2E test');
  });
});
