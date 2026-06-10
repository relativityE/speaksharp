import { test, expect } from './fixtures';
import {
  navigateToRoute,
  openSessionDetailFromHistoryItem,
  programmaticLoginWithRoutes,
  selectTranscriptionEngine,
  simulateTranscription,
  waitForFeature,
} from './helpers';
import { TEST_IDS } from '../constants';

const transcript = [
  'um speaksharp helps teams practice concise updates',
  'actually this target phrase should be tracked',
  'basically we can compare clarity pace like filler trends today',
].join(' ');

for (const mode of ['native', 'cloud'] as const) {
test(`Gate 2 mocked ${mode}: analytics values change from transcript events and survive reload/export`, async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  const expectedEngineLabel = mode === 'native' ? /browser/i : new RegExp(mode, 'i');

  await navigateToRoute(page, '/session');
  await selectTranscriptionEngine(page, mode);
  await expect(page.getByTestId(TEST_IDS.STT_MODE_SELECT)).toHaveAttribute('data-state', mode);

  const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
  await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
  await startButton.click();
  await expect(startButton).toHaveAttribute('data-recording', 'true');

  await simulateTranscription(page, transcript, true);

  await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('target phrase');
  await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('4');

  await page.waitForTimeout(5_200);

  await startButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

  await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
  await waitForFeature(page, 'analytics');
  await expect(page.getByTestId(TEST_IDS.ANALYTICS_DASHBOARD)).toBeVisible();

  const latestSession = page.getByTestId(/session-history-item-/).first();
  await expect(latestSession).toContainText('4');
  await openSessionDetailFromHistoryItem(page, latestSession);
  await expect(page.getByTestId(TEST_IDS.STAT_CARD_SPEAKING_PACE).locator('.text-3xl').first()).not.toHaveText('0');
  await expect(page.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE)).toContainText('%');
  await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('4');
  await expect(page.getByTestId('session-engine-metadata')).toContainText(expectedEngineLabel);
  await expect(page.getByText(/target phrase should be tracked/i)).toBeVisible();

  await page.reload();
  await waitForFeature(page, 'analytics');
  await expect(page.getByText(/target phrase should be tracked/i)).toBeVisible();
  await expect(page.getByTestId('session-engine-metadata')).toContainText(expectedEngineLabel);

  await page.getByRole('button', { name: /Export PDF/i }).click();
  await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'watermarked');
});
}

for (const mode of ['native', 'cloud'] as const) {
test(`Gate 2 mocked ${mode}: session detail can return to dashboard`, async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/analytics');
  await waitForFeature(page, 'analytics');

  const latestSession = page.getByTestId(/session-history-item-/).first();
  await openSessionDetailFromHistoryItem(page, latestSession);
  await page.getByRole('link', { name: /Back to Dashboard/i }).click();
  await expect(page).toHaveURL('/analytics');
});
}
