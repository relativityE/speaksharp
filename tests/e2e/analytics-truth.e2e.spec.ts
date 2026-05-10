import { test, expect } from './fixtures';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  selectTranscriptionEngine,
  simulateTranscription,
  waitForFeature,
  waitForTranscriptionService,
} from './helpers';
import { TEST_IDS } from '../constants';

const transcript = [
  'um speaksharp helps teams practice concise updates',
  'actually this customboost phrase should be tracked',
  'we can compare clarity pace and filler trends today',
].join(' ');

for (const mode of ['native', 'cloud'] as const) {
test(`Gate 2 mocked ${mode}: analytics values change from transcript events and survive reload/export`, async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await page.evaluate(async () => {
    const response = await fetch('/rest/v1/user_filler_words', {
      method: 'POST',
      headers: {
        accept: 'application/vnd.pgrst.object+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ user_id: 'test-user-123', word: 'customboost' }),
    });
    if (!response.ok) {
      throw new Error(`Failed to seed custom filler word: ${response.status}`);
    }
  });

  await navigateToRoute(page, '/session');
  await selectTranscriptionEngine(page, mode);
  await expect(page.getByTestId(TEST_IDS.STT_MODE_SELECT)).toHaveAttribute('data-state', mode);

  const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
  await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
  await startButton.click();
  await expect(startButton).toHaveAttribute('data-recording', 'true');

  await simulateTranscription(page, transcript, true);
  await waitForTranscriptionService(page, 'TRANSCRIPT_PULSE');

  await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('customboost');
  await expect(page.getByTestId(TEST_IDS.WPM_VALUE)).not.toHaveText('0');
  await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('3');

  await page.waitForTimeout(5_200);

  await startButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

  await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
  await waitForFeature(page, 'analytics');
  await expect(page.getByTestId(TEST_IDS.ANALYTICS_DASHBOARD)).toBeVisible();

  const latestSession = page.getByTestId(/session-history-item-/).first();
  await expect(latestSession).toContainText('3');
  await latestSession.click();

  await expect(page).toHaveURL(/\/analytics\/session-/);
  await expect(page.getByTestId(TEST_IDS.STAT_CARD_SPEAKING_PACE).locator('.text-3xl').first()).not.toHaveText('0');
  await expect(page.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE)).toContainText('%');
  await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('3');
  await expect(page.getByTestId('session-engine-metadata')).toContainText(new RegExp(mode, 'i'));
  await expect(page.getByText(/customboost phrase should be tracked/i)).toBeVisible();

  await page.reload();
  await waitForFeature(page, 'analytics');
  await expect(page.getByText(/customboost phrase should be tracked/i)).toBeVisible();
  await expect(page.getByTestId('session-engine-metadata')).toContainText(new RegExp(mode, 'i'));

  await page.getByRole('button', { name: /Export PDF/i }).click();
  await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'watermarked');
});
}

test('Gate 2 mocked analytics: session comparison selection opens comparison dialog', async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/analytics');
  await waitForFeature(page, 'analytics');

  const sessionItems = page.getByTestId(/session-history-item-/);
  await expect(sessionItems.first()).toBeVisible();

  const firstCompareCheckbox = sessionItems.nth(0).getByRole('checkbox');
  await firstCompareCheckbox.click();
  await expect(firstCompareCheckbox).toHaveAttribute('aria-checked', 'true');

  const secondCompareCheckbox = page.getByTestId(/session-history-item-/).nth(1).getByRole('checkbox');
  await secondCompareCheckbox.click();
  await expect(secondCompareCheckbox).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: /Compare Selected/i }).click();
  await expect(page.getByRole('dialog', { name: /Session Comparison/i })).toBeVisible();
  await expect(page.getByTestId('improvement-indicator').first()).toBeVisible();
});

for (const mode of ['native', 'cloud'] as const) {
test(`Gate 2 mocked ${mode}: session detail can return to dashboard`, async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/analytics');
  await waitForFeature(page, 'analytics');

  const latestSession = page.getByTestId(/session-history-item-/).first();
  await latestSession.getByRole('link').click();
  await expect(page).toHaveURL(/\/analytics\/session-/);
  await page.getByRole('link', { name: /Back to Dashboard/i }).click();
  await expect(page).toHaveURL('/analytics');
});
}
