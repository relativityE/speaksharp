import { test, expect } from './fixtures';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';

/**
 * #1264 — the optional Open Mic Practice Focus journey: choose an intention in the before-state, see it
 * ride along as a non-scoring reminder while recording, save, then REPEAT and confirm the same intention
 * is preserved. Private recording only; the intention never touches the transcript or engine policy.
 */

// A saved, comparison-eligible session so the review page renders the real "Practice this next"
// (progress-accept) repeat action. Mirrors the eligible-progress shape used by the U3 cross-page proof.
const REPEAT_SESSION_ID = 'pf-repeat-session';
const REPEAT_REFERENCE_ID = 'pf-repeat-reference';

function eligibleRepeatProgress() {
  const current = {
    session_id: REPEAT_SESSION_ID,
    eligible: true,
    exclusion_reasons: [],
    clarity_raw: 88,
    filler_count: 4,
    wpm: 142,
    word_count: 245,
    cohort_key: 'private|v2|base|clarity_v1',
    baseline_session_id: REPEAT_REFERENCE_ID,
    previous_comparable_session_id: REPEAT_REFERENCE_ID,
    formula_version: 'clarity_v1',
  };
  const reference = {
    ...current,
    session_id: REPEAT_REFERENCE_ID,
    clarity_raw: 82,
    filler_count: 7,
    wpm: 136,
    baseline_session_id: null,
    previous_comparable_session_id: null,
  };
  return {
    evaluations: [current, reference],
    recommendations: [{ id: 'pf-repeat-recommendation', source_session_id: REPEAT_SESSION_ID, formula_version: 'clarity_v1' }],
    attempts: [],
  };
}

test.describe('#1264 — Open Mic Practice Focus, preserved through repeat', () => {
  test('select a focus → record → save → repeat keeps the same focus', async ({ page }) => {
    test.setTimeout(120_000);

    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await page.waitForURL('**/session');

    // ---- BEFORE: choose an intention (optional; Open Mic only) ----
    await expect(page.getByTestId('practice-focus-chooser')).toBeVisible();
    await page.getByTestId('practice-focus-reduce_fillers').click();
    await expect(page.getByTestId('practice-focus-reduce_fillers')).toHaveAttribute('aria-checked', 'true');

    // ---- DURING: the chosen focus is a non-scoring reminder ----
    await startRecording(page);
    await simulateTranscription(page, 'um okay so this is a quick open mic take about nothing in particular', true);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('practice-focus-reminder')).toContainText(/Reduce fillers/i);

    // ---- SAVE ----
    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });

    // ---- REPEAT: re-enter Open Mic; the intention is preserved (not cleared on the prior recording) ----
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await page.waitForURL('**/session');
    await expect(page.getByTestId('practice-focus-chooser')).toBeVisible();
    await expect(page.getByTestId('practice-focus-reduce_fillers')).toHaveAttribute('aria-checked', 'true');
  });

  // The named product journey the issue requires: preservation THROUGH the actual customer-visible
  // "Practice this next" (progress-accept) repeat action — not a manual re-entry to /practice. Choose a
  // focus in Open Mic, open the saved session's review, click the real repeat, and assert the resulting
  // Open Mic before-state still carries the chosen focus.
  test('the real "Practice this next" repeat action preserves the chosen focus', async ({ page }) => {
    test.setTimeout(120_000);

    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      progressFixtures: eligibleRepeatProgress(),
      sessions: [{
        id: REPEAT_SESSION_ID,
        user_id: 'test-user-123',
        created_at: '2025-02-01T14:00:00.000Z',
        duration: 420,
        transcript_state: 'available',
        transcript: 'A saved Open Mic take used to reach the Practice this next repeat action.',
        title: 'Practice Focus Repeat Session',
        total_words: 245,
        engine: 'private',
        clarity_score: 88,
        wpm: 142,
        filler_words: { um: { count: 4 }, total: { count: 4 } },
      }],
    });

    // ---- Choose an intention in the Open Mic before-state ----
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await page.waitForURL('**/session');
    await expect(page.getByTestId('practice-focus-chooser')).toBeVisible();
    await page.getByTestId('practice-focus-steady_pace').click();
    await expect(page.getByTestId('practice-focus-steady_pace')).toHaveAttribute('aria-checked', 'true');

    // ---- Open the saved session's review, where the real repeat action lives ----
    await navigateToRoute(page, `/analytics/${REPEAT_SESSION_ID}`);
    await expect(page.getByTestId('progress-panel')).toBeVisible();
    const practiceThisNext = page.getByTestId('progress-accept');
    await expect(practiceThisNext).toHaveText(/Practice this next/i);

    // ---- Invoke the ACTUAL customer-visible "Practice this next" repeat (routes back to Open Mic) ----
    await practiceThisNext.click();
    await page.waitForURL('**/session');

    // ---- The Open Mic before-state retains the chosen focus through the real repeat ----
    await expect(page.getByTestId('practice-focus-chooser')).toBeVisible();
    await expect(page.getByTestId('practice-focus-steady_pace')).toHaveAttribute('aria-checked', 'true');
  });
});
