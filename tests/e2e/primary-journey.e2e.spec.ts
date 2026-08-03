/**
 * Primary User Journey Matrix — #1120 S1 (PR #1155) launch state.
 *
 * Full lifecycle (Auth → Session → Analytics) for Free and Pro tiers. Cloud is globally OFF and
 * customer-invisible: it is never a selectable mode, never appears in the picker, and is never contacted
 * (zero Cloud token/provider/network request) across the whole journey. Launch hierarchy is forced ON via
 * the bounded E2E override so Private is the Pro default; a Free user (no Private entitlement) uses Browser.
 */
import { test, expect } from './fixtures';
import type { Page, Request } from '@playwright/test';
import {
  navigateToRoute,
  mockLiveTranscript,
  selectTranscriptionEngine,
  programmaticLoginWithRoutes,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS_WITH_FILLERS } from './fixtures/mockData';

const CLOUD_HOSTS = /assemblyai\.com|assemblyai-token|\/functions\/v1\/assemblyai/i;
function trackCloudRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r: Request) => { if (CLOUD_HOSTS.test(r.url())) hits.push(r.url()); });
  return hits;
}

const SCENARIOS = [
  { name: 'Free Tier (Browser)', userType: 'free' as const, mode: 'native' as const, expectedModePattern: /browser/i },
  { name: 'Pro Tier (Private launch)', userType: 'pro' as const, mode: 'private' as const, expectedModePattern: /private|on-device/i },
];

test.describe('Primary User Journey Matrix (Cloud absent + unreachable)', () => {
  for (const scenario of SCENARIOS) {
    test(`should complete full journey for ${scenario.name}`, async ({ page }) => {
      const cloudHits = trackCloudRequests(page);
      // Launch hierarchy ON (Private-primary). Free users still resolve to Browser (no Private entitlement).
      await programmaticLoginWithRoutes(page, { userType: scenario.userType, sttPrivatePrimary: true });

      await navigateToRoute(page, '/session');
      await expect(page.getByText(/Practice Session/i)).toBeVisible();

      const modeButton = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
      await expect(modeButton).toBeVisible();

      if (scenario.userType === 'pro') {
        // Pro: Private is the launch default. Selecting it is honored; Cloud is not a choice.
        await selectTranscriptionEngine(page, scenario.mode);
        await expect(modeButton).toHaveAttribute('data-state', scenario.mode, { timeout: 10000 });
        // Cloud is absent from the picker entirely.
        await modeButton.click();
        await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);
        await expect(page.getByRole('menuitemradio', { name: /cloud/i })).toHaveCount(0);
        await page.keyboard.press('Escape');
      } else {
        // Free: Browser is the resolved default; Private is present (entitlement-gated); Cloud is ABSENT.
        await modeButton.click();
        await expect(page.getByRole('menuitemradio', { name: /private/i })).toBeVisible();
        await expect(page.getByRole('menuitemradio', { name: /cloud/i })).toHaveCount(0);
        await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);
        await page.keyboard.press('Escape');
        const buttonText = await modeButton.textContent();
        expect(buttonText).toMatch(scenario.expectedModePattern);
      }

      // Recording lifecycle.
      const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
      await expect(page.getByLabel(/Start Recording/i)).toBeVisible();
      await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15000 });
      await startButton.click();
      await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
      await expect(page.getByLabel(/Stop Recording/i)).toBeVisible();

      await mockLiveTranscript(page, MOCK_TRANSCRIPTS_WITH_FILLERS as unknown as string[]);
      await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).not.toContainText('Listening...');
      await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(/simulating multiple lines/i);
      await expect(page.getByTestId('filler-words-card')).toHaveAttribute('data-filler-state', 'counts', { timeout: 15000 });
      await expect(page.getByTestId('filler-words-list')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE)).not.toHaveText('', { timeout: 15000 });

      await page.waitForTimeout(5200);
      await startButton.click();
      await expect(page.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 10000 });

      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-session-persisted', 'true', { timeout: 15000 });
      await navigateToRoute(page, '/analytics');

      if (scenario.userType === 'free') {
        await expect(page.getByTestId('analytics-page-upgrade-button')).toHaveCount(0);
      } else {
        await expect(page.getByText(/Pro active/i)).toBeVisible();
      }

      await page.getByTestId('analytics-focus-trigger').click();
      await page.getByText('Track Progress').click();
      await expect(page.getByTestId(TEST_IDS.STAT_CARD_TOTAL_SESSIONS)).toContainText('6');

      // Cloud was never contacted anywhere in the journey.
      expect(cloudHits, `no Cloud requests allowed: ${cloudHits.join(',')}`).toEqual([]);
    });
  }
});
