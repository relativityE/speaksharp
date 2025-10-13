import { test, expect, programmaticLogin } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';

test.describe('Smoke Test', () => {
  let sessionPage: SessionPage;

  test('should log in, navigate to session page, and verify core UI elements @smoke', async ({ page }) => {
    await programmaticLogin(page, 'smoke-test-user@example.com');

    sessionPage = new SessionPage(page);
    await sessionPage.goto();

    // Corrected Assertions:
    // A logged-in user should see an "Upgrade" button on the session page
    // and a "Sign Out" button in the main navigation.
    await expect(page.getByRole('button', { name: /upgrade/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
  });
});
