// tests/e2e.spec.ts - REFACTORED + DEBUG PATCH
import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Anonymous User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await stubThirdParties(page);
  });

  test('an anonymous user can complete a session and see their analytics', async ({ page }) => {
    await page.goto('/');

    // 🔍 DEBUG HOOK — see what page is showing before we click Start
    console.log('DEBUG: Current URL before click:', page.url());
    console.log('DEBUG: Page Title before click:', await page.title());
    await page.screenshot({ path: 'pre-click.png', fullPage: true });

    await page.getByRole('button', { name: /Start For Free/i }).click();
    await page.waitForURL('/session');

    await page.getByRole('button', { name: /Start Session/i }).click();

    await page.waitForFunction(() => {
      return window.__TRANSCRIPTION_READY__ === true &&
             window.transcriptionServiceRef?.current !== null;
    }, { timeout: 20000 });

    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Stop Session/i }).click();
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();

    const transcriptText = await page.locator('[data-testid="transcript-panel"]').innerText();
    expect(transcriptText).toContain('This is a mock transcript.');

    await page.getByRole('button', { name: 'Go to Analytics' }).click();
    await page.waitForURL(/.*\/analytics\/.*/);

    const analyticsTranscriptText = await page.locator('[data-testid="transcript-panel-analytics"]').innerText();
    expect(analyticsTranscriptText).toContain('This is a mock transcript.');
  });

  test('a user can save a session and see the correct analytics data', async ({ page }) => {
    await page.goto('/');

    // 🔍 DEBUG HOOK — second test as well
    console.log('DEBUG: Current URL before click:', page.url());
    console.log('DEBUG: Page Title before click:', await page.title());
    await page.screenshot({ path: 'pre-click-save.png', fullPage: true });

    await page.getByRole('button', { name: /Start For Free/i }).click();
    await page.waitForURL('/session');
    await page.getByRole('button', { name: /Start Session/i }).click();

    await page.waitForFunction(() => window.__TRANSCRIPTION_READY__ === true, { timeout: 20000 });
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Stop Session/i }).click();
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();

    await page.getByRole('button', { name: 'Go to Analytics' }).click();
    await page.waitForURL(/.*\/analytics\/.*/);

    const errorToast = page.locator('text=Could not save the session');
    await expect(errorToast).not.toBeVisible();

    const avgFillerWords = await page.locator('[data-testid="avg-filler-words-min"]').innerText();
    const totalPracticeTime = await page.locator('[data-testid="total-practice-time"]').innerText();
    const avgAccuracy = await page.locator('[data-testid="avg-accuracy"]').innerText();

    expect(avgFillerWords).not.toBe('0.0');
    expect(totalPracticeTime).not.toBe('0 mins');
    expect(avgAccuracy).not.toBe('0.0%');
  });
});
