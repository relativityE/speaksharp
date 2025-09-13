import { expect, test, Response } from './helpers';
import { stubThirdParties } from './sdkStubs';

test.describe('Anonymous User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await stubThirdParties(page);

    page.on('requestfailed', (r) =>
      console.log(`[REQUEST FAILED] ${r.url()}: ${r.failure()?.errorText}`)
    );
    page.on('response', (r) => {
      if (r.status() >= 400) console.log(`[HTTP ERROR] ${r.status()} ${r.url()}`);
    });

    test.setTimeout(15000);
  });

  test('can start a temporary session', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/');

    const startButton = page.getByRole('button', { name: 'Start Practice' });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();

    await startButton.click();

    try {
      await page.waitForURL('/session/temp', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
    } catch (err) {
      console.log('Failed to redirect to temp session', err);
      await page.screenshot({ path: 'debug-temp-session.png' });
      throw err;
    }

    await expect(page.getByText('Transcript')).toBeVisible();
    await expect(page.getByText(/\d+:\d+/)).toBeVisible();
  });

  test('prompted to sign up after session', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/');
    const startButton = page.getByRole('button', { name: 'Start Practice' });
    await startButton.click();

    try {
      await page.waitForURL('/session/temp', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
    } catch (err) {
      console.log('Failed to redirect to temp session', err);
      await page.screenshot({ path: 'debug-temp-session2.png' });
      throw err;
    }

    const stopButton = page.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible();
    await expect(stopButton).toBeEnabled();

    const responsePromise = page.waitForResponse(
      (res: Response) => res.url().includes('/api/session') && res.status() === 200,
      { timeout: 5000 }
    );

    await stopButton.click();
    try { await responsePromise; } catch { console.log('Session API did not respond, continuing...'); }

    await expect(page.getByRole('heading', { name: 'Sign Up to Save Your Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });
});
