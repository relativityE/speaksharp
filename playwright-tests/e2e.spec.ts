import { test, expect } from '@playwright/test';

test.describe('End-to-End Speech Recognition', () => {

  // Increase the timeout for this suite of tests
  test.setTimeout(180000); // 3 minutes

  test.beforeEach(async ({ page }) => {
    // Listen for all console logs and output them to the test runner's console
    page.on('console', msg => {
      const text = msg.text();
      // Filter out verbose and noisy logs to keep the test output clean
      if (
        text.includes('[vite]') ||
        text.includes('Source Map') ||
        text.includes('[HMR]')
      ) {
        return;
      }
      console.log(`[Browser Console] ${text}`);
    });

    // Navigate to the main page of the application
    await page.goto('/');
    // Wait for the main content to be visible, indicating the app has loaded
    await expect(page.getByTestId('app-main')).toBeVisible();
  });

  // Test case for 'native' speech recognition mode
  test('should handle native speech recognition', async ({ page }) => {
    // Wait for the initial mode notification to be visible
    await expect(page.getByText('Native Browser Fallback')).toBeVisible();

    // Find and click the main start/stop button
    const mainButton = page.getByRole('button', { name: /Start Recording/i });
    await mainButton.click();

    // The button text changes to "End Session", and a "RECORDING" status appears
    await expect(page.getByRole('button', { name: /End Session/i })).toBeVisible();
    await expect(page.getByText('● RECORDING')).toBeVisible();

    // Wait for a few seconds to simulate speaking
    await page.waitForTimeout(5000);

    // Click the button again to stop the session
    await page.getByRole('button', { name: /End Session/i }).click();

    // After stopping, we should be redirected to the analytics page
    await expect(page).toHaveURL(/.*\/analytics/);

    // Check for the presence of the transcript panel and a plausible word count
    await expect(page.getByText('Transcript')).toBeVisible();
    const wordCount = await page.getByText(/Total Words: \d+/).textContent();
    const count = parseInt(wordCount?.match(/\d+/)?.[0] || '0', 10);
    // In the fake media stream, the transcript is usually non-empty
    expect(count).toBeGreaterThan(0);
  });

  // Test case for 'local' speech recognition mode (Whisper model)
  test('should handle local speech recognition', async ({ page }) => {
    // Switch to local mode
    // The switch is associated with a label "Transcription Mode"
    const modeSwitch = page.getByLabel('Transcription Mode').locator('..').getByRole('switch');
    await modeSwitch.click();

    // A notification should appear confirming the switch to local mode
    await expect(page.getByText('Local Transcription (Faster, Private)')).toBeVisible();

    // Find and click the main start/stop button
    const mainButton = page.getByRole('button', { name: /Start Recording/i });
    await mainButton.click();

    // Expect to see a loading indicator while the model downloads/initializes
    await expect(page.getByText(/Starting...|Downloading model/)).toBeVisible();

    // Wait for the recording to actually start
    await expect(page.getByRole('button', { name: /End Session/i })).toBeVisible({ timeout: 120000 }); // Long timeout for model download
    await expect(page.getByText('● RECORDING')).toBeVisible();

    // Wait for a few seconds to simulate speaking
    await page.waitForTimeout(5000);

    // Click the button again to stop the session
    await page.getByRole('button', { name: /End Session/i }).click();

    // After stopping, we should be redirected to the analytics page
    await expect(page).toHaveURL(/.*\/analytics/);

    // Check for the transcript and word count
    await expect(page.getByText('Transcript')).toBeVisible();
    const wordCount = await page.getByText(/Total Words: \d+/).textContent();
    const count = parseInt(wordCount?.match(/\d+/)?.[0] || '0', 10);
    expect(count).toBeGreaterThan(0);
  });
});
