import { test, expect, type Page } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { eligibleProgressTruth } from './helpers/progressFixtures';
import { TEST_USER_ID } from '../../frontend/src/mocks/test-user-utils';

/**
 * Outcome 4, first increment — the repeat shows what it repeated. Mocked Supabase (the existing progress fixtures; no
 * harness change). Original A (session-4), its linked repeat B (session-5) and a NEWER unrelated session C (session-6).
 * The repeat's Progress page links back to A and states the stored before → after; A and C show no block. The block
 * renders outside `progress-panel` with its own `repeat-origin-*` test ids, so nothing AHT-01 reads inside the panel moves.
 */
const ORIGINAL_ID = 'session-4';
const REFERENCE_ID = 'session-3';
const REPEAT_ID = 'session-5';
const UNRELATED_LATEST_ID = 'session-6';

const savedSession = (id: string, createdAt: string, words: number, fillers: number) => ({
  id, user_id: TEST_USER_ID, created_at: createdAt,
  duration: 420, total_words: words, engine: 'private', clarity_score: 88, wpm: 142,
  status: 'completed', product: 'open_mic', transcript_state: 'available',
  transcript: 'The price includes onboarding and support.', filler_counts: fillers ? { um: fillers } : {},
  ai_suggestions: { version: 'gemini_coaching_v1', what_worked: 'Clear opening.', what_to_try_next: 'Name the price first.' },
});

async function seed(page: Page, attempt: Record<string, unknown>): Promise<void> {
  const progress = eligibleProgressTruth(ORIGINAL_ID, REFERENCE_ID);
  Object.assign(progress.recommendations[0], { user_id: TEST_USER_ID, source_metric_value: (4 / 245) * 100 });
  progress.evaluations.push(
    { ...progress.evaluations[0], session_id: REPEAT_ID, filler_count: 2, word_count: 250, baseline_session_id: REFERENCE_ID, previous_comparable_session_id: ORIGINAL_ID },
    { ...progress.evaluations[0], session_id: UNRELATED_LATEST_ID, filler_count: 0, word_count: 300, baseline_session_id: REFERENCE_ID, previous_comparable_session_id: REPEAT_ID },
  );
  progress.attempts = [{
    id: 'attempt-outcome4', recommendation_id: 'recommendation-u3', user_id: TEST_USER_ID,
    accepted_at: '2025-01-17T14:01:00.000Z', practice_session_id: REPEAT_ID, ...attempt,
  }];
  await programmaticLoginWithRoutes(page, {
    userType: 'free', progressFixtures: progress,
    sessions: [
      savedSession(ORIGINAL_ID, '2025-01-17T14:00:00.000Z', 245, 4),
      savedSession(REPEAT_ID, '2025-01-17T15:00:00.000Z', 250, 2),
      savedSession(UNRELATED_LATEST_ID, '2025-01-17T16:00:00.000Z', 300, 0),
    ],
  });
}

/** Wait until the page's own Progress panel has settled, so "no block" is read after the block's read had its chance. */
async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId('progress-panel')).toBeVisible();
  await expect(page.getByTestId('progress-loading')).toHaveCount(0);
}

test.describe('outcome 4: the repeat shows what it repeated', () => {
  test('the repeat links to its original with the stored before → after, after reload too; the original and a newer unrelated session show none', async ({ page }) => {
    await seed(page, { lifecycle: 'completed', outcome: 'moved', next_comparable_session_id: REPEAT_ID });
    await navigateToRoute(page, `/progress/${REPEAT_ID}`);
    for (const reopening of [false, true]) {
      if (reopening) await page.reload();
      const block = page.getByTestId('repeat-origin');
      await expect(block).toBeVisible();
      await expect(block).toHaveCount(1);
      // Rendered beside the panel, never inside it.
      await expect(page.getByTestId('progress-panel').getByTestId('repeat-origin')).toHaveCount(0);
      const link = page.getByTestId('repeat-origin-link');
      await expect(link).toHaveText(/^Repeat of your \d{1,2} Jan, \d{2}:\d{2} session$/);
      await expect(link).toHaveAttribute('href', `/progress/${ORIGINAL_ID}`);
      await expect(page.getByTestId('repeat-origin-values'))
        .toHaveText('Filler rate: 1.6 → 0.8 percent of words (original session → this repeat).');
      await expect(page.getByTestId('repeat-origin-outcome'))
        .toHaveText('Filler rate was lower on the repeat than in the original session.');
      await expect(page.getByTestId('repeat-origin-scope'))
        .toHaveText('This comparison measures delivery, not whether the coaching tip was followed.');
      await expect(block).not.toContainText(/improv|reached|caused|because of/i);
      await expect(page.getByTestId('repeat-origin-error')).toHaveCount(0);
    }

    // The original keeps its own stored result in the panel, exactly as before, and is not itself a repeat.
    await page.getByTestId('repeat-origin-link').click();
    await expect(page).toHaveURL(new RegExp(`/progress/${ORIGINAL_ID}$`));
    await settled(page);
    await expect(page.getByTestId('progress-attempt-values'))
      .toHaveText('Filler rate: 1.6 → 0.8 percent of words (original session → linked repeat).');
    await expect(page.getByTestId('repeat-origin')).toHaveCount(0);
    await expect(page.getByTestId('repeat-origin-error')).toHaveCount(0);

    await navigateToRoute(page, `/progress/${UNRELATED_LATEST_ID}`);
    await settled(page);
    await expect(page.getByTestId('repeat-origin')).toHaveCount(0);
    await expect(page.getByTestId('repeat-origin-error')).toHaveCount(0);
  });

  test('a repeat that could not be compared links back and says so, with no numbers', async ({ page }) => {
    await seed(page, { lifecycle: 'not_comparable', outcome: 'not_comparable', next_comparable_session_id: null });
    await navigateToRoute(page, `/progress/${REPEAT_ID}`);
    await expect(page.getByTestId('repeat-origin-link')).toHaveAttribute('href', `/progress/${ORIGINAL_ID}`);
    await expect(page.getByTestId('repeat-origin-outcome')).toHaveText('Filler rate could not be compared for this repeat.');
    await expect(page.getByTestId('repeat-origin-values')).toHaveCount(0);
    await expect(page.getByTestId('repeat-origin-scope')).toHaveCount(0);
  });
});
