import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';

// #1863 J1.e and J1.f in a real browser: the real App, router, auth provider, TrialServiceBoundary and recorder.
// Only the server is mocked (the in-page Supabase double): its entitlement answer and the save RPC's refusal are set
// exactly as the database answers once an unpaid trial has ended. No real account, payment or Stripe call is involved.
type E2EWindow = Window & {
  __E2E_USAGE_LIMIT_1863__?: Record<string, unknown>;
  __E2E_RPC_ANSWER_1863__?: Record<string, { data: unknown; error: unknown }>;
};

const EXPIRED = { can_start: false, trial_active: false, error: 'trial_expired', trial_seconds_remaining: 0 };

test.describe('#1863 payment wall in the browser', () => {
  test('J1.f: an expired unpaid user meets the wall on product pages and can still reach deletion and billing', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: EXPIRED });

    for (const route of ['/practice', '/session', '/progress']) {
      await navigateToRoute(page, route);
      const wall = page.getByTestId('trial-payment-wall');
      await expect(wall).toBeVisible();
      await expect(wall.getByRole('heading', { name: 'Your free trial has ended' })).toBeVisible();
      await expect(page.getByTestId('practice-root')).toHaveCount(0);
      await expect(page.getByTestId('session-page')).toHaveCount(0);
    }

    // The wall's own link opens the deletion page, and the wall does not follow the user there.
    await page.getByTestId('trial-payment-wall').getByRole('link', { name: 'Delete account' }).click();
    await expect(page.getByTestId('account-deletion-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);

    // Account and pricing stay outside the wall.
    for (const route of ['/account', '/pricing']) {
      await navigateToRoute(page, route);
      await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);
    }
  });

  test('J1.e: a take cut off when the trial ends says "not saved", and Delete account still opens deletion', async ({ page }) => {
    // The trial is active with a minute left, so the take starts while the server confirms access.
    await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: { can_start: true, trial_active: true, trial_seconds_remaining: 60 } });
    await navigateToRoute(page, '/session');
    await startRecording(page);
    await expect(page.getByTestId('session-page')).toBeVisible();

    // The trial ends mid-take. The server now refuses access and refuses the save, as the database does.
    await page.evaluate((expired) => {
      const win = window as E2EWindow;
      win.__E2E_USAGE_LIMIT_1863__ = expired;
      win.__E2E_RPC_ANSWER_1863__ = { complete_session_v2: { data: { success: false, error: 'trial_expired' }, error: null } };
    }, EXPIRED);
    // The page is kept for the live take: the wall must not cut the recorder off mid-take.
    await expect(page.getByTestId('session-page')).toBeVisible();
    await expect(page.getByTestId('trial-payment-wall')).toHaveCount(0);

    await stopRecording(page);

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
