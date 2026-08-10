import { test, expect } from './fixtures';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  selectTranscriptionEngine,
  simulateTranscription,
  startRecording,
  stopRecording,
  waitForFeature,
} from './helpers';
import { TEST_IDS } from '../constants';

const userFacingTranscript = 'um this is a tester-facing transcript with like clear numbers and enough words to explain the score because the user should understand what changed, why it changed, and what to practice next. The point is to connect the visible tools to one useful coaching signal.';

test.describe('User-facing session and analytics regressions', () => {
  test('keeps final transcript visible when later interim text is blank', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'private');

    await startRecording(page);

    await simulateTranscription(page, userFacingTranscript, true);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText('tester-facing transcript');

    await simulateTranscription(page, '', false);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText('tester-facing transcript');
  });

  test('shows the coaching verdict after speech is captured', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session?coaching=treatment');
    await selectTranscriptionEngine(page, 'private');

    await startRecording(page);
    await simulateTranscription(page, userFacingTranscript, true);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText('tester-facing transcript');

    // #1231/#1222: the retired live-coaching SCORE card (`live-coaching-score-card`, `live-session-score`,
    // `score-help`, `live-score-*`, `live-coaching-actions`) is replaced by the coaching verdict surface.
    // After a captured session the after-state coaching card resolves to the verdict + one fix.
    await page.waitForTimeout(5_200);
    await stopRecording(page);

    const coaching = page.getByTestId('coaching-card');
    await expect(coaching).toBeVisible({ timeout: 15_000 });
    await expect(coaching).toHaveAttribute('data-coaching-state', 'after', { timeout: 15_000 });
    await expect(page.getByTestId('session-verdict')).toBeVisible();
    await expect(page.getByTestId('verdict-line')).not.toHaveText('');
    await expect(page.getByTestId('verdict-fix')).toBeVisible();
  });

  test('preserves metric parity from session to analytics detail after save and reload', async ({ page }) => {
    test.setTimeout(90_000);

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'private');

    await startRecording(page);
    // Trust-state while recording: the live indicator is shown (replaces the retired draft banner /
    // `__SS_TRUST_STATE__` window state — #1231).
    await expect(page.getByTestId('transcript-live-indicator')).toBeVisible({ timeout: 15_000 });
    await simulateTranscription(page, userFacingTranscript, true);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText('tester-facing transcript');

    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

    // #1231: the headline filler count is the TRUE-filler tier — "um" (1). "like" is a discourse marker:
    // it still appears in the per-word breakdown, but is not counted in the headline. This true-filler count
    // is the session-page metric that must reach analytics unchanged. `after-stats` reads "<n> fillers · <n> words".
    await expect(page.getByTestId('filler-breakdown')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('after-stats')).toContainText('1 fillers');

    const saveCandidate = await page.evaluate(() => (
      window as Window & {
        __SPEECH_RUNTIME_DEBUG__?: () => {
          saveCandidate?: { selectedForSave?: string; saveCandidateReason?: string };
        };
      }
    ).__SPEECH_RUNTIME_DEBUG__?.().saveCandidate ?? null);
    expect(saveCandidate?.selectedForSave).toContain('tester-facing transcript');
    expect(saveCandidate?.selectedForSave).not.toContain('[E2E_MOCK]');

    await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
    await waitForFeature(page, 'analytics');
    const latestSession = page.getByTestId(/session-history-item-/).first();
    await expect(latestSession).toContainText('1'); // #1231: true-filler headline (um), matches the session page
    await latestSession.getByTestId(/session-detail-link-/).click();
    await page.waitForURL('**/analytics/session-*');

    // Analytics session-DETAIL page keeps its own filler-count metric surface (unchanged by the overhaul).
    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('1');
    await expect(page.getByTestId(`${TEST_IDS.FILLER_COUNT_VALUE}-explanation`)).toContainText('captured words');
    await expect(page.getByText(/tester-facing transcript/i)).toBeVisible();

    await page.reload();
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('1');
    await expect(page.getByText(/tester-facing transcript/i)).toBeVisible();
  });

  test('keeps mobile session controls and transcript visible without obstruction', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');

    // #1231: start is the before-state `mic-start`; the transcript surface is the `transcript-card`.
    const startButton = page.getByTestId(TEST_IDS.MIC_START);
    const transcriptCard = page.getByTestId(TEST_IDS.TRANSCRIPT_CARD);
    await expect(startButton).toBeVisible();
    await expect(transcriptCard).toBeVisible();

    const startBox = await startButton.boundingBox();
    const transcriptBox = await transcriptCard.boundingBox();
    expect(startBox).not.toBeNull();
    expect(transcriptBox).not.toBeNull();
    expect(startBox!.width).toBeGreaterThan(40);
    expect(startBox!.height).toBeGreaterThan(40);
    expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(844);
    // The transcript card is present and not collapsed. (The overhaul shell is a fixed two-column grid, so
    // the mobile transcript column is narrower than the legacy full-width panel; assert it is not crushed
    // rather than the legacy >300px width.)
    expect(transcriptBox!.width).toBeGreaterThan(100);

    await startRecording(page);
    await simulateTranscription(page, 'free mobile transcript appears without hidden controls', true);

    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText(/free mobile transcript/i);
    // The during-state stop control (recorder bar) is reachable — no obstruction.
    await expect(page.getByTestId(TEST_IDS.RECORDER_STOP)).toBeVisible();
  });
});
