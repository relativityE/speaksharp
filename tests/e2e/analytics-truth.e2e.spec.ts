import { test, expect } from './fixtures';
import {
  navigateToRoute,
  openSessionDetailFromHistoryItem,
  programmaticLoginWithRoutes,
  selectTranscriptionEngine,
  simulateTranscription,
  startRecording,
  stopRecording,
  waitForFeature,
} from './helpers';
import { TEST_IDS } from '../constants';

const transcript = [
  'um speaksharp helps teams practice concise updates',
  'actually this target phrase should be tracked',
  'basically we can compare clarity pace like filler trends today',
].join(' ');

// #1184: Private is the only engine — the former native/cloud matrix collapses to a single Private run.
test(`Gate 2 mocked private: analytics values change from transcript events and survive reload/export`, async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  const expectedEngineLabel = /private/i;

  await navigateToRoute(page, '/session');
  await selectTranscriptionEngine(page, 'private');

  await startRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15_000 });

  await simulateTranscription(page, transcript, true);

  await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText('target phrase');

  await page.waitForTimeout(5_200);

  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

  await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
  await waitForFeature(page, 'analytics');
  await expect(page.getByTestId(TEST_IDS.ANALYTICS_DASHBOARD)).toBeVisible();

  const latestSession = page.getByTestId(/session-history-item-/).first();
  // #1231: the headline filler count is the TRUE-filler tier — "Um" (1). The fixture's other tracked words
  // (like/you know/basically/actually) are discourse markers, shown in the breakdown but not counted here.
  await expect(latestSession).toContainText('1');
  await openSessionDetailFromHistoryItem(page, latestSession);
  await expect(page.getByTestId(TEST_IDS.STAT_CARD_SPEAKING_PACE).locator('.text-3xl').first()).not.toHaveText('0');
  await expect(page.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE)).toContainText('%');
  await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('1');
  await expect(page.getByTestId('session-engine-metadata')).toContainText(expectedEngineLabel);
  // #1306 metrics-only: the spoken transcript is ephemeral working memory — it drove the LIVE metrics above
  // but is NEVER persisted or shown on the saved review surface (before OR after reload).
  await expect(page.getByText(/target phrase should be tracked/i)).toHaveCount(0);
  await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);

  await page.reload();
  await waitForFeature(page, 'analytics');
  await expect(page.getByText(/target phrase should be tracked/i)).toHaveCount(0);
  await expect(page.getByTestId('session-engine-metadata')).toContainText(expectedEngineLabel);

  await page.getByRole('button', { name: /Export PDF/i }).click();
  await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'watermarked');
});

test(`Gate 2 mocked private: session detail can return to dashboard`, async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/analytics');
  await waitForFeature(page, 'analytics');

  const latestSession = page.getByTestId(/session-history-item-/).first();
  await openSessionDetailFromHistoryItem(page, latestSession);
  await page.getByRole('link', { name: /Back to Dashboard/i }).click();
  await expect(page).toHaveURL('/analytics');
});
