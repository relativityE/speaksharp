import { test, expect, startSession, stopSession } from './helpers';

test.describe('Anonymous User Flow', () => {
  test.beforeEach(async () => {
    test.setTimeout(15000);
  });

  test('start temporary session', async ({ page }) => {
    test.setTimeout(60000);
    await startSession(page);
    await expect(page.getByText('Transcript')).toBeVisible();
    await expect(page.getByText(/\d+:\d+/)).toBeVisible();
  });

  test('prompted to sign up after session', async ({ page }) => {
    test.setTimeout(60000);
    await startSession(page);
    await stopSession(page);

    await expect(page.getByRole('heading', { name: 'Sign Up to Save Your Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });
});
