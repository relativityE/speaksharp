import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * #1064 VISUAL PROOF: the Private privacy signal — `PRIVATE [STAYS LOCAL]` with the green outlined
 * privacy lock — captured with the STT dropdown OPEN, at desktop AND mobile, in BOTH entitlement states:
 *
 *  - AVAILABLE (Pro / active Private sample): green outlined privacy lock + primary "Stays local" badge,
 *    no "Recommended", no entitlement lock.
 *  - UNAVAILABLE (free, sample consumed): the (muted) "Stays local" badge stays — privacy is an attribute
 *    of the method even when access is restricted — but the GREEN privacy lock is gone; access restriction
 *    is carried by the disabled state + entitlement copy + the muted entitlement lock (never two locks).
 *
 * Authenticates via the E2E mock/synthetic path; no production deployment. Screenshots → the
 * mode-selector-stays-local/ folder for PR evidence.
 */

const DIR = 'test-results/mode-selector-stays-local';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

// Wait for the framer-motion page transition to finish (every ancestor opacity settled to ~1) before a
// capture — otherwise the shot lands mid-fade and the whole page reads as washed out. This is what made the
// earlier unavailable captures (taken right after re-login + navigate) look faded.
async function settlePage(page: Page) {
  // FAIL CLOSED: if the page never settles (opacity < 1 somewhere up the tree), let the timeout THROW so the
  // test fails instead of silently capturing another faded, approval-quality screenshot.
  await page.waitForFunction(() => {
    let el = document.querySelector('[data-testid="live-recording-card"]') as HTMLElement | null;
    if (!el) return false;
    while (el) { if (parseFloat(getComputedStyle(el).opacity || '1') < 0.99) return false; el = el.parentElement; }
    return true;
  }, { timeout: 8_000 });
}

async function openMenu(page: Page) {
  // The dropdown uses CONTROLLED open state: a screenshot or setViewportSize does NOT close it, and clicking
  // the trigger while it is already open would TOGGLE it shut. So ensure a clean closed state first (Escape),
  // then open deterministically — this keeps the second (mobile) capture from racing the still-open desktop menu.
  const priv = page.getByTestId(TEST_IDS.STT_MODE_PRIVATE);
  if (await priv.count()) {
    await page.keyboard.press('Escape');
    await expect(priv).toHaveCount(0);
  }
  // Ensure the page transition has fully settled (opacity 1) BEFORE opening the menu and capturing.
  await settlePage(page);
  const btn = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
  const bbox = await btn.boundingBox();
  if (bbox) await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  else await btn.click({ force: true });
  await expect(priv).toBeVisible({ timeout: 10_000 });
}

test.describe('#1064 Private "Stays local" privacy signal — visual proof', () => {
  test('available Private shows green privacy lock + Stays local; unavailable shows muted badge, no green lock', async ({ page }) => {
    // ================= AVAILABLE (free user with an active Private sample) =================
    // Mirrors engine-lifecycle's proven Private-enabling setup so canUsePrivate is deterministically true.
    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      mockProfile: {
        subscription_status: 'free',
        stripe_subscription_id: null,
        subscription_id: null,
        preferred_mode: 'native',
        private_sample_available: true,
        private_sample_limit_seconds: 300,
        private_sample_seconds_used: 0,
        private_sample_seconds_remaining: 300,
      },
    });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    await page.setViewportSize(DESKTOP);
    await openMenu(page);
    const privAvail = page.getByTestId(TEST_IDS.STT_MODE_PRIVATE);
    // Gate on the row being ENABLED (canUsePrivate hydrated) before asserting the available-state visuals.
    await expect(privAvail).not.toHaveAttribute('data-disabled', '');
    // Contract: green privacy lock + Stays local badge; no "Recommended"/overclaim.
    await expect(privAvail.getByTestId('stt-private-lock')).toBeVisible();
    await expect(privAvail.getByTestId('stt-mode-tag-stays-local')).toBeVisible();
    expect(await privAvail.textContent() ?? '').not.toMatch(/recommended|secure|encrypted|protected/i);
    await page.screenshot({ path: `${DIR}/01-available-desktop.png`, fullPage: true });

    await page.setViewportSize(MOBILE);
    await openMenu(page);
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).getByTestId('stt-private-lock')).toBeVisible();
    await page.screenshot({ path: `${DIR}/02-available-mobile.png`, fullPage: true });

    // ================= UNAVAILABLE (free, sample consumed) =================
    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      mockProfile: {
        subscription_status: 'free',
        stripe_subscription_id: null,
        subscription_id: null,
        preferred_mode: 'native',
        private_sample_available: false,
        private_sample_limit_seconds: 300,
        private_sample_seconds_used: 300,
        private_sample_seconds_remaining: 0,
      },
    });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    await page.setViewportSize(DESKTOP);
    await openMenu(page);
    const privUnavail = page.getByTestId(TEST_IDS.STT_MODE_PRIVATE);
    await expect(privUnavail).toHaveAttribute('data-disabled', '');
    // Privacy identity stays truthful (muted badge) — but NO green privacy lock when access is restricted.
    await expect(privUnavail.getByTestId('stt-mode-tag-stays-local')).toBeVisible();
    await expect(privUnavail.getByTestId('stt-private-lock')).toHaveCount(0);
    await page.screenshot({ path: `${DIR}/03-unavailable-desktop.png`, fullPage: true });

    await page.setViewportSize(MOBILE);
    await openMenu(page);
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).getByTestId('stt-private-lock')).toHaveCount(0);
    await page.screenshot({ path: `${DIR}/04-unavailable-mobile.png`, fullPage: true });
  });
});
