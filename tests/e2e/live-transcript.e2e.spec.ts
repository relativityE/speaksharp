import { test, expect, MockUser, loginAndWait, programmaticLogin } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { mockAudioStream } from './mockMedia';
import { stubThirdParties } from './sdkStubs';

test.describe('Live Transcript', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page, context }) => {
    await test.step('Grant microphone permissions', async () => {
      await context.grantPermissions(['microphone']);
    });

    // Stub out third-party services.
    await stubThirdParties(page);

    await test.step('Programmatically log in as a free user', async () => {
      const mockUser: MockUser = {
        id: 'mock-user-id',
        email: 'free-user@test.com',
        subscription_status: 'free',
      };
      await loginAndWait(page, mockUser);
    });

    sessionPage = new SessionPage(page);
    await sessionPage.goto();
  });

  test('should display a live transcript during a session', async ({ page }) => {
    await test.step('Start a session and provide mock audio', async () => {
      await sessionPage.startSession();
      await mockAudioStream(page);
    });

    await test.step('Verify that transcript text is visible', async () => {
      await expect(sessionPage.transcriptPanel).toBeVisible();
      // Wait for the text to contain some expected content from the mock audio.
      await expect(sessionPage.transcriptPanel).toContainText('This is a test of the emergency broadcast system', { timeout: 10000 });
    });

    await test.step('Stop the session', async () => {
      await sessionPage.stopSession();
    });

    await test.step('Verify that the transcript container is no longer visible', async () => {
      await expect(sessionPage.transcriptPanel).not.toBeVisible();
    });
  });
});