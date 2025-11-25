import { test, expect } from '@playwright/test';
import { SessionPage } from '../pom';
import { programmaticLogin } from './helpers';

test.describe('Live Transcript Feature', () => {
  test('should display live transcript after session starts', async ({ page }) => {
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
  });
});
