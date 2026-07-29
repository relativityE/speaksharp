/**
 * #1047 — the filler evidence band's state contract, proven end to end.
 *
 * The card no longer has a single pre-result appearance. It used to render thirteen `0` chips plus two
 * contradictory empty messages in every state before a count existed, which meant the same markup was
 * shown while idle, while recording, mid-decode, and after a take that genuinely found nothing. That
 * is how it came to make claims that were not true at the moment it made them.
 *
 * These specs pin the two states that carry a RESULT claim, because those are the ones where being
 * wrong misleads a user about their own speech:
 *   - a completed take with zero fillers stays COLLAPSED, says so as a result, and carries the #894
 *     disclosure ("Some spoken fillers may not appear in the transcript");
 *   - a completed take WITH fillers expands the grid, driven by a fixture that contains real tracked
 *     filler words rather than by the UI drawing empty chips.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  navigateToRoute,
  mockLiveTranscript,
  programmaticLoginWithRoutes,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS, MOCK_TRANSCRIPTS_WITH_FILLERS } from './fixtures/mockData';

const FILLER_DISCLOSURE = 'Some spoken fillers may not appear in the transcript.';

async function recordAndStop(page: Page, lines: readonly string[]) {
  const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
  await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15000 });
  await startButton.click();
  await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
  await mockLiveTranscript(page, lines as unknown as string[]);
  await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).not.toContainText('Listening...');
  await page.waitForTimeout(5200); // clear the sub-5s no-persist guard
  await startButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });
}

test.describe('#1047 filler card states', () => {
  test('before recording: collapsed, states what is tracked, no zero chips', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    const card = page.getByTestId('filler-words-card');
    await expect(card).toHaveAttribute('data-filler-state', 'before-recording', { timeout: 15000 });
    await expect(page.getByTestId('filler-tracking-summary')).toContainText(/Tracking \d+ filler words/);
    await expect(page.getByTestId('filler-support-text')).toContainText('Counts appear here as you speak.');

    // The dense zero grid is gone, and neither old empty message survives.
    await expect(page.getByTestId('filler-words-list')).toHaveCount(0);
    await expect(page.getByText(/No filler words detected yet/i)).toHaveCount(0);
    await expect(page.getByText(/cannot be verified yet/i)).toHaveCount(0);

    // Addressable by assistive tech even though the visual heading is collapsed, and the action stays.
    await expect(page.getByRole('region', { name: 'Detected filler words' })).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON)).toBeVisible();
  });

  test('completed with ZERO fillers: stays collapsed, states the zero, carries the #894 disclosure', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    // MOCK_TRANSCRIPTS deliberately contains none of the tracked filler words.
    await recordAndStop(page, MOCK_TRANSCRIPTS);

    const card = page.getByTestId('filler-words-card');
    await expect(card).toHaveAttribute('data-filler-state', 'zero-detected', { timeout: 15000 });

    // A RESULT, not a promise of one — and never the pre-recording copy.
    await expect(page.getByTestId('filler-measured-zero'))
      .toContainText('No detected filler words in this transcript.');
    // Scoped to the FILLER CARD. A page-wide query also matches the coaching card's
    // "Coaching updates as you speak." footer, which is unrelated and correct. The contract here is
    // that the filler card stops promising future counts once a take has completed — the user HAS
    // spoken, so "counts appear here as you speak" would be untrue.
    await expect(card.getByText(/as you speak/i)).toHaveCount(0);
    await expect(page.getByTestId('filler-tracking-summary')).toHaveCount(0);

    // #894: an unqualified zero is exactly what a user over-trusts, so the caveat ships with it.
    await expect(page.getByTestId('filler-explanation')).toContainText(FILLER_DISCLOSURE);

    // The grid stays collapsed: there is no evidence to show.
    await expect(page.getByTestId('filler-words-list')).toHaveCount(0);
    await expect(page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON)).toBeVisible();
  });

  test('completed WITH fillers: expands to the grid, showing only words that occurred', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    // This fixture carries real tracked fillers, so the expansion is driven by genuine evidence.
    await recordAndStop(page, MOCK_TRANSCRIPTS_WITH_FILLERS);

    const card = page.getByTestId('filler-words-card');
    await expect(card).toHaveAttribute('data-filler-state', 'counts', { timeout: 15000 });
    await expect(page.getByTestId('filler-words-list')).toBeVisible();

    // Only detected words are chipped — the tracked words sitting at zero are not padding the grid.
    const chips = page.getByTestId('filler-badge-count');
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(0);
    for (let i = 0; i < chipCount; i++) {
      await expect(chips.nth(i)).not.toHaveText('0');
    }

    // The disclosure appears exactly once.
    await expect(page.getByText(FILLER_DISCLOSURE)).toHaveCount(1);
    await expect(page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON)).toBeVisible();
  });
});
