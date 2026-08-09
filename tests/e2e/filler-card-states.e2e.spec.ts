/**
 * #1047/#1231 — the filler evidence surface, proven end to end on the new session page.
 *
 * The legacy `filler-words-card` before/zero/counts `data-filler-state` STATE MACHINE (thirteen `0` chips,
 * two empty messages, the #894 disclosure) is RETIRED with the page overhaul. The after-state now carries a
 * lean `FillerBreakdown` (#1231 R2): before a take there is no filler surface at all (so it can never make a
 * claim it has not earned), and once a session is recorded the breakdown either shows the ranked per-word
 * counts (`filler-breakdown-list` / `filler-breakdown-word` / `filler-breakdown-count`) or the honest empty
 * state (`filler-breakdown-empty`).
 *
 * These specs pin the two states that carry a RESULT claim — a completed take with no fillers, and one with
 * real fillers — plus the invariant that nothing is claimed before a take.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  navigateToRoute,
  mockLiveTranscript,
  programmaticLoginWithRoutes,
  startRecording,
  stopRecording,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS, MOCK_TRANSCRIPTS_WITH_FILLERS } from './fixtures/mockData';

async function recordAndStop(page: Page, lines: readonly string[]) {
  await startRecording(page);
  await mockLiveTranscript(page, lines as unknown as string[]);
  await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).not.toContainText('Listening...');
  await page.waitForTimeout(5200); // clear the sub-5s no-persist guard
  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });
}

test.describe('#1047/#1231 filler breakdown states', () => {
  test('before recording: no filler surface is shown (no premature/zero claim)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    // The before-state is the mic card; the filler breakdown (and its custom-word manager) belong to the
    // after-state, so nothing about fillers is claimed before a take has happened.
    await expect(page.getByTestId(TEST_IDS.MIC_CARD)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('filler-breakdown')).toHaveCount(0);
    await expect(page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON)).toHaveCount(0);

    // The retired zero-grid empty messages must not appear either.
    await expect(page.getByText(/No filler words detected yet/i)).toHaveCount(0);
    await expect(page.getByText(/cannot be verified yet/i)).toHaveCount(0);
  });

  test('completed with ZERO fillers: after-state shows the honest empty breakdown', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    // MOCK_TRANSCRIPTS deliberately contains none of the tracked filler words.
    await recordAndStop(page, MOCK_TRANSCRIPTS);

    await expect(page.getByTestId('filler-breakdown')).toBeVisible({ timeout: 15000 });
    // A RESULT, not a promise of one — the empty breakdown states there were no fillers this session.
    await expect(page.getByTestId('filler-breakdown-empty'))
      .toContainText('No filler words detected this session.');

    // The ranked list stays absent: there is no evidence to show.
    await expect(page.getByTestId('filler-breakdown-list')).toHaveCount(0);
    await expect(page.getByTestId('filler-breakdown-word')).toHaveCount(0);
    // The custom-word manager stays available in the after-state.
    await expect(page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON)).toBeVisible();
  });

  test('completed WITH fillers: after-state ranks only the words that occurred', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    // This fixture carries real tracked fillers, so the breakdown is driven by genuine evidence.
    await recordAndStop(page, MOCK_TRANSCRIPTS_WITH_FILLERS);

    await expect(page.getByTestId('filler-breakdown')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('filler-breakdown-list')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('filler-breakdown-empty')).toHaveCount(0);

    // Only detected words are listed, and every count is a real positive number — nothing sits at zero.
    const words = page.getByTestId('filler-breakdown-word');
    const wordCount = await words.count();
    expect(wordCount).toBeGreaterThan(0);
    const counts = page.getByTestId('filler-breakdown-count');
    for (let i = 0; i < wordCount; i++) {
      await expect(counts.nth(i)).not.toHaveText('×0');
    }

    await expect(page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON)).toBeVisible();
  });
});
