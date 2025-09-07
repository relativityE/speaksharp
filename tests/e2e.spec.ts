// tests/e2e.spec.ts - REFACTORED
import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Anonymous User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await stubThirdParties(page);
  });

  test('an anonymous user can complete a session and see their analytics', async ({ page }) => {
    await page.goto('/');

    // From the landing page, start a session
    await page.getByRole('button', { name: /Start For Free/i }).click();
    await page.waitForURL('/session');

    // Start a short session
    await page.getByRole('button', { name: /Start Session/i }).click();

    // Wait for the transcription service to be fully ready using the new E2E flag
    await page.waitForFunction(() => {
      return window.__TRANSCRIPTION_READY__ === true &&
             window.transcriptionServiceRef?.current !== null;
    }, { timeout: 20000 });

    // Optional: Add a small delay to ensure full initialization
    await page.waitForTimeout(500);

    // Now, stop the session
    await page.getByRole('button', { name: /Stop Session/i }).click();

    // Expect to see the session ended dialog
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();

    // The transcript from the session should be present
    const transcriptText = await page.locator('[data-testid="transcript-panel"]').innerText();
    expect(transcriptText).toContain('This is a mock transcript.');

    // Go to the analytics page
    await page.getByRole('button', { name: 'Go to Analytics' }).click();
    await page.waitForURL(/.*\/analytics\/.*/);

    // The analytics page should also show the same transcript
    const analyticsTranscriptText = await page.locator('[data-testid="transcript-panel-analytics"]').innerText();
    expect(analyticsTranscriptText).toContain('This is a mock transcript.');
  });

  test('a user can save a session and see the correct analytics data', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Start For Free/i }).click();
    await page.waitForURL('/session');
    await page.getByRole('button', { name: /Start Session/i }).click();

    // Wait for the service to be ready
    await page.waitForFunction(() => window.__TRANSCRIPTION_READY__ === true, { timeout: 20000 });
    await page.waitForTimeout(500);

    // Stop the session
    await page.getByRole('button', { name: /Stop Session/i }).click();
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();

    // Click "Go to Analytics"
    await page.getByRole('button', { name: 'Go to Analytics' }).click();
    await page.waitForURL(/.*\/analytics\/.*/);

    // Assert that the error toast is NOT visible
    const errorToast = page.locator('text=Could not save the session');
    await expect(errorToast).not.toBeVisible();

    // Assert that the analytics data is present and non-zero
    const avgFillerWords = await page.locator('[data-testid="avg-filler-words-min"]').innerText();
    const totalPracticeTime = await page.locator('[data-testid="total-practice-time"]').innerText();
    const avgAccuracy = await page.locator('[data-testid="avg-accuracy"]').innerText();

    expect(avgFillerWords).not.toBe('0.0');
    expect(totalPracticeTime).not.toBe('0 mins');
    expect(avgAccuracy).not.toBe('0.0%');
  });
});
