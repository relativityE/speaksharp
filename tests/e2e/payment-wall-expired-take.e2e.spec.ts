import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { goToApp, mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

// #1863 J1.e and J1.f in a real browser: the real App, router, auth provider, TrialServiceBoundary and recorder.
// Only the server is mocked (the in-page Supabase double): its entitlement answer and the save RPC's refusal are set
// exactly as the database answers once an unpaid trial has ended. No real account, payment or Stripe call is involved.
type E2EWindow = Window & {
  __E2E_USAGE_LIMIT_1863__?: Record<string, unknown>;
  __E2E_RPC_ANSWER_1863__?: Record<string, { data: unknown; error: unknown }>;
  __E2E_RPC_CALLS_1476__?: Record<string, number>;
  queryClient?: {
    invalidateQueries: (filters: { queryKey: unknown[] }) => Promise<void>;
    getQueryCache: () => { findAll: (filters: { queryKey: unknown[] }) => Array<{ state: { data?: { can_start?: boolean } } }> };
  };
};

const EXPIRED = { can_start: false, trial_active: false, error: 'trial_expired', trial_seconds_remaining: 0 };

/** Every cached entitlement answer on the page says access is refused. */
async function waitForRefusedEntitlement(page: Page) {
  await page.waitForFunction(() => {
    const answered = ((window as E2EWindow).queryClient?.getQueryCache().findAll({ queryKey: ['usageLimit'] }) ?? [])
      .filter((q) => q.state.data !== undefined);
    return answered.length > 0 && answered.every((q) => q.state.data?.can_start === false);
  }, undefined, { timeout: 10_000 });
}

test.describe('#1863 payment wall in the browser', () => {
  test('J1.f: an expired unpaid user meets the wall on product pages and can still reach deletion and billing', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: EXPIRED });

    // goToApp, not navigateToRoute: the route helper waits for the page's own content, which the wall replaces.
    for (const route of ['/practice', '/session', '/progress']) {
      await goToApp(page, route);
      const wall = page.getByTestId('trial-payment-wall');
      await expect(wall).toBeVisible();
      await expect(wall.getByRole('heading', { name: 'Your free trial has ended' })).toBeVisible();
      await expect(page.getByTestId('practice-root')).toHaveCount(0);
      await expect(page.getByTestId('session-page')).toHaveCount(0);
      await expect(page.getByTestId('analytics-dashboard')).toHaveCount(0);
    }

    // The wall's own link opens the deletion page, and the wall does not follow the user there.
    await page.getByTestId('trial-payment-wall').getByRole('link', { name: 'Delete account' }).click();
    await expect(page.getByTestId('account-deletion-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);

    // Account and pricing stay outside the wall, and actually render.
    await navigateToRoute(page, '/account');
    await expect(page.getByTestId('account-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);
    await navigateToRoute(page, '/pricing');
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);
  });

  test('J1.e: a take cut off when the trial ends says "not saved", and Delete account still opens deletion', async ({ page }) => {
    // The trial is active with an hour left, so the take starts while the server confirms access and the page's
    // own deadline cannot fire during the test.
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: { can_start: true, trial_active: true, trial_seconds_remaining: 3600 } });
    await navigateToRoute(page, '/session');
    await startRecording(page);
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('recorder-stop')).toBeVisible();

    // The trial ends mid-take. The server now refuses access and refuses the save, as the database does, and the page
    // asks the server again (as its recheck timer would), so the boundary sees the refusal while the take is live.
    await page.evaluate(async (expired) => {
      const win = window as E2EWindow;
      win.__E2E_USAGE_LIMIT_1863__ = expired;
      win.__E2E_RPC_ANSWER_1863__ = { complete_session_v2: { data: { success: false, error: 'trial_expired' }, error: null } };
      await win.queryClient?.invalidateQueries({ queryKey: ['usageLimit'] });
    }, EXPIRED);
    await waitForRefusedEntitlement(page);

    // The refusal is known, yet the page is kept for the live take: the wall must not cut the recorder off mid-take.
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING');
    await expect(page.getByTestId('session-page')).toBeVisible();
    await expect(page.getByTestId('recorder-stop')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);

    // Past the 5 s minimum, so the stop really asks the server to save the take (a shorter take is discarded unsent).
    await page.waitForTimeout(5_200);
    const savesBefore = await page.evaluate(() => (window as E2EWindow).__E2E_RPC_CALLS_1476__?.complete_session_v2 ?? 0);
    await stopRecording(page);
    await expect.poll(
      () => page.evaluate(() => (window as E2EWindow).__E2E_RPC_CALLS_1476__?.complete_session_v2 ?? 0),
      { timeout: 15_000 },
    ).toBeGreaterThan(savesBefore);

    // Once the take ends unsaved, the wall replaces the page and says so.
    const wall = page.getByTestId('trial-payment-wall');
    await expect(wall).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('trial-take-not-saved')).toHaveText(
      'The recording in progress when your free trial ended was not saved.',
    );
    await expect(page.getByTestId('session-page')).toHaveCount(0);

    await wall.getByRole('link', { name: 'Delete account' }).click();
    await expect(page.getByTestId('account-deletion-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);
  });
});
