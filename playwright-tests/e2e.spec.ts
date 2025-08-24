import { test, expect } from '@playwright/test';

test.describe('E2E User Flow', () => {
  test.setTimeout(180000);

  test('a non-pro user cannot use cloud mode', async ({ page }) => {
    // 1. Start on the main page
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Private Practice. Public Impact!/i })).toBeVisible();

    // 2. Navigate to the session page
    await page.getByRole('button', { name: /Start Your Free Session Now/i }).click();
    await expect(page).toHaveURL(/.*\/session/);

    // 3. Switch to cloud mode
    const modeSwitch = page.getByLabel('Transcription Mode').locator('..').getByRole('switch');
    await modeSwitch.click();
    await expect(page.getByText('Cloud Transcription (Highest Accuracy)')).toBeVisible();

    // 4. Attempt to start the recording
    const startButton = page.getByRole('button', { name: /Start Recording/i });
    await startButton.click();

    // 5. Assert that an error is shown to the user
    // The hook should catch the 401 from the backend and display it.
    const errorMessage = page.getByText(/Authentication failed|User not found/);
    await expect(errorMessage).toBeVisible({ timeout: 30000 });

    // 6. Assert that the button did NOT change to "End Session"
    await expect(page.getByRole('button', { name: /End Session/i })).not.toBeVisible();
  });
});
