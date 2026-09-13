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

  test('offers the after-state actions and fabricates no verdict prose', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session?coaching=treatment');
    await selectTranscriptionEngine(page, 'private');

    await startRecording(page);
    await simulateTranscription(page, userFacingTranscript, true);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText('tester-facing transcript');

    // #1231/#1222: the retired live-coaching SCORE card (`live-coaching-score-card`, `live-session-score`,
    // `score-help`, `live-score-*`, `live-coaching-actions`) is replaced by the coaching verdict surface.
    //
    // #1422 — THIS TEST USED TO ASSERT THE FABRICATION. It required a non-empty `verdict-line` and a
    // visible `verdict-fix` after any captured session. Nothing produced them: the coaching prose source
    // is retired (#1306), so `aiSuggestions` is always undefined and `verdictFromSuggestions` manufactured
    // "Session review not requested." plus a filler-derived fix — rendered directly ABOVE the real
    // generated 1+1 review, so the screen denied the review while displaying it. The test passed because
    // the defect was reliable.
    //
    // What the after-state actually owes the user is the two ACTIONS, which are not coaching:
    // `Practice this again` is the only desktop control wired to start the next take (`MobileActionBar`
    // is hidden at `md`). The absence of the prose is asserted as strictly as its presence once was.
    await page.waitForTimeout(5_200);
    await stopRecording(page);

    const coaching = page.getByTestId('coaching-card');
    await expect(coaching).toBeVisible({ timeout: 15_000 });
    await expect(coaching).toHaveAttribute('data-coaching-state', 'after', { timeout: 15_000 });
    await expect(page.getByTestId('session-verdict')).toBeVisible();

    // The actions survive the removal of the prose.
    await expect(page.getByTestId('verdict-practice-again')).toBeVisible();
    await expect(page.getByTestId('verdict-see-all')).toBeVisible();

    // And nothing invents a conclusion. `toHaveCount(0)` rather than `not.toBeVisible()`: a re-wired
    // fabricator that rendered the line off-screen or empty would still be a fabricated verdict.
    await expect(page.getByTestId('verdict-line')).toHaveCount(0);
    await expect(page.getByTestId('verdict-fix')).toHaveCount(0);

    // THE REAL REVIEW SURFACE IS WHERE COACHING LIVES NOW, and it must SETTLE. In this environment the
    // provider answers with a malformed body (`INVALID_REVIEW_RESPONSE`), which is precisely the case
    // worth pinning: the honest outcome is a card that says the review is unavailable, not one that
    // spins forever and not a fabricated verdict standing in for it.
    await expect(page.getByTestId('open-mic-practice-loop-review')).toBeVisible({ timeout: 15_000 });
    const reviewCard = page.getByTestId('ai-suggestions-card');
    await expect(reviewCard).toBeVisible();
    await expect(reviewCard, 'the review settles rather than spinning')
        .not.toHaveAttribute('data-review-state', 'loading', { timeout: 20_000 });

    // AND IT BLOCKS NOTHING. A review that cannot be generated must not cost the user the session they
    // just saved or the control that starts the next take.
    //
    // NOT `live-transcript`. My first version asserted that and CI answered "element(s) not found",
    // correctly: #1306 purges ephemeral working memory at terminal, and the after-state deliberately
    // renders the SERVER's transcript (`review-transcript`) or an honest notice about why it cannot
    // (`review-transcript-notice`) — never the live buffer. Demanding the live surface here would have
    // asserted the leak that purge exists to prevent, and a green version of it would have meant the
    // product had regressed.
    const savedTranscript = page.getByTestId('review-transcript');
    const transcriptNotice = page.getByTestId('review-transcript-notice');
    await expect
        .poll(async () => await savedTranscript.count() + await transcriptNotice.count(),
            { timeout: 15_000 })
        .toBeGreaterThan(0);

    // The saved session is still reachable, so the failed review cost the user nothing they recorded.
    await expect(page.getByTestId('post-save-review-session-link')).toBeVisible({ timeout: 15_000 });
    // And the only desktop control back into a recording still works.
    await expect(page.getByTestId('verdict-practice-again')).toBeEnabled();
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

    // #1306 Option A: diagnostics carry LENGTHS/codes only — the save-candidate NEVER exposes transcript text
    // (the privacy boundary covers test/E2E artifacts too). Assert a real candidate was selected via its length,
    // and that no transcript-text field is present.
    const saveCandidate = await page.evaluate(() => (
      window as Window & {
        __SPEECH_RUNTIME_DEBUG__?: () => {
          saveCandidate?: { selectedForSave?: string; selectedForSaveLength?: number; saveCandidateReason?: string };
        };
      }
    ).__SPEECH_RUNTIME_DEBUG__?.().saveCandidate ?? null);
    expect(saveCandidate).not.toBeNull();
    expect(saveCandidate?.selectedForSaveLength ?? 0).toBeGreaterThan(0);
    expect(saveCandidate?.selectedForSave).toBeUndefined();

    await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
    await waitForFeature(page, 'analytics');
    const latestSession = page.getByTestId(/session-history-item-/).first();
    await expect(latestSession).toContainText('1'); // #1231: true-filler headline (um), matches the session page
    await latestSession.getByTestId(/session-detail-link-/).click();
    await page.waitForURL('**/analytics/session-*');

    // Analytics session-DETAIL page keeps its own filler-count metric surface (unchanged by the overhaul).
    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('1');
    await expect(page.getByTestId(`${TEST_IDS.FILLER_COUNT_VALUE}-explanation`)).toContainText('captured words');
    // #1306 Step 3: the filler METRIC still reaches the detail unchanged, and the transcript that
    // produced it is now RETAINED for this newest session — so the assertion flips from absence to
    // positive proof that the saved detail carries the exact text.
    await expect(page.getByTestId('session-detail-transcript')).toHaveCount(1);
    await expect(page.getByTestId('session-detail-transcript')).toContainText(/tester-facing transcript/i);

    await page.reload();
    await waitForFeature(page, 'analytics');
    await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).toContainText('1');
    // ...and the retained transcript survives the reload too, i.e. it was read back from the server row
    // rather than held in memory.
    await expect(page.getByTestId('session-detail-transcript')).toContainText(/tester-facing transcript/i);
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
    // The responsive shell stacks on phones; the transcript must use the readable full-width column.
    expect(transcriptBox!.width).toBeGreaterThan(300);
    const progressBox = await page.getByTestId('session-slot-c').boundingBox();
    if (progressBox) {
      expect(progressBox.y).toBeGreaterThan(transcriptBox!.y);
    }

    await startRecording(page);
    await simulateTranscription(page, 'free mobile transcript appears without hidden controls', true);

    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText(/free mobile transcript/i);
    // The during-state stop control (recorder bar) is reachable — no obstruction.
    await expect(page.getByTestId(TEST_IDS.RECORDER_STOP)).toBeVisible();
  });
});
