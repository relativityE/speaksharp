import { test, expect } from './fixtures';
import type { Page, Request } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * #1120 S1 (PR #1155) — the STT dropdown option description is ONE controlled surface (`stt-mode-flyout`)
 * following the active row. Cloud is globally OFF and customer-invisible: NO Cloud row, NO Cloud flyout,
 * NO Cloud DOM/accessibility entry, and NO Cloud token/provider/network request — in BOTH the launch
 * (Private-primary) and hierarchy-rollback (Browser-default) states.
 */

// Cloud provider / token endpoints that must NEVER be contacted while Cloud is off.
const CLOUD_HOSTS = /assemblyai\.com|assemblyai-token|\/functions\/v1\/assemblyai/i;
function trackCloudRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r: Request) => { if (CLOUD_HOSTS.test(r.url())) hits.push(r.url()); });
  return hits;
}

async function openMenu(page: Page) {
  await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
  await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();
}

test.describe('STT dropdown option description — single surface, Cloud absent', () => {
  test('launch: one flyout follows Private/Browser on hover + keyboard; no Cloud row/flyout/request', async ({ page }) => {
    const cloudHits = trackCloudRequests(page);
    await programmaticLoginWithRoutes(page, { userType: 'pro', sttPrivatePrimary: true });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    await openMenu(page);
    // Private-first order; Browser present as the fallback; Cloud is ABSENT.
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_NATIVE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);

    const fly = page.getByTestId('stt-mode-flyout');
    // Keyboard focus reveals the description: ArrowDown highlights the first item (Private).
    await page.keyboard.press('ArrowDown');
    await expect(fly).toBeVisible();
    await expect(fly).toHaveAttribute('data-mode', 'private');
    expect(await fly.count()).toBe(1);

    // Hover Browser → the SAME single surface switches to Browser's approved copy.
    await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).hover();
    await expect(fly).toHaveAttribute('data-mode', 'native');
    await expect(fly).toContainText(/browser.s (built-in )?speech recognition/i);
    expect(await fly.count()).toBe(1);

    // Hover Private (the recommended first item).
    await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).hover();
    await expect(fly).toHaveAttribute('data-mode', 'private');
    await expect(fly).toContainText(/on this device/i);
    expect(await fly.count()).toBe(1);

    // No Cloud flyout target ever exists.
    await expect(page.getByTestId('stt-mode-flyout')).not.toHaveAttribute('data-mode', 'cloud');
    // Zero Cloud token/provider/network requests during the journey.
    expect(cloudHits, `no Cloud requests allowed: ${cloudHits.join(',')}`).toEqual([]);
  });

  test('rollback: Browser default, Private available, Cloud still absent + unreachable', async ({ page }) => {
    const cloudHits = trackCloudRequests(page);
    await programmaticLoginWithRoutes(page, { userType: 'pro', sttPrivatePrimary: false });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    await openMenu(page);
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_NATIVE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);
    expect(cloudHits, `no Cloud requests allowed: ${cloudHits.join(',')}`).toEqual([]);
  });
});
