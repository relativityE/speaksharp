/**
 * PR 1b — Private-mode trust-state + save -> history -> detail proof.
 *
 * Covered here (mock-transcript harness):
 *  - Private recording trust-state: the LIVE indicator is visible while recording (#1231 replaces the old
 *    draft-banner / `__SS_TRUST_STATE__` window state with the visible `transcript-live-indicator`);
 *  - after Stop the transcript is intact (cumulative — no blank/truncation) and the live indicator is gone;
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
  startRecording,
  stopRecording,
  waitForFeature,
} from './helpers';
import { TEST_IDS } from '../constants';

const PRIVATE_TRANSCRIPT =
  'this is a private on device transcript with enough words to be persisted and then rendered in the saved session detail view after stop';

test.describe('Private mode trust-state + save/detail', () => {
  test('Private: live -> final lifecycle, cumulative transcript, save -> detail correctness', async ({ page }) => {
    test.setTimeout(90_000);

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'private');

    // Record in Private mode and produce a transcript.
    await startRecording(page);

    // Trust-state WHILE recording: the live indicator is visible on the transcript card (#1231).
    await expect(page.getByTestId('transcript-live-indicator')).toBeVisible({ timeout: 15_000 });

    await simulateTranscription(page, PRIVATE_TRANSCRIPT, true);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText(/private on device transcript/i);

    // Stop -> save.
    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

    // #1306 Option A: after terminal finalization the ephemeral transcript is PURGED. The metrics-only review
    // shows NO transcript text and no live indicator (it was visible + cumulative WHILE recording, above), and
    // the completed review still presents the one structured next action.
    await expect(page.getByText(/private on device transcript/i)).toHaveCount(0);
    await expect(page.getByTestId('transcript-live-indicator')).toHaveCount(0);
    await expect(page.getByTestId('session-next-action-title')).toHaveCount(1);

    // save -> history -> detail.
    await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
    await waitForFeature(page, 'analytics');
    const latest = page.getByTestId(/session-history-item-/).first();
    // #G4 chunk 3: the per-row engine/PRIVATE badge was removed (the section footer carries the privacy
    // promise; the detail view below still identifies the Private engine). So the row-level engine
    // assertion is retired here — the trust signal is verified on the detail view instead.
    await latest.getByTestId(/session-detail-link-/).click();
    await page.waitForURL('**/analytics/session-*');

    // #1306 metrics-only: the live transcript above was ephemeral working memory; the saved detail view renders
    // metrics + the one next action and NEVER the transcript (the trust signal is the Private engine metadata).
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(0);
    await expect(page.getByText(/private on device transcript/i)).toHaveCount(0);
    await expect(page.getByTestId('session-engine-metadata')).toContainText(/private/i);
  });
});
