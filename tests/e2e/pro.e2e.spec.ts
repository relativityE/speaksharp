import { test, expect, programmaticLogin } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';

test.describe('Pro User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    sessionPage = new SessionPage(page);
  });

  test('should not see upgrade prompts as a pro user', async ({ page }) => {
    await programmaticLogin(page, 'pro-user@example.com');
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
    await expect(page.getByTestId('upgrade-banner')).toHaveCount(0);
  });

  test('should have access to all transcription modes', async ({ page }) => {
    await programmaticLogin(page, 'pro-user@example.com');
    await sessionPage.goto();
    // Verify transcription modes UI elements
    const transcriptionModeCount = await page.getByTestId('transcription-mode').count();
    expect(transcriptionModeCount).toBeGreaterThan(0);
  });
});
