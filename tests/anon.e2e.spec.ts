import { expect, test, Response } from './helpers';
import { stubThirdParties } from './sdkStubs';

test.describe('Anonymous User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank', { timeout: 5000 }); // sandbox-safe
    await stubThirdParties(page);
  });

  test('should be able to start a temporary session', async ({ page }) => {
    await page.goto('/', { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    const startButton = page.getByRole('button', { name: 'Start Practice' });
    await expect(startButton).toBeVisible({ timeout: 5000 });
    await expect(startButton).toBeEnabled({ timeout: 5000 });

    await startButton.click();

    try {
      await page.waitForURL('/session/temp', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (error) {
      console.log('Failed to redirect to temp session', error);
      await page.screenshot({ path: 'debug-temp-session.png' });
      throw error;
    }

    await expect(page.getByText('Transcript')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/\d+:\d+/)).toBeVisible({ timeout: 5000 });
  });

  test('should be prompted to sign up after a session', async ({ page }) => {
    await page.goto('/', { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    const startButton = page.getByRole('button', { name: 'Start Practice' });
    await expect(startButton).toBeVisible({ timeout: 5000 });
    await expect(startButton).toBeEnabled({ timeout: 5000 });
    await startButton.click();

    try {
      await page.waitForURL('/session/temp', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (error) {
      console.log('Failed to redirect to temp session', error);
      await page.screenshot({ path: 'debug-temp-session2.png' });
      throw error;
    }

    const stopButton = page.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible({ timeout: 5000 });
    await expect(stopButton).toBeEnabled({ timeout: 5000 });

    const responsePromise = page.waitForResponse(
      (res: Response) => res.url().includes('/api/session') && res.status() === 200,
      { timeout: 5000 }
    ).catch(() => null); // fail-safe, don’t hang

    await stopButton.click();
    await responsePromise;

    await expect(page.getByRole('heading', { name: 'Sign Up to Save Your Session' }))
      .toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Create Account' }))
      .toBeVisible({ timeout: 5000 });
  });
});

// Optional global safety net
test.describe.configure({
  timeout: 60000,
  retries: 1,
});
