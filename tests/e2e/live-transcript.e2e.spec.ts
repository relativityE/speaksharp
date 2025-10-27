import { test, expect } from '@playwright/test';
import { SessionPage } from '../pom';
import { programmaticLogin } from './helpers';

test.describe('Live Transcript Feature', () => {
  test('should display live transcript after session starts', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await programmaticLogin(page);

    const sessionPage = new SessionPage(page);
    await sessionPage.navigate();

    // If the above navigation succeeds, proceed with the rest of the test logic.
    await sessionPage.startButton.click();

    // The mock hook will now correctly simulate the "listening" state.
    // We need to verify that the UI updates to show the session is active.
    const sessionActiveIndicator = page.getByText('Session Active');
    await expect(sessionActiveIndicator).toBeVisible();

    // The transcript panel should also show that recording is in progress.
    const recordingText = page.getByText('Recording in progress...');
    await expect(recordingText).toBeVisible();
  });
});
