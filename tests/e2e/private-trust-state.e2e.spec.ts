/**
 * PR 1b — Private-mode trust-state + save -> history -> detail proof.
 *
 * Covered here (mock-transcript harness):
 *  - Private recording trust-state: drafting/interim visible while recording (draft banner, not final);
 *  - final state visible after Stop, with the prior transcript intact (cumulative — no blank/truncation);
 *  - save -> history -> detail: the saved Private transcript matches and renders; engine/mode reads Private.
 *
 * NOT covered here (requires separate live/manual Private proof — do NOT fake in the mock harness):
 *  - real model download / setup consent;
 *  - real local-model latency / readiness.
 */
import { test, expect } from './fixtures';
import {
  navigateToRoute,
  simulateTranscription,
  selectTranscriptionEngine,
  programmaticLoginWithRoutes,
  waitForFeature,
} from './helpers';
import { TEST_IDS } from '../constants';

const PRIVATE_TRANSCRIPT =
  'this is a private on device transcript with enough words to be persisted and then rendered in the saved session detail view after stop';

test.describe('Private mode trust-state + save/detail', () => {
  test('Private: drafting -> final lifecycle, cumulative transcript, save -> detail correctness', async ({ page }) => {
    test.setTimeout(90_000);

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'private');

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    const transcriptPanel = page.getByTestId(TEST_IDS.TRANSCRIPT_PANEL);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    // Record in Private mode and produce a transcript.
    await startButton.click();
    await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15_000 });
    await simulateTranscription(page, PRIVATE_TRANSCRIPT, true);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(/private on device transcript/i);

    // Trust-state WHILE recording: drafting + draft banner visible, not final, mode = private.
    await expect(transcriptPanel).toHaveAttribute('data-draft-banner-visible', 'true');
    await expect(transcriptPanel).toHaveAttribute('data-final-state-visible', 'false');
    const recordingTrust = await page.evaluate(
      () =>
        (window as Window & {
          __SS_TRUST_STATE__?: { uiState?: string; sttMode?: string; draftBannerVisible?: boolean };
        }).__SS_TRUST_STATE__,
    );
    expect(recordingTrust).toMatchObject({ uiState: 'drafting', draftBannerVisible: true, sttMode: 'private' });

    // Stop -> save.
    await page.waitForTimeout(5_200);
    await startButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

    // Final state + transcript INTACT (cumulative, not blank/truncated).
    await expect(transcriptPanel).toHaveAttribute('data-final-state-visible', 'true', { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(
      /private on device transcript with enough words/i,
    );

    // save -> history -> detail.
    await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
    await waitForFeature(page, 'analytics');
    const latest = page.getByTestId(/session-history-item-/).first();
    // History row should identify the Private engine/mode.
    await expect(latest).toContainText(/private/i);
    await latest.getByTestId(/session-detail-link-/).click();
    await page.waitForURL('**/analytics/session-*');

    // Detail view renders the saved Private transcript.
    await expect(page.getByText(/private on device transcript/i)).toBeVisible();
  });
});
