// tests/e2e/live-transcript.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin, MockUser } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { mockAudioStream } from './mockMedia';
import { stubThirdParties } from './sdkStubs';

// Define a mock user for this test suite.
const transcriptUser: MockUser = {
  id: 'user-id-transcript',
  email: 'transcript-user@example.com',
  subscription_status: 'free',
};

test.describe('Live Transcript', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page, context }) => {
    await test.step('Grant microphone permissions', async () => {
      await context.grantPermissions(['microphone']);
    });

    // Stub out third-party services.
    await stubThirdParties(page);

    await test.step('Programmatically log in as a free user', async () => {
      await programmaticLogin(page, transcriptUser);
    });

    sessionPage = new SessionPage(page);
  });

  test('should display a live transcript during a session', async () => {
    await test.step('Start session and mock audio stream', async () => {
      await sessionPage.startSession();
      await mockAudioStream();
    });

    await test.step('Assert that transcript contains expected text', async () => {
      const transcriptLocator = sessionPage.transcriptPanel;
      await expect(transcriptLocator).toContainText('hello', { timeout: 15000 });
      await expect(transcriptLocator).toContainText('world', { timeout: 15000 });
    });

    await test.step('Stop the session', async () => {
      await sessionPage.stopSession();
    });
  });
});