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
});
