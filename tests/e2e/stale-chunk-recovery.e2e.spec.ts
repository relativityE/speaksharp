import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * P0 two-build rollover: a long-lived authenticated tab (Build A) crosses a deployment (Build B) and
 * navigates to a lazily-loaded route whose chunk URL no longer exists. We reproduce that by serving the
 * SPA-fallback HTML (200 text/html) for the SessionPage chunk on its FIRST request — exactly what a stale
 * tab received. The app must recover with ONE guarded reload and land on a working /session, keeping the
 * session, without a generic Oops page or a reload loop.
 */

const LOAD_COUNTER = `
  try {
    const k = '__ss_full_loads';
    sessionStorage.setItem(k, String((parseInt(sessionStorage.getItem(k) || '0', 10)) + 1));
  } catch {}
`;

async function loads(page: Page): Promise<number> {
  return page.evaluate(() => parseInt(sessionStorage.getItem('__ss_full_loads') || '0', 10));
}

test.describe('Stale-deployment chunk recovery (two-build rollover)', () => {
  test('old tab → Open Practice Session with a rotated-away chunk → one reload → working /session', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    // Count every FULL document load (fires before app scripts on each navigation/reload).
    await page.addInitScript(LOAD_COUNTER);

    // Build A: authenticated tab on /practice.
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('practice-root')).toBeVisible();

    // Deployment happens: the SessionPage chunk this tab will request no longer exists → the SPA fallback
    // returns index HTML for it. Serve that HTML on the FIRST hit only; the post-reload request succeeds.
    let servedStaleOnce = false;
    await page.route('**/assets/SessionPage-*.js', async (route) => {
      if (!servedStaleOnce) {
        servedStaleOnce = true;
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>stale index</body></html>' });
      } else {
        await route.continue();
      }
    });

    // Reset the load counter at the moment of the deployment transition.
    await page.evaluate(() => sessionStorage.setItem('__ss_full_loads', '0'));

    // Navigate Quick Practice → overview → Open Practice Session (triggers the SessionPage lazy import).
    await page.getByTestId('practice-card-quick').click();
    await expect(page.getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeVisible();
    await page.getByTestId('practice-quick-start').click();

    // Recovery: exactly one reload lands on a working /session.
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    const startStop = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
    await expect(startStop, 'transcription interface renders after recovery').toBeVisible({ timeout: 30000 });
    // Recording did NOT auto-start: the control is in its start (not-recording) state.
    await expect(startStop).toHaveAccessibleName(/start/i);
    // Authentication retained across the recovery reload.
    await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible();
    // No generic Oops page for this known deployment condition, and no persistent recovery overlay.
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    await expect(page.locator('#ss-stale-chunk-recovery')).toHaveCount(0);

    // Exactly ONE recovery reload (no loop).
    expect(await loads(page), 'exactly one recovery reload occurred').toBe(1);
    expect(servedStaleOnce, 'the stale chunk was served exactly once, then recovered').toBe(true);
  });
});
