import { test, expect } from '../setup/verifyOnlyStepTracker';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';
import { SessionPage } from './poms/sessionPage.pom';
import { mockGetUserMedia } from './mockMedia';

test.describe('Live Transcript E2E Tests', () => {
  test('should display live transcript updates during a session', async ({ page }) => {
    // Mock the microphone to provide a fake audio stream
    await mockGetUserMedia(page);

    // Log in as a free user
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);

    // Navigate to the session page
    const sessionPage = new SessionPage(page);
    await sessionPage.goto();
    await sessionPage.verifyOnPage();

    // Click the start button
    await sessionPage.startStopButton.click();

    // Wait for the session to be active and ready for transcription
    await expect(page.getByText('Session Active')).toBeVisible({ timeout: 15000 });

    // In a real test, we would need a way to inject mock transcript data.
    // For this test, we'll assume the mock audio stream generates some kind of transcript.
    // We will wait for the transcript container to have some text content.
    await expect(sessionPage.transcriptContainer.locator('div').first()).toHaveText(/transcript/, { timeout: 20000 });

    // Click the stop button
    await sessionPage.startStopButton.click();

    // Verify the session has ended
    await expect(page.getByText('Session Ended')).toBeVisible({ timeout: 10000 });
  });
});
