/**
 * PR 1a — recovery-draft / transcript state correctness.
 *
 * Contract: after a SUCCESSFUL save, the "unsaved transcript draft" banner
 * (`session-recovery-actions`) must NOT appear — even after waiting past the
 * ~2s recovery-draft heartbeat, and even after re-mounting SessionPage. A false
 * "unsaved draft" banner after a save implies data loss / failed persistence to
 * the user, which is a high-trust-impact regression.
 *
 * This spec is the runtime before/after proof for the false-unsaved-banner fix.
 */
import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, programmaticLoginWithRoutes, selectTranscriptionEngine } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const RECOVERY_BANNER = 'session-recovery-actions';

test.describe('Session recovery draft', () => {
  test('no false unsaved-draft banner after a successful save', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/session');
    await expect(page.getByText(/Practice Session/i)).toBeVisible();

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15000 });

    // Record a >=5s session so it is persisted (sub-5s sessions are intentionally not saved).
    await startButton.click();
    await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(/simulating multiple lines/i);
    await page.waitForTimeout(5200);

    // Stop -> triggers save.
    await startButton.click();
    await expect(page.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 10000 });

    // Deterministic persistence signal: the session write path completed.
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });

    // Wait past the App-level recovery-draft heartbeat (2000ms) to expose any
    // re-persist / not-cleared race.
    await page.waitForTimeout(2600);

    // CONTRACT 1: no false unsaved-draft banner on the post-save session view.
    await expect(page.getByTestId(RECOVERY_BANNER)).toHaveCount(0);

    // CONTRACT 2: it must not resurrect on a fresh SessionPage mount either
    // (the recovery effect re-reads localStorage on mount).
    await navigateToRoute(page, '/analytics');
    await navigateToRoute(page, '/session');
    await expect(page.getByText(/Practice Session/i)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByTestId(RECOVERY_BANNER)).toHaveCount(0);
  });

  // Issue B: a prior session's transcript must not carry into a new mode after an STT mode switch.
  test('does not carry a stale transcript across an STT mode switch', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await expect(page.getByText(/Practice Session/i)).toBeVisible();

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15000 });

    // Record + persist a session in the default mode, producing a visible transcript.
    await startButton.click();
    await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(/simulating multiple lines/i);
    await page.waitForTimeout(5200);
    await startButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });

    // Switch STT mode -> the prior transcript must NOT be carried into the new mode/session.
    await selectTranscriptionEngine(page, 'cloud');
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).not.toContainText(/simulating multiple lines/i);
  });
});
