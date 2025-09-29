import { test, expect } from '../setup/verifyOnlyStepTracker';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';
import { SessionPage } from './poms/sessionPage.pom';
import { mockAudioStream } from './mockMedia';

test.describe('Live Transcript', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page, context }) => {
    // Grant microphone permissions for the test
    await context.grantPermissions(['microphone']);
    // Log in as a free user
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);
    sessionPage = new SessionPage(page);
    await sessionPage.goto();
  });

  test('should display a live transcript during a session', async ({ page }) => {
    // Start a session and mock the audio stream
    await sessionPage.startSession();
    await mockAudioStream(page);

    // Assert that the transcript text is visible and contains expected words
    const transcriptLocator = sessionPage.transcriptPanel;
    await expect(transcriptLocator).toContainText('hello', { timeout: 15000 });
    await expect(transcriptLocator).toContainText('world', { timeout: 15000 });

    // Stop the session
    await sessionPage.stopSession();
  });
});