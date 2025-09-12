import { expect, test, Response } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Anonymous User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await stubThirdParties(page);
  });

  test('should be able to start a temporary session', async ({ page }) => {
    await page.goto('/');

    const startButton = page.getByRole('button', { name: 'Start Practice' });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();

    await startButton.click();

    await page.waitForURL('/session/temp');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Transcript')).toBeVisible();
    await expect(page.getByText(/\d+:\d+/)).toBeVisible();
  });

  test('should be prompted to sign up after a session', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start Practice' }).click();
    await page.waitForURL('/session/temp');
    await page.waitForLoadState('networkidle');

    const stopButton = page.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible();
    await expect(stopButton).toBeEnabled();

    const responsePromise = page.waitForResponse(
      (response: Response) => response.url().includes('/api/session') && response.status() === 200,
      { timeout: 5000 }
    );

    await stopButton.click();

    try {
        await responsePromise;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
        console.log("Did not receive a session API response, continuing...");
    }

    await expect(page.getByRole('heading', { name: 'Sign Up to Save Your Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });
});
