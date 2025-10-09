import { test, expect, programmaticLogin } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';

test.describe('Smoke Test', () => {
  let sessionPage: SessionPage;

  test('should log in, navigate to session page, and verify core UI elements @smoke', async ({ page }) => {
    await programmaticLogin(page, 'smoke-test-user@example.com');

    sessionPage = new SessionPage(page);
    await sessionPage.goto();

    await expect(page.getByRole('button', { name: 'Start For Free' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
  });
});