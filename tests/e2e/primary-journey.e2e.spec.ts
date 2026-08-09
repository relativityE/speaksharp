/**
 * Primary User Journey Matrix
 * 
 * This spec handles the complete lifecycle (Auth -> Session -> Analytics)
 * for both Free and Pro tiers using a parameterized matrix. It ensures 
 * deterministic tier-gating and persistent data flow using behavioral signals.
 * 
 * Coverage:
 * - Core Features: Recording lifecycle, deterministic persistence, and session history.
 * - Free Features: Marketing/Upgrade funnels and simplified analytics.
 * - Pro Features: advanced analytics details and PDF exports.
 *
 * #1184: Private is the ONLY engine for every tier — the former engine-toggling / Cloud-Pro-gating /
 * Free-native branch is gone. Both tiers run the identical Private recording path; they differ only on
 * usage minutes, upgrade funnels, and analytics detail. The matrix keeps one Free and one Pro scenario.
 */
import { test, expect } from './fixtures';
import {
  navigateToRoute,
  mockLiveTranscript,
  selectTranscriptionEngine,
  programmaticLoginWithRoutes,
  startRecording,
  stopRecording,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS_WITH_FILLERS } from './fixtures/mockData';

const SCENARIOS = [
  {
    name: 'Free Tier (Private)',
    userType: 'free' as const,
  },
  {
    name: 'Pro Tier (Private)',
    userType: 'pro' as const,
  }
];

test.describe('Primary User Journey Matrix', () => {
  for (const scenario of SCENARIOS) {
    test(`should complete full journey for ${scenario.name}`, async ({ page }) => {
      // 1. Boot explicitly for the tier (preventing Playwright fixture-overlap contamination)
      await programmaticLoginWithRoutes(page, { userType: scenario.userType });

      // 2. Navigation & Boot (Visual Heartbeat Signal)
      await navigateToRoute(page, '/session');
      await expect(page.getByText(/Practice Session/i)).toBeVisible();



      // 3. Verify the engine surface: Private is the only engine for every tier — there is no selector
      // on the new session page; the recorder surface (mic card) IS the confirmation. (#1184/#1222)
      await selectTranscriptionEngine(page, 'private');
      await expect(page.getByTestId(TEST_IDS.MIC_CARD)).toBeVisible();

      // 4. Recording Lifecycle (#1231): start (before-state `mic-start`) and stop (during-state
      // `recorder-stop`) are split — no single toggle, no `data-recording` attribute. `startRecording`
      // waits for the model + the RECORDING runtime signal.
      await startRecording(page);

      // 5. Simulate Speech using the central file transcript fixture. This fixture carries real tracked
      // fillers so the after-state per-word breakdown (below) is driven by genuine evidence.
      await mockLiveTranscript(page, MOCK_TRANSCRIPTS_WITH_FILLERS as unknown as string[]);

      // The live transcript renders the streamed words (#1222 slot B → `live-transcript`).
      await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText(/simulating multiple lines/i);

      // The product intentionally refuses to persist sub-5-second sessions.
      // Keep this proof aligned with the user-facing save contract instead of
      // expecting persistence from an invalidly short recording.
      await page.waitForTimeout(5200);

      // 6. Stop Recording → the review (after) state.
      await stopRecording(page);

      // 7. Verify Deterministic Persistence Signal
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });

      // #1231 R2: the retired `filler-words-card` state machine is replaced by the after-state
      // `FillerBreakdown` — a ranked per-word list. The fixture produced real fillers, so the list shows.
      await expect(page.getByTestId('filler-breakdown')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('filler-breakdown-list')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('filler-breakdown-word').first()).toBeVisible({ timeout: 15000 });
      // 8. Navigation to Analytics through the canonical route helper. The
      // persistence signal above proves the session write path completed; this
      // avoids racing the route-transition shell under parallel workers.
      await navigateToRoute(page, '/analytics');

      // 9. Tier-Aware Visibility (Lean Smoke Test)
      if (scenario.userType === 'free') {
        // In test/non-live Stripe mode, checkout surfaces must stay hidden so
        // Free users do not see dead upgrade buttons.
        await expect(page.getByTestId('analytics-page-upgrade-button')).toHaveCount(0);
      } else {
        await expect(page.getByText(/Pro active/i)).toBeVisible();
      }

      // 10. Persistence Check (History count increment)
      await page.getByTestId('analytics-focus-trigger').click();
      await page.getByText('Track Progress').click();
      const totalSessions = page.getByTestId(TEST_IDS.STAT_CARD_TOTAL_SESSIONS);
      await expect(totalSessions).toContainText('6');
    });
  }
});
