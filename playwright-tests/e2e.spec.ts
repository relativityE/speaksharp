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

  test('a free-tier user can complete a session and view analytics', async ({ page }) => {
    // 1. Start on the main page and navigate to the session page
    await page.goto('/');
    await page.getByRole('button', { name: /Start Your Free Session Now/i }).click();
    await expect(page).toHaveURL(/.*\/session/);

    // 2. Start the recording (using the default Native Browser mode)
    const startButton = page.getByRole('button', { name: /Start Recording/i });
    await startButton.click();

    // 3. Wait for the listening state to be active
    await expect(page.getByText('● Listening, you may begin speaking!')).toBeVisible({ timeout: 15000 });

    // 4. Simulate a short recording session
    await page.waitForTimeout(3000); // Wait for 3 seconds

    // 5. End the session
    const endButton = page.getByRole('button', { name: /End Session/i });
    await endButton.click();

    // 6. Navigate to the analytics page from the dialog
    const analyticsButton = page.getByRole('button', { name: /Go to Analytics/i });
    await expect(analyticsButton).toBeVisible();
    await analyticsButton.click();

    // 7. Verify navigation and that the dashboard is displayed
    await expect(page).toHaveURL(/.*\/analytics/);
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible();

    // 8. Verify some key stats are present
    await expect(page.getByTestId('stat-card-total-sessions')).toContainText('1');
    await expect(page.getByTestId('stat-card-total-practice-time')).toBeVisible();
  });
});
