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

    // #1416 — the disclosure is PROGRESSIVE and the detail is behind "What's included", so the default
    // form stays short. The old assertions required the long always-visible privacy block that the
    // redesign deliberately removed, and required an absolute "never included" promise that was not
    // true: the feedback box itself is submitted.
    await expect(page.getByTestId('issue-report-page-context'))
      .toContainText(/transcript and audio aren.t attached automatically/i);
    await expect(page.getByTestId('issue-report-disclosure')).toHaveCount(0);

    await page.getByRole('button', { name: "What's included" }).click();
    const disclosure = page.getByTestId('issue-report-disclosure');
    await expect(disclosure).toContainText(/internal account reference/i);
    await expect(disclosure).toContainText(/We don.t automatically attach your email, name, credentials, transcript, or audio/i);
    // The one thing the previous copy never said, and the reason the absolute promise was false.
    await expect(disclosure).toContainText(/Anything you type in the feedback box is included in your report/i);

    await expect(page.getByText(/Anonymous report/i)).toHaveCount(0);
    await expect(page.getByText(/Account support report/i)).toHaveCount(0);
    // The redesigned form asks two questions. There is no category selector to branch the disclosure on.
    await expect(page.getByTestId('issue-report-category')).toHaveCount(0);
  });

  test('keeps pricing and AI copy aligned with paid early access', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/pricing');

    await expect(page.getByText(/The complete Private Practice product, free for 30 days/i)).toBeVisible();
    await expect(page.getByText(/Everything in the trial — the same complete product/i)).toBeVisible();
    await expect(page.getByText(/AI-assisted feedback/i)).toHaveCount(0);
    await expect(page.getByText(/Pro unlocks only after Stripe confirmation/i).first()).toBeVisible();
  });
});
