import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * SIMULATED stale-chunk RESPONSE recovery. Fault-injects the two server responses a long-lived tab can
 * get for a rotated-away lazy chunk, WITHOUT a second real build:
 *   - legacy 200 text/html (the pre-fix SPA fallback that caused the crash), and
 *   - the corrected 404 (missing chunk under the fixed SPA fallback).
 * Both must recover with exactly one guarded reload onto a working /session. (A genuine two-build rollover
 * across separate dist directories lives in stale-chunk-rollover.e2e.spec.ts.)
 */

const LOAD_COUNTER = `try { const k='__ss_full_loads'; sessionStorage.setItem(k, String((parseInt(sessionStorage.getItem(k)||'0',10))+1)); } catch {}`;
const loads = (page: Page) => page.evaluate(() => parseInt(sessionStorage.getItem('__ss_full_loads') || '0', 10));

type StaleCase = { label: string; fulfill: (route: import('@playwright/test').Route) => Promise<void> };

const CASES: StaleCase[] = [
  {
    label: 'legacy 200 text/html SPA fallback (pre-fix crash response)',
    fulfill: (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>stale index</body></html>' }),
  },
  {
    label: 'corrected 404 missing chunk (fixed SPA fallback)',
    fulfill: (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }),
  },
];

test.describe('Simulated stale-chunk response recovery', () => {
  for (const c of CASES) {
    test(`old tab → Open Practice Session, SessionPage chunk returns ${c.label} → one reload → working /session`, async ({ page }) => {
      await page.addInitScript(LOAD_COUNTER);
      await programmaticLoginWithRoutes(page, { userType: 'free' });
      await navigateToRoute(page, '/practice');
      await expect(page.getByTestId('practice-root')).toBeVisible();

      let servedStaleOnce = false;
      await page.route('**/assets/SessionPage-*.js', async (route) => {
        if (!servedStaleOnce) { servedStaleOnce = true; await c.fulfill(route); }
        else await route.continue();
      });

      await page.evaluate(() => sessionStorage.setItem('__ss_full_loads', '0'));
      // #1042 PR3: the Freestyle card navigates directly to /session (no intermediate overview).
      await page.getByTestId('practice-card-quick').click();

      await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
      const startStop = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
      await expect(startStop).toBeVisible({ timeout: 30000 });
      await expect(startStop).toHaveAccessibleName(/start/i); // recording did NOT auto-start
      await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible(); // auth retained
      await expect(page.getByText(/something went wrong/i)).toHaveCount(0); // no generic Oops
      await expect(page.locator('#ss-stale-chunk-recovery')).toHaveCount(0); // no persistent recovery overlay
      expect(await loads(page), 'exactly one recovery reload (no loop)').toBe(1);
      expect(servedStaleOnce).toBe(true);
    });
  }
});
