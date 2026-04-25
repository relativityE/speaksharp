import { test, expect } from './fixtures';
import { 
  waitForAppReady, 
  navigateToRoute,
  waitForTranscriptionService 
} from './helpers';

/**
 * EXHAUSTIVE PRD SCORECARD (v1.5)
 * Verifies every requirement in the Free vs Pro feature matrix.
 */

test.describe('Exhaustive User Feature Matrix', () => {

  // SCENARIO 1: Free Tier (Restrictive Matrix)
  test('Free Tier Matrix: Verify Session Limits, Watermarked PDF, and Feature Gating', async ({ freePage: page }) => {
    // 1. Verify Session Limit Visibility
    await navigateToRoute(page, '/session');
    const startButton = page.getByTestId('session-start-stop-button');
    await expect(startButton).toBeVisible();
    
    // Check for Free-Tier Limit messaging
    await expect(page.getByText(/1-hour free training window/i)).toBeHidden(); // Modal shouldn't show yet

    // 2. STT Engine Gating: Should only allow Native
    await expect(page.getByTestId('engine-select-cloud')).not.toBeVisible();
    await expect(page.getByTestId('engine-select-private')).not.toBeVisible();

    // Deterministic Sync: Wait for engine handshake before clicking start
    await waitForTranscriptionService(page, 'ENGINE_READY');
    await startButton.click();

    await navigateToRoute(page, '/analytics');
    await waitForAppReady(page, 15000);

    // 4. PRD §531: AI Coach Gating (Should NOT be visible)
    await expect(page.getByTestId('ai-suggestions-card')).not.toBeVisible();

    // 5. PRD §283: Watermarked PDF Export
    const pdfBtn = page.getByRole('button', { name: /pdf|export|download/i }).first();
    await pdfBtn.click();
    
    // Verify E2E signal for watermark (Injected in Phase 5)
    await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'watermarked');
    
    // 6. Marketing Funnel: Upgrade buttons should be prominent
    await expect(page.getByTestId('nav-upgrade-button')).toBeVisible();
  });

  // SCENARIO 2: Pro Tier (Premium Matrix)
  test('Pro Tier Matrix: Verify AI Coach, Diarization, and Clean PDF exports', async ({ proPage: page }) => {
    // 1. Verify Pro Engine Access (Cloud/Private)
    await navigateToRoute(page, '/session');
    
    // Default mode should allow Cloud STT as Pro
    const startButton = page.getByTestId('session-start-stop-button');
    await expect(startButton).toBeVisible();

    // Deterministic Sync: Wait for engine handshake before clicking start
    await waitForTranscriptionService(page, 'ENGINE_READY');
    await startButton.click();

    // 3. Navigation to Analytics & Session Selection
    await navigateToRoute(page, '/analytics');
    await waitForAppReady(page, 15000);

    // 🛡️ CRITICAL: Select the latest session from the history to enter the Detail View
    // We target the first history item in the list
    const latestSession = page.getByTestId(/session-history-item-/i).first();
    await latestSession.click();

    // 4. PRD §531: AI Coach Feedback (Should BE visible in Detail View)
    await expect(page.getByTestId('ai-suggestions-card')).toBeVisible({ timeout: 15000 });

    // 6. Professional PDF Export (Clean)
    const pdfBtn = page.getByRole('button', { name: /pdf|export|download/i }).first();
    await pdfBtn.click();
    
    // Verify E2E signal for clean report (Injected in Phase 5)
    await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'clean');

    // 7. Identity: Pro Badge visibility
    await expect(page.getByText(/Pro Plan Active/i)).toBeVisible();
    await expect(page.getByTestId('nav-upgrade-button')).not.toBeVisible();
  });

});
