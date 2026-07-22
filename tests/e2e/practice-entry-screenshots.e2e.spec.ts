import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * Pre-merge VISUAL + CDP evidence for #1019 (authenticated /practice entry). No production deployment
 * needed: authenticates through the E2E mock/synthetic path, forces the rollout flag ON via the E2E
 * manifest override (window.__SS_E2E__.flags.practiceEntry), and captures desktop + mobile screenshots
 * of the chooser, Quick overview, Guided expanded preview, keyboard focus, and mobile stacking.
 *
 * CDP: collects console errors, uncaught page errors, and any request to a third-party analytics/tracking
 * host while on /practice, and asserts there are none — proving the page is clean and self-contained.
 * Screenshots are written under test-results/practice-entry/ (uploaded as ux-review-screenshots-*).
 */

const DIR = 'test-results/practice-entry';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
// Requests to any of these hosts while on /practice would be an unexpected external/tracking call.
const TRACKING_HOSTS = ['posthog.com', 'i.posthog.com', 'sentry.io', 'google-analytics.com', 'googletagmanager.com', 'doubleclick.net'];

async function gotoPractice(page: Page) {
  // Force the rollout gate ON for this authenticated E2E user (test-only override; see practiceRouting).
  await page.addInitScript(() => {
    const w = window as unknown as { __SS_E2E__?: { flags?: Record<string, unknown> } };
    w.__SS_E2E__ = w.__SS_E2E__ ?? {};
    w.__SS_E2E__.flags = { ...(w.__SS_E2E__.flags ?? {}), practiceEntry: true };
  });
  await navigateToRoute(page, '/practice');
  await expect(page.getByTestId('practice-root')).toBeVisible({ timeout: 30000 });
}

test.describe('Practice entry — pre-merge visual + CDP evidence', () => {
  test('captures desktop + mobile screenshots and proves a clean, self-contained page', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const trackingRequests: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) => {
      try {
        const host = new URL(req.url()).hostname;
        if (TRACKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) trackingRequests.push(req.url());
      } catch { /* ignore non-URL requests */ }
    });

    await programmaticLoginWithRoutes(page, { userType: 'free' });

    // 1) Chooser — desktop.
    await page.setViewportSize(DESKTOP);
    await gotoPractice(page);
    await expect(page.getByRole('heading', { name: /private practice\. public impact/i })).toBeVisible();
    // Exactly one main landmark exists (App owns it; the page adds none).
    expect(await page.getByRole('main').count()).toBe(1);
    await page.screenshot({ path: `${DIR}/01-chooser-desktop.png`, fullPage: true });

    // 2) Quick overview — desktop.
    await page.getByTestId('practice-card-quick').click();
    await expect(page.getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeVisible();
    await page.screenshot({ path: `${DIR}/02-quick-overview-desktop.png`, fullPage: true });

    // 3) Guided expanded preview — desktop (re-open a fresh chooser rather than using the back control,
    //    keeping the capture deterministic).
    await gotoPractice(page);
    await page.getByTestId('practice-card-guided').click();
    await expect(page.getByText(/preview · coming soon/i)).toBeVisible();
    await page.screenshot({ path: `${DIR}/03-guided-expanded-desktop.png`, fullPage: true });

    // 4) Keyboard focus — the Quick CTA is focusable/operable via the keyboard.
    const quickCta = page.getByTestId('practice-card-quick');
    await quickCta.focus();
    await expect(quickCta).toBeFocused();
    await page.screenshot({ path: `${DIR}/04-keyboard-focus-desktop.png` });

    // 5) Mobile stacking — cards stack in a single column.
    await page.setViewportSize(MOBILE);
    await gotoPractice(page);
    await page.screenshot({ path: `${DIR}/05-chooser-mobile.png`, fullPage: true });

    // CDP assertions: a clean, self-contained page.
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(trackingRequests, `unexpected tracking requests: ${trackingRequests.join(' | ')}`).toEqual([]);
  });
});
