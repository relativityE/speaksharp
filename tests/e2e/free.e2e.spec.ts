import { test, expect, programmaticLogin } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';

test.describe('Free User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    sessionPage = new SessionPage(page);
  });

  test('should display the correct UI for a free user', async ({ page }) => {
    await programmaticLogin(page, 'free-user@example.com');

    await test.step('Verify home page UI', async () => {
      await expect(page.getByTestId('start-free-session-button')).toBeVisible({ timeout: 15000 });
    });
  });

  test('should allow a free user to start and stop a session', async ({ page }) => {
    await programmaticLogin(page, 'free-user@example.com');

    await test.step('Start a session', async () => {
      await page.getByTestId('start-free-session-button').click();
      await expect(page.getByRole('button', { name: 'Stop Session' })).toBeVisible();
    });

    await test.step('Stop the session', async () => {
      await page.getByRole('button', { name: 'Stop Session' }).click();
      await expect(page.getByTestId('start-free-session-button')).toBeVisible();
    });
  });
});