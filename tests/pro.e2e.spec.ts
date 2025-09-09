import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Premium User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    // Stub all third-party services, specifically forcing on-device mode
    await stubThirdParties(page, { forceOnDevice: true });
  });

  test('a premium user uses the on-device transcription', async ({ page }) => {
    // Log in as a premium user
    await page.goto('/auth');
    await page.getByLabel('Email').fill('premium@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/');

    // Go to the session page
    await page.goto('/session');

    // Mock the LocalWhisper class before starting the session
    await page.evaluate(() => {
      window.__MOCK_LOCAL_WHISPER__ = true;
    });

    // Start a session
    await page.getByRole('button', { name: /Start Session/i }).click();

    // Wait for the transcription service to be ready
    await page.waitForFunction(() => window.__TRANSCRIPTION_READY__ === true, { timeout: 20000 });
    await page.waitForTimeout(500);

    // Stop the session
    await page.getByRole('button', { name: /Stop Session/i }).click();

    // Expect to see the session ended dialog
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();

    // The transcript from the session should be the one from our mock
    const transcriptText = await page.locator('[data-testid="transcript-panel"]').innerText();
    expect(transcriptText).toContain('This is a test transcript from a mocked LocalWhisper.');
  });
});
