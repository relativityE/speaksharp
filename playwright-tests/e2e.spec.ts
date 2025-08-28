import { test, expect } from '@playwright/test';

test.describe('E2E User Flow', () => {
  test.setTimeout(180000); // 3 minutes timeout for longer tests

  test('a user can complete a session using native mode and view analytics', async ({ page }) => {
    // 1. Start on the main page and navigate to the session page
    await page.goto('/');
    await page.getByRole('button', { name: /Start Your Free Session Now/i }).click();
    await expect(page).toHaveURL(/.*\/session/);

    // 2. Start the recording (using the default Native Browser mode)
    const startButton = page.getByRole('button', { name: /Start Recording/i });
    await startButton.click();

    // 3. Wait for the listening state to be active
    await expect(page.getByText('● Listening...')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Native Browser/i)).toBeVisible();

    // 4. Simulate a short recording session
    await page.waitForTimeout(3000); // Wait for 3 seconds

    // 5. End the session
    const endButton = page.getByRole('button', { name: /End Session/i });
    await endButton.click();

    // 6. Navigate to the analytics page from the dialog
    const analyticsButton = page.getByRole('button', { name: /Go to Analytics/i });
    await expect(analyticsButton).toBeVisible();
    await analyticsButton.click();

    // 7. Verify navigation and that the dashboard is displayed for the anonymous user
    await expect(page).toHaveURL(/.*\/analytics/);
    await expect(page.getByText('Session Analysis')).toBeVisible();
    await expect(page.getByText('Hello world')).toBeVisible(); // Assuming mock transcript
  });

  test('a user can complete a session using cloud mode', async ({ page }) => {
    // 1. Start on the main page and navigate to the session page
    await page.goto('/');
    await page.getByRole('button', { name: /Start Your Free Session Now/i }).click();
    await expect(page).toHaveURL(/.*\/session/);

    // 2. Enable "Force Cloud" mode
    const forceCloudCheckbox = page.getByLabel('Force Cloud (Disable Fallback)');
    await expect(forceCloudCheckbox).toBeVisible();
    await forceCloudCheckbox.check();

    // 3. Start the recording
    const startButton = page.getByRole('button', { name: /Start Recording/i });
    await startButton.click();

    // 4. Wait for the listening state to be active and verify cloud mode
    await expect(page.getByText('● Listening...')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Cloud AI/i)).toBeVisible();

    // 5. Simulate a short recording session.
    // In a real E2E test with audio, we would check for a transcript here.
    // For now, we just verify the connection and state.
    await page.waitForTimeout(5000); // Wait for 5 seconds to ensure stability

    // 6. End the session
    const endButton = page.getByRole('button', { name: /End Session/i });
    await endButton.click();

    // 7. Navigate to the analytics page from the dialog
    const analyticsButton = page.getByRole('button', { name: /Go to Analytics/i });
    await expect(analyticsButton).toBeVisible();
    await analyticsButton.click();

    // 8. Verify navigation and that the dashboard is displayed
    await expect(page).toHaveURL(/.*\/analytics/);
    await expect(page.getByText('Session Analysis')).toBeVisible();
  });
});
