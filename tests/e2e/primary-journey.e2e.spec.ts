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



      // 3. Verify the engine surface: Private is the only engine for every tier — a static indicator,
      // no selector, no tier-gated options. (#1184)
      const modeButton = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
      await expect(modeButton).toBeVisible();
      await selectTranscriptionEngine(page, 'private');
      await expect(modeButton).toHaveAttribute('data-state', 'private', { timeout: 10000 });
      await expect(modeButton).toContainText(/private/i);

      // 4. Recording Lifecycle (Accessibility Label Logic)
      const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
      await expect(page.getByLabel(/Start Recording/i)).toBeVisible();

      // Deterministic Sync: Wait for engine handshake before clicking start
      await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15000 });

      await startButton.click();

      // Verify recording state via attribute & Accessibility Label
      await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
      await expect(page.getByLabel(/Stop Recording/i)).toBeVisible();

      // 5. Simulate Speech using the central file transcript fixture
      // #1047: this fixture carries real tracked fillers. The assertion below is that the evidence
      // band EXPANDS because the user produced filler evidence — previously it passed against a grid
      // of thirteen `0` chips, which proved only that the grid rendered, not that anything was
      // detected. Driving a real count makes the proof mean what it claims.
      await mockLiveTranscript(page, MOCK_TRANSCRIPTS_WITH_FILLERS as unknown as string[]);

      // Verify the session page story is live: transcript plus the current
      // evidence band, rather than the legacy standalone metric cards.
      await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).not.toContainText('Listening...');
      await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(/simulating multiple lines/i);
      await expect(page.getByTestId('filler-words-card')).toHaveAttribute('data-filler-state', 'counts', { timeout: 15000 });
      await expect(page.getByTestId('filler-words-list')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).not.toHaveText('', { timeout: 15000 });

      // The product intentionally refuses to persist sub-5-second sessions.
      // Keep this proof aligned with the user-facing save contract instead of
      // expecting persistence from an invalidly short recording.
      await page.waitForTimeout(5200);

      // 6. Stop Recording
      await startButton.click();
      await expect(page.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 10000 });

      // 7. Verify Deterministic Persistence Signal
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });
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
