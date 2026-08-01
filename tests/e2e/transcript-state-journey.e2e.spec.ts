import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, waitForFeature } from './helpers';

/**
 * #1047 PR-U1 — synthetic authenticated read journey.
 *
 * An authenticated user opens saved sessions whose SERVER-OWNED transcript_state differs, and the detail
 * surface reads the honest state/copy — and the SAME copy after a full reload (proving it is read from the
 * persisted row, not inferred from a transient empty string). Uses the route mock's seeded sessions; no
 * real provider, no migration apply, no transcript mutation.
 *
 * Executed by exact-head CI/Playwright (the authoritative journey runner).
 */
const SEEDED = [
  { id: 'u1-available', title: 'Available take', transcript: 'the practiced opening words', transcript_state: 'available' as const, engine: 'private' as const },
  { id: 'u1-expired', title: 'Expired take', transcript: '', transcript_state: 'expired' as const, engine: 'private' as const },
  { id: 'u1-notcaptured', title: 'No-transcript take', transcript: '', transcript_state: 'not_captured' as const, engine: 'private' as const },
];

async function openDetail(page: import('@playwright/test').Page, id: string) {
  await navigateToRoute(page, `/analytics/${id}`);
  await waitForFeature(page, 'analytics');
  return page.getByTestId('session-detail-transcript');
}

test.describe('#1047 U1 transcript-state read journey (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sessions: SEEDED });
  });

  test('available → renders the transcript, and the same after reload', async ({ page }) => {
    let el = await openDetail(page, 'u1-available');
    await expect(el).toHaveAttribute('data-transcript-state', 'available');
    await expect(el).toContainText('the practiced opening words');

    await page.reload();
    el = page.getByTestId('session-detail-transcript');
    await expect(el).toHaveAttribute('data-transcript-state', 'available');
    await expect(el).toContainText('the practiced opening words');
  });

  test('expired → shows the honest reason (not the removed text) and keeps measurements, before and after reload', async ({ page }) => {
    let el = await openDetail(page, 'u1-expired');
    await expect(el).toHaveAttribute('data-transcript-state', 'expired');
    await expect(el).toContainText('Transcript expired. Your measurements are still available.');
    // Measurements remain visible for an expired transcript.
    await expect(page.getByText('Speaking Pace').first()).toBeVisible();

    await page.reload();
    el = page.getByTestId('session-detail-transcript');
    await expect(el).toHaveAttribute('data-transcript-state', 'expired');
    await expect(el).toContainText('Transcript expired. Your measurements are still available.');
  });

  test('not_captured → shows the honest reason, and the same after reload', async ({ page }) => {
    let el = await openDetail(page, 'u1-notcaptured');
    await expect(el).toHaveAttribute('data-transcript-state', 'not_captured');
    await expect(el).toContainText('No transcript was captured.');

    await page.reload();
    el = page.getByTestId('session-detail-transcript');
    await expect(el).toHaveAttribute('data-transcript-state', 'not_captured');
    await expect(el).toContainText('No transcript was captured.');
  });
});
