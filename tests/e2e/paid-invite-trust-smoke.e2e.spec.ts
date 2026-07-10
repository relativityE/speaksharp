import { test, expect } from './fixtures';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
} from './helpers';
import { TEST_IDS } from '../constants';

const TRUST_SMOKE_TRANSCRIPT = [
  'This is a paid invite trust smoke session.',
  'The user should see the first transcript quickly, save it, and know where to review it next.',
].join(' ');

test.describe('Paid invite trust smoke', () => {
  test('starts a fresh Pro session on Browser, saves, and offers review plus Private setup', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');

    const modeButton = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
    await expect(modeButton).toBeVisible();
    await expect(modeButton).toHaveAttribute('data-state', 'native');
    await expect(modeButton).toContainText(/Browser/i);
    await expect(page.getByText(/Private model setup required/i)).toHaveCount(0);

    const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await startButton.click();
    await expect(startButton).toHaveAttribute('data-recording', 'true');

    await simulateTranscription(page, TRUST_SMOKE_TRANSCRIPT, true);
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toContainText(/paid invite trust smoke/i);

    await page.waitForTimeout(5_200);
    await startButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });

    await expect(page.getByTestId('post-save-review-actions')).toContainText(/Review trends/i);
    await expect(page.getByTestId('post-save-review-session-link')).toHaveAttribute('href', '/analytics');
    await expect(page.getByTestId('post-save-private-cta')).toContainText(/Private/i);

    await page.getByTestId('post-save-private-cta').click();
    await expect(modeButton).toHaveAttribute('data-state', 'private');
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

    await expect(page.getByText(/Core practice feedback metrics/i)).toBeVisible();
    await expect(page.getByText(/Semantic AI coaching and expanded PDF export capacity/i)).toBeVisible();
    await expect(page.getByText(/AI-assisted feedback/i)).toHaveCount(0);
    await expect(page.getByText(/Pro unlocks.*Stripe confirmation/i).first()).toBeVisible();
  });
});
