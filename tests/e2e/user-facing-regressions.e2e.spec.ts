import { test, expect } from './fixtures';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  selectTranscriptionEngine,
  simulateTranscription,
  waitForFeature,
} from './helpers';
import { TEST_IDS } from '../constants';

const userFacingTranscript = 'um this is a tester-facing transcript with like clear numbers and enough words to explain the score because the user should understand what changed, why it changed, and what to practice next. The point is to connect the visible tools to one useful coaching signal.';

test.describe('User-facing session and analytics regressions', () => {
  test('keeps final transcript visible when later interim text is blank', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'native');

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await startButton.click();
    await expect(startButton).toHaveAttribute('data-recording', 'true');

    await simulateTranscription(page, userFacingTranscript, true);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('tester-facing transcript');

    await simulateTranscription(page, '', false);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('tester-facing transcript');
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).not.toContainText('Listening...');
  });

  test('shows explanations for live metrics after speech is captured', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session?coaching=treatment');
    await selectTranscriptionEngine(page, 'native');

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await startButton.click();
    await simulateTranscription(page, userFacingTranscript, true);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('tester-facing transcript');

    await expect(page.getByTestId('live-coaching-score-card')).toBeVisible();
    await expect(page.getByTestId('live-session-score')).toHaveText('--');
    await expect(page.getByTestId('live-score-quality-caveat')).toContainText(/miss filler words/i);
    await expect(page.getByTestId('live-score-evidence')).toContainText(/pace, fillers, pauses/i);
    await expect(page.getByTestId('live-coaching-actions')).toContainText(/\w+/);
    await expect(page.getByText(/filler words detected|captured words/i)).toBeVisible();
    await expect(page.getByTestId('live-coaching-actions')).toContainText(/beat of silence|pause|main point|example|takeaway/i);
  });

  test('preserves metric parity from session to analytics detail after save and reload', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'native');

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    const transcriptPanel = page.getByTestId(TEST_IDS.TRANSCRIPT_PANEL);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await startButton.click();
    await simulateTranscription(page, userFacingTranscript, true);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('tester-facing transcript');
    await expect(transcriptPanel).toHaveAttribute('data-draft-banner-visible', 'true');
    await expect(transcriptPanel).toHaveAttribute('data-final-state-visible', 'false');
    const trustStateWhileRecording = await page.evaluate(() => (
      window as Window & {
        __SS_TRUST_STATE__?: { uiState?: string; draftBannerVisible?: boolean };
      }
    ).__SS_TRUST_STATE__);
    expect(trustStateWhileRecording).toMatchObject({
      uiState: 'drafting',
      draftBannerVisible: true,
    });

    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('2');
    await page.waitForTimeout(5_200);
    await startButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
    await expect(transcriptPanel).toHaveAttribute('data-final-state-visible', 'true', { timeout: 15_000 });
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
    await expect(latestSession).toContainText('2');
    await latestSession.getByTestId(/session-detail-link-/).click();
    await page.waitForURL('**/analytics/session-*');

    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('2');
    await expect(page.getByTestId(`${TEST_IDS.FILLER_COUNT_VALUE}-explanation`)).toContainText('captured words');
    await expect(page.getByText(/tester-facing transcript/i)).toBeVisible();

    await page.reload();
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('2');
    await expect(page.getByText(/tester-facing transcript/i)).toBeVisible();
  });

  test('keeps mobile session controls and transcript visible without obstruction', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    const transcriptPanel = page.getByTestId(TEST_IDS.TRANSCRIPT_PANEL);
    await expect(startButton).toBeVisible();
    await expect(transcriptPanel).toBeVisible();
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    const startBox = await startButton.boundingBox();
    const transcriptBox = await transcriptPanel.boundingBox();
    expect(startBox).not.toBeNull();
    expect(transcriptBox).not.toBeNull();
    expect(startBox!.width).toBeGreaterThan(40);
    expect(startBox!.height).toBeGreaterThan(40);
    expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(844);
    expect(transcriptBox!.width).toBeGreaterThan(300);

    await startButton.click();
    await expect(startButton).toHaveAttribute('data-recording', 'true');
    await simulateTranscription(page, 'free mobile transcript appears without hidden controls', true);

    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(/free mobile transcript/i);
    await expect(page.getByLabel(/Stop Recording/i)).toBeVisible();
  });
});
