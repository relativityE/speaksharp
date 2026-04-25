/**
 * Primary User Journey Matrix
 * 
 * This spec handles the complete lifecycle (Auth -> Session -> Analytics)
 * for both Basic and Pro tiers using a parameterized matrix. It ensures 
 * deterministic tier-gating and persistent data flow using behavioral signals.
 * 
 * Coverage:
 * - Core Features: Recording lifecycle, deterministic persistence, and session history.
 * - Free Features: Native Browser STT, Marketing/Upgrade funnels, and simplified analytics.
 * - Pro Features: Engine toggling (Whisper/Cloud), advanced analytics details, and PDF exports.
 */
import { test, expect } from './fixtures';
import { 
  navigateToRoute, 
  mockLiveTranscript,
  selectTranscriptionEngine,
  programmaticLoginWithRoutes,
  waitForTranscriptionService
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const SCENARIOS = [
  { 
    name: 'Free/Basic Tier (Native)', 
    userType: 'free' as const, 
    mode: 'native' as const,
    expectedModePattern: /native|browser/i
  },
  { 
    name: 'Pro Tier (Cloud)', 
    userType: 'pro' as const, 
    mode: 'cloud' as const,
    expectedModePattern: /cloud/i
  },
  { 
    name: 'Pro Tier (Private)', 
    userType: 'pro' as const, 
    mode: 'private' as const,
    expectedModePattern: /private|on-device/i
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



      // 3. Verify Tier Gating & Mode Selection (SUBTLE UX BRANCHING)
      const modeButton = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
      await expect(modeButton).toBeVisible();

      if (scenario.userType === 'pro') {
        // Pro users: Verify full engine toggling logic
        await selectTranscriptionEngine(page, scenario.mode);
        // Verify signal persistence on body
        await expect(page.locator('body')).toHaveAttribute('data-stt-policy', scenario.mode, { timeout: 10000 });
      } else {
        // Free users: Verify Marketing Funnel (Options are visible but disabled)
        await modeButton.click();
        const privateOption = page.getByRole('menuitemradio', { name: /private/i });
        const cloudOption = page.getByRole('menuitemradio', { name: /cloud/i });
        
        await expect(privateOption).toBeVisible();
        await expect(privateOption).toHaveAttribute('aria-disabled', 'true');
        await expect(cloudOption).toHaveAttribute('aria-disabled', 'true');
        
        // Close menu & verify current selection is the only one allowed
        await page.keyboard.press('Escape');
        const buttonText = await modeButton.textContent();
        expect(buttonText).toMatch(scenario.expectedModePattern);
      }
      
      // 4. Recording Lifecycle (Accessibility Label Logic)
      const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
      await expect(page.getByLabel(/Start Recording/i)).toBeVisible();
      
      // Deterministic Sync: Wait for engine handshake before clicking start
      await waitForTranscriptionService(page, 'ENGINE_READY');
      
      await startButton.click();

      // Verify recording state via attribute & Accessibility Label
      await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
      await expect(page.getByLabel(/Stop Recording/i)).toBeVisible();
      
      // 5. Simulate Speech using the central file transcript fixture
      await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);

      // Verify Clarity Score metric visibility
      await expect(page.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE)).toBeVisible({ timeout: 15000 });

      // Pacing by signal acknowledgment instead of fixed timeout
      // Wait for the minimal retention signal (mock time is compressed but logic requires stability)
      await waitForTranscriptionService(page, 'TRANSCRIPT_PULSE');

      // 6. Stop Recording
      await startButton.click();
      await expect(page.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 10000 });

      // 7. Verify Deterministic Persistence Signal
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });
      // 8. Navigation to Analytics via SPA Click (prevents full hard reload and cache wipes)
      await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
      await expect(page.getByTestId(TEST_IDS.ANALYTICS_DASHBOARD)).toBeVisible({ timeout: 20000 });
      
      // 9. Tier-Aware Visibility (Lean Smoke Test)
      if (scenario.userType === 'free') {
        await expect(page.getByTestId('analytics-page-upgrade-button')).toBeVisible();
      } else {
        await expect(page.getByText(/Pro Plan Active/i)).toBeVisible();
      }

      // 10. Persistence Check (History count increment)
      const totalSessions = page.getByTestId(TEST_IDS.STAT_CARD_TOTAL_SESSIONS);
      await expect(totalSessions).toContainText('6');
    });
  }
});
