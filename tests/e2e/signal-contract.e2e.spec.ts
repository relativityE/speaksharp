import { test, expect } from './fixtures';
import {
  mockLiveTranscript,
  navigateToRoute,
  openSessionDetailFromHistoryItem,
  programmaticLoginWithRoutes,
  startRecording,
  stopRecording,
  waitForFeature,
  waitForPersistenceSignal,
  waitForTranscriptionService,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

test.describe('Signal contract invariants', () => {
  test('RECORDING runtime signal agrees with recording UI and mounted transcript surface', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');

    const html = page.locator('html');
    // #1222/#1231: start/stop are split (mic-start / recorder-stop) and there is no `data-recording`
    // attribute; the RECORDING runtime signal is the sole recording truth. The transcript surface on the
    // new page is the always-mounted `transcript-card` (it hosts `live-transcript` once tokens arrive).
    const transcriptCard = page.getByTestId(TEST_IDS.TRANSCRIPT_CARD);
    const statusIndicator = page.getByTestId(TEST_IDS.SESSION_STATUS_INDICATOR);

    await startRecording(page);

    await expect(html).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.SESSION_SHELL)).toHaveAttribute('data-session-state', 'during');
    await expect(transcriptCard).toBeVisible();
    await expect(statusIndicator).not.toHaveAttribute('data-engine', 'none');
  });

  test('session persistence signal agrees with history and reachable analytics detail', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    await startRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15_000 });

    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await waitForTranscriptionService(page, 'TRANSCRIPT_PULSE');

    await stopRecording(page);
    await waitForPersistenceSignal(page, 15_000);

    await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId(TEST_IDS.ANALYTICS_DASHBOARD)).toBeVisible({ timeout: 20_000 });

    const latestSession = page.getByTestId(/session-history-item-/).first();
    await expect(latestSession).toBeVisible({ timeout: 20_000 });

    await openSessionDetailFromHistoryItem(page, latestSession);
    await expect(page.getByRole('link', { name: /Back to Dashboard/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('session-engine-metadata')).toBeVisible({ timeout: 20_000 });
  });
});
