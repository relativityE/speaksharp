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

const userFacingTranscript = 'um this is a tester-facing transcript with like clear numbers and enough words to explain the score';

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
    await waitForTranscriptionService(page, 'TRANSCRIPT_PULSE');
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('tester-facing transcript');

    await simulateTranscription(page, '', false);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('tester-facing transcript');
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).not.toContainText('Listening...');
  });

  test('shows explanations for live metrics after speech is captured', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'native');

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await startButton.click();
    await simulateTranscription(page, userFacingTranscript, true);
    await waitForTranscriptionService(page, 'TRANSCRIPT_PULSE');

    await expect(page.getByTestId(TEST_IDS.WPM_VALUE)).not.toHaveText('0');
    await expect(page.getByText(/target range|too little speech|below the target|above the target/i)).toBeVisible();
    await expect(page.getByText(/filler words detected|captured words/i)).toBeVisible();
    await expect(page.getByText(/pulling attention away|replace the next one|no filler words|rough signal/i)).toBeVisible();
  });

  test('preserves metric parity from session to analytics detail after save and reload', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await selectTranscriptionEngine(page, 'native');

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await startButton.click();
    await simulateTranscription(page, userFacingTranscript, true);
    await waitForTranscriptionService(page, 'TRANSCRIPT_PULSE');

    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('2');
    await page.waitForTimeout(5_200);
    await startButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

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
    await programmaticLoginWithRoutes(page, { userType: 'basic' });
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
    await simulateTranscription(page, 'basic mobile transcript appears without hidden controls', true);
    await waitForTranscriptionService(page, 'TRANSCRIPT_PULSE');

    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText('basic mobile transcript');
    await expect(page.getByLabel(/Stop Recording/i)).toBeVisible();
  });
});
