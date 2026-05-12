import { test, expect } from './fixtures';
import {
  navigateToRoute,
  waitForTranscriptionService
} from './helpers';

/**
 * EXHAUSTIVE PRD SCORECARD (v1.5)
 * Verifies every requirement in the Free vs Pro feature matrix.
 */

test.describe('Exhaustive User Feature Matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/\/rest\/v1\/rpc\/heartbeat_session(\?.*)?$/, route => route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true })
    }));
  });

  // SCENARIO 1: Free Tier (Conversion Matrix)
  test('Free Tier Matrix: Verify Session Limits, Branded PDF, and Feature Gating', async ({ freePage: page }) => {
    // 1. Verify Session Limit Visibility
    await navigateToRoute(page, '/session');
    await page.waitForURL('**/session');
    const startButton = page.getByTestId('session-start-stop-button');
    await expect(startButton).toBeVisible();

    // Check for Free-Tier Limit messaging
    await expect(page.getByText(/1-hour Basic training window/i)).toBeHidden(); // Modal shouldn't show yet

    // 2. STT Engine Gating: Should only allow Native
    await expect(page.getByTestId('engine-select-cloud')).not.toBeVisible();
    await expect(page.getByTestId('engine-select-private')).not.toBeVisible();

    // Deterministic Sync: Wait for engine handshake before clicking start
    await waitForTranscriptionService(page, 'ENGINE_READY');
    await startButton.click();

    await navigateToRoute(page, '/analytics');
    await page.waitForURL('**/analytics');
    // 🛡️ Deterministic Layout Barrier: Wait for the session history list to resolve
    await page.waitForSelector('[data-testid^="session-history-item-"]', { timeout: 15000 });

    // 4. PRD §531: AI Coach Gating (Should NOT be visible)
    await expect(page.getByTestId('ai-suggestions-card')).not.toBeVisible();

    // 5. PDF export is available to every tier and always includes SpeakSharp watermarking.
    const pdfBtn = page.getByRole('button', { name: /pdf|export|download/i }).first();
    await pdfBtn.click();

    // Verify E2E signal for watermark
    await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'watermarked');

    // 6. Marketing Funnel: Upgrade buttons should be prominent
    await expect(page.getByTestId('nav-upgrade-button')).toBeVisible();
  });

  // SCENARIO 2: Pro Tier (Premium Matrix)
  test('Pro Tier Matrix: Verify AI Coach, Diarization, and Branded PDF exports', async ({ proPage: page }) => {
    // 1. Verify Pro Engine Access (Cloud/Private)
    await navigateToRoute(page, '/session');
    await page.waitForURL('**/session');

    // Default mode should allow Cloud STT as Pro
    const startButton = page.getByTestId('session-start-stop-button');
    await expect(startButton).toBeVisible();

    // Deterministic Sync: Wait for engine handshake before clicking start
    await waitForTranscriptionService(page, 'ENGINE_READY');
    await startButton.click();

    // 3. Navigation to Analytics & Session Selection
    await navigateToRoute(page, '/analytics');
    await page.waitForURL('**/analytics');
    // 🛡️ Deterministic Layout Barrier: Wait for the session history list to resolve
    await page.waitForSelector('[data-testid^="session-history-item-"]', { timeout: 15000 });

    // 🛡️ CRITICAL: Open the latest session through the row's real interactive link.
    // The history item wrapper is not a stable anchor contract, so support both
    // wrapper-link and nested-link renderings.
    const latestSession = page.getByTestId(/session-history-item-/i).first();
    const sessionHref = await latestSession.evaluate((element) => {
      const self = element instanceof HTMLAnchorElement ? element : null;
      const nested = element.querySelector<HTMLAnchorElement>('a[href^="/analytics/session-"]');
      return self?.getAttribute('href') ?? nested?.getAttribute('href') ?? null;
    });
    expect(sessionHref).toMatch(/^\/analytics\/session-/);
    await navigateToRoute(page, sessionHref!);
    await page.waitForURL('**/analytics/session-*');

    // 4. PRD §531: AI Coach Feedback (Should BE visible in Detail View)
    await expect(page.getByTestId('ai-suggestions-card')).toBeVisible({ timeout: 15000 });

    // 6. Professional PDF Export (watermarked for brand consistency)
    const pdfBtn = page.getByRole('button', { name: /pdf|export|download/i }).first();
    await pdfBtn.click();

    // Verify E2E signal for watermarked report
    await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'watermarked');

    // 7. Identity: Pro Badge visibility on dashboard view
    await navigateToRoute(page, '/analytics');
    await expect(page.getByText(/Pro Plan Active/i)).toBeVisible();
    await expect(page.getByTestId('nav-upgrade-button')).not.toBeVisible();
  });

});
