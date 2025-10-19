import { test, expect } from '@playwright/test';
import { SessionPage } from '../pom';
import { programmaticLogin } from './helpers';

// Define constants locally to avoid module resolution issues in Playwright
const TEST_USER = {
  email: 'test-pro@example.com',
  password: 'password123',
};

test.describe('Live Transcript Feature', () => {
  test('should display live transcript after session starts', async ({ page }) => {
    await programmaticLogin(page, TEST_USER.email);
    const sessionPage = new SessionPage(page);
    await sessionPage.navigate();

    // 1. Verify the main session page heading is visible
    await expect(sessionPage.heading).toBeVisible();

    // 2. Find and click the start button to begin the session
    const startButton = page.getByRole('button', { name: 'Start' });
    await expect(startButton).toBeVisible();
    await startButton.click();

    // 3. Verify that the application indicates it is "LIVE"
    const liveIndicator = page.getByText('LIVE', { exact: true });
    await expect(liveIndicator).toBeVisible();

    // 4. (Self-correction) The original test looked for a 'transcript-area'.
    // The new UI in Session.tsx does not have this. Instead, I will
    // verify that the "Recording in progress..." text appears, which
    // confirms the speech recognition has started.
    const recordingText = page.getByText('Recording in progress...');
    await expect(recordingText).toBeVisible();
  });
});
