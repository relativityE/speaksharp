import { test, expect, programmaticLogin } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';

test.describe('Live Transcript', () => {
  let sessionPage: SessionPage;

  test('should display a live transcript during a session', async ({ page }) => {
    await programmaticLogin(page, 'transcript-user@example.com');

    sessionPage = new SessionPage(page);
    await sessionPage.goto();

    await page.getByTestId('start-free-session-button').click();
    await expect(page.getByTestId('live-transcript')).toBeVisible();
  });
});