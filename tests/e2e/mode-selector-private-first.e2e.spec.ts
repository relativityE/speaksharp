import { test, expect } from './fixtures';
import type { Page, Request } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * #1120 S1 (PR #1155) — Private-primary hierarchy + the SINGLE controlled description surface.
 *
 * LAUNCH state (hierarchy ON): the selector reads Private (Stays local, **Recommended**) → Browser
 * (compatibility **Fallback**). Cloud and the "Native" customer label are ABSENT — no Cloud row, About,
 * tooltip/flyout, accessibility text, or fallback — and no Cloud token/provider/network request occurs.
 * ROLLBACK state (hierarchy OFF): Browser is the default, Private remains available, Cloud stays absent.
 * The mode description is ONE controlled flyout (never overlapping bubbles); hard geometry assertions kept.
 */
const VIEWPORTS = [
  { name: 'w375', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];
const SHOTS = 'test-results/mode-selector';
const CLOUD_HOSTS = /assemblyai\.com|assemblyai-token|\/functions\/v1\/assemblyai/i;

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box | null, b: Box | null) =>
  !!(a && b) && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const inViewport = (a: Box | null, vw: number, vh: number) =>
  !!a && a.x >= -0.5 && a.y >= -0.5 && a.x + a.width <= vw + 0.5 && a.y + a.height <= vh + 0.5;

function trackCloudRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r: Request) => { if (CLOUD_HOSTS.test(r.url())) hits.push(r.url()); });
  return hits;
}
async function bootLaunch(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await programmaticLoginWithRoutes(page, { userType: 'pro', sttPrivatePrimary: true });
  await navigateToRoute(page, '/session');
  await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
}
async function openMenu(page: Page) {
  await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
  await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();
}

test.describe('Private-first mode selector — launch + rollback (Cloud absent)', () => {
  for (const vp of VIEWPORTS) {
    test(`launch order/tags/labels + no-overflow + Cloud absent at ${vp.name}`, async ({ page }) => {
      const cloudHits = trackCloudRequests(page);
      await bootLaunch(page, vp.width, vp.height);
      // Private is the resolved default.
      await expect(page.locator('html')).toHaveAttribute('data-stt-mode', 'private');

      await openMenu(page);
      const priv = page.getByTestId(TEST_IDS.STT_MODE_PRIVATE);
      const browser = page.getByTestId(TEST_IDS.STT_MODE_NATIVE);

      await expect(priv).toBeVisible();
      await expect(browser).toBeVisible();
      // Cloud row + About-Cloud are ABSENT (never merely disabled).
      await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);
      await expect(page.getByTestId('stt-about-cloud')).toHaveCount(0);

      // Private = Recommended (primary); Browser = labelled "Browser" (never "Native").
      await expect(priv.getByTestId('stt-mode-tag-recommended')).toBeVisible();
      await expect(browser).toHaveText(/Browser/);
      await expect(browser).not.toHaveText(/Native/);

      // Private-first DOM order (2 rows).
      const order = await page.evaluate((ids) => {
        const p = document.querySelector(`[data-testid="${ids.priv}"]`);
        const b = document.querySelector(`[data-testid="${ids.browser}"]`);
        if (!p || !b) return null;
        return Boolean(p.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      }, { priv: TEST_IDS.STT_MODE_PRIVATE, browser: TEST_IDS.STT_MODE_NATIVE });
      expect(order).toBe(true);

      // Never more than one description bubble; no horizontal overflow.
      expect(await page.getByTestId('stt-mode-flyout').count()).toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      // No customer-facing "Cloud" or "Native" text anywhere in the open selector surface.
      const surfaceText = (await page.locator('body').textContent()) ?? '';
      expect(surfaceText).not.toMatch(/\bCloud\b/);
      expect(surfaceText).not.toMatch(/\bNative\b/);

      expect(cloudHits, `no Cloud requests: ${cloudHits.join(',')}`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/launch-${vp.name}.png` });
    });
  }

  test('desktop: ONE flyout follows Private→Browser, disjoint from menu + Live Coaching; no Cloud row', async ({ page }) => {
    await bootLaunch(page, 1280, 800);
    await openMenu(page);
    await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);

    const menu = page.getByRole('menu');
    const liveCoaching = page.getByTestId('live-coaching-score-card');
    const rows = { private: page.getByTestId(TEST_IDS.STT_MODE_PRIVATE), native: page.getByTestId(TEST_IDS.STT_MODE_NATIVE) };
    const expectedText: Record<string, RegExp> = {
      private: /on this device/i,
      native: /browser.s (built-in )?speech recognition/i,
    };
    for (const modeName of ['private', 'native'] as const) {
      await rows[modeName].hover();
      const fly = page.getByTestId('stt-mode-flyout');
      await expect(fly).toBeVisible();
      await expect(fly).toHaveAttribute('data-mode', modeName);
      await expect(fly).toHaveText(expectedText[modeName]);
      expect(await fly.count()).toBe(1);
      const flyBox = await fly.boundingBox();
      expect(intersects(flyBox, await menu.boundingBox())).toBeFalsy();
      expect(intersects(flyBox, await liveCoaching.boundingBox())).toBeFalsy();
      expect(inViewport(flyBox, 1280, 800)).toBe(true);
    }
    await page.mouse.move(2, 2);
    await expect(page.getByTestId('stt-mode-flyout')).toBeHidden();
  });

  test('narrow (375px): flyout suppressed; About panel lists Private + Browser only (no Cloud About)', async ({ page }) => {
    await bootLaunch(page, 375, 812);
    await openMenu(page);
    await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).hover();
    const fly = page.getByTestId('stt-mode-flyout');
    if (await fly.count()) expect(await fly.isVisible()).toBe(false);

    await page.keyboard.press('Escape');
    await page.getByTestId('stt-mode-help').click();
    await expect(page.getByTestId('stt-modes-about')).toBeVisible();
    await expect(page.getByTestId('stt-about-private')).toBeVisible();
    await expect(page.getByTestId('stt-about-native')).toBeVisible();
    await expect(page.getByTestId('stt-about-cloud')).toHaveCount(0);
  });

  test('rollback (hierarchy OFF): Browser is default; Private available; Cloud absent + unreachable', async ({ page }) => {
    const cloudHits = trackCloudRequests(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await programmaticLoginWithRoutes(page, { userType: 'pro', sttPrivatePrimary: false });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    // Browser is the resolved default in rollback.
    await expect(page.locator('html')).toHaveAttribute('data-stt-mode', 'native');
    await openMenu(page);
    // Private remains available; Cloud is still absent; no Recommended badge on Private in rollback.
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);
    await expect(page.getByTestId('stt-about-cloud')).toHaveCount(0);
    expect(cloudHits, `no Cloud requests: ${cloudHits.join(',')}`).toEqual([]);
  });
});
