import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * P0.2 — Private-first mode hierarchy. Proves the selector reads Private (Recommended) → Browser
 * (Quick preview) → Cloud (Pro) across responsive widths, with keyboard access, and captures a
 * screenshot at each width for review (320 / 375 / 390 / desktop).
 */
const VIEWPORTS = [
  { name: 'w320', width: 320, height: 844 },
  { name: 'w375', width: 375, height: 812 },
  { name: 'w390', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

test.describe('Private-first mode selector (responsive)', () => {
  for (const vp of VIEWPORTS) {
    test(`order, tags and keyboard access at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

      // Open the mode dropdown.
      await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
      const priv = page.getByTestId(TEST_IDS.STT_MODE_PRIVATE);
      const browser = page.getByTestId(TEST_IDS.STT_MODE_NATIVE);
      const cloud = page.getByTestId(TEST_IDS.STT_MODE_CLOUD);
      await expect(priv).toBeVisible();
      await expect(browser).toBeVisible();
      await expect(cloud).toBeVisible();

      // Only Private is Recommended; Browser = Quick preview; Cloud = Pro.
      await expect(priv.getByTestId('stt-mode-tag-recommended')).toBeVisible();
      await expect(browser.getByTestId('stt-mode-tag-quick-preview')).toBeVisible();
      await expect(cloud.getByTestId('stt-mode-tag-pro')).toBeVisible();
      await expect(browser.getByTestId('stt-mode-tag-recommended')).toHaveCount(0);
      await expect(cloud.getByTestId('stt-mode-tag-recommended')).toHaveCount(0);

      // Private-first DOM order: Private before Browser before Cloud.
      const order = await page.evaluate((ids) => {
        const el = (id: string) => document.querySelector(`[data-testid="${id}"]`);
        const p = el(ids.priv), b = el(ids.browser), c = el(ids.cloud);
        if (!p || !b || !c) return null;
        const pb = p.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
        const bc = b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING;
        return Boolean(pb) && Boolean(bc);
      }, { priv: TEST_IDS.STT_MODE_PRIVATE, browser: TEST_IDS.STT_MODE_NATIVE, cloud: TEST_IDS.STT_MODE_CLOUD });
      expect(order).toBe(true);

      // Keyboard: ArrowDown highlights the first item (Private) and reveals its description.
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('stt-desc-private')).toBeVisible();

      await page.screenshot({ path: `/tmp/ss-mode-selector-${vp.name}.png` });
    });
  }
});
