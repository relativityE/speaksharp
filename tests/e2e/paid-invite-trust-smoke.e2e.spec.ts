import { test, expect } from './fixtures';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  selectTranscriptionEngine,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';
import { TEST_IDS } from '../constants';

const TRUST_SMOKE_TRANSCRIPT = [
  'This is a paid invite trust smoke session.',
  'The user should see the first transcript quickly, save it, and know where to review it next.',
].join(' ');

test.describe('Paid invite trust smoke', () => {
  test('starts a fresh Pro session on Private, saves, and offers review (no Browser→Private upsell)', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    // #1184/#1222: Private is the only engine — no selector to choose; the recorder surface confirms it.
    await selectTranscriptionEngine(page, 'private');
    await expect(page.getByText(/Private model setup required/i)).toHaveCount(0);

    await startRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15_000 });

    await simulateTranscription(page, TRUST_SMOKE_TRANSCRIPT, true);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText(/paid invite trust smoke/i);

    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

    // Consolidated post-save experience: ONE status bar carries the reconciliation copy and the Analytics
    // action — the separate post-save surface is gone.
    await expect(page.getByTestId('post-save-review-actions')).toHaveCount(0);
    await expect(page.getByTestId('live-session-header')).toContainText(/Session saved ·/);
    await expect(page.getByTestId('post-save-review-session-link')).toHaveAttribute('href', '/analytics');
    // #1184: no Browser→Private upsell CTA after save — the session was already Private.
    await expect(page.getByTestId('post-save-private-cta')).toHaveCount(0);
  });

  test('shows the account-linked support-follow-up disclosure for authenticated reports', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    await page.getByTestId('nav-report-issue-button').click();
    // Single support-oriented disclosure — reports are account-linked (internal id only; no email/name).
    await expect(page.getByTestId('issue-report-disclosure')).toContainText(/Linked to your account using an internal ID/i);
    await expect(page.getByTestId('issue-report-disclosure')).toContainText(/do not include your email, name, password, login credentials, transcript, or audio/i);
    await expect(page.getByText(/Anonymous report/i)).toHaveCount(0);
    await expect(page.getByText(/Account support report/i)).toHaveCount(0);

    // Disclosure is category-agnostic now (no anonymous/account-context branch).
    await page.getByTestId('issue-report-category').selectOption('billing_subscription');
    await expect(page.getByTestId('issue-report-disclosure')).toContainText(/Linked to your account using an internal ID/i);
  });

  test('keeps pricing and AI copy aligned with paid early access', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/pricing');

    await expect(page.getByText(/The complete Private Practice product, free for 30 days/i)).toBeVisible();
    await expect(page.getByText(/Everything in the trial — the same complete product/i)).toBeVisible();
    await expect(page.getByText(/AI-assisted feedback/i)).toHaveCount(0);
    await expect(page.getByText(/Pro continues.*Stripe confirmation/i).first()).toBeVisible();
  });
});
