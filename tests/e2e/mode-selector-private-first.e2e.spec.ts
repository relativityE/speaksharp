import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * P0.2 — Private-first mode hierarchy + restored tooltip interaction. Proves the selector reads
 * Private (Recommended) → Browser (Quick preview) → Cloud (Pro) across responsive widths, that each
 * one-line row reveals its description through a floating, collision-aware Radix Tooltip on hover AND
 * keyboard focus (fully inside the viewport — no clip/overlap), and that a single "About transcription
 * modes" info button gives touch users all three descriptions WITHOUT selecting a mode. Screenshot per
 * width for review (320 / 375 / 390 / 1280).
 */
const VIEWPORTS = [
  { name: 'w320', width: 320, height: 844 },
  { name: 'w375', width: 375, height: 812 },
  { name: 'w390', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const insideViewport = (box: { x: number; width: number; y: number; height: number } | null, w: number, h: number) => {
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height).toBeLessThanOrEqual(h + 1);
};

test.describe('Private-first mode selector (responsive)', () => {
  for (const vp of VIEWPORTS) {
    test(`order, tags, floating tooltip + touch help at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

      // ---- Touch path FIRST (before opening the dropdown): the "About transcription modes" info button
      // lets someone read ALL THREE descriptions without selecting a mode. ≥44×44px touch target.
      const info = page.getByTestId('stt-mode-help');
      const infoBox = await info.boundingBox();
      expect(infoBox).not.toBeNull();
      if (infoBox) {
        expect(infoBox.width).toBeGreaterThanOrEqual(44);
        expect(infoBox.height).toBeGreaterThanOrEqual(44);
      }
      await info.click();
      const about = page.getByTestId('stt-modes-about');
      await expect(about).toBeVisible();
      await expect(page.getByTestId('stt-about-private')).toBeVisible();
      await expect(page.getByTestId('stt-about-native')).toBeVisible();
      await expect(page.getByTestId('stt-about-cloud')).toBeVisible(); // read about Cloud WITHOUT selecting it
      insideViewport(await about.boundingBox(), vp.width, vp.height);
      await page.keyboard.press('Escape'); // dismissible by Escape
      await expect(about).toBeHidden();

      // ---- Open the mode dropdown.
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

      // ---- Keyboard: ArrowDown highlights Private and its floating tooltip appears, fully on-screen.
      await page.keyboard.press('ArrowDown');
      const privTip = page.getByTestId('stt-desc-private');
      await expect(privTip).toBeVisible();
      insideViewport(await privTip.boundingBox(), vp.width, vp.height);
      // Accessible relationship: Radix wires the row to its tooltip via aria-describedby while open.
      await expect(priv).toHaveAttribute('aria-describedby', /.+/);

      // ---- Hover ALSO reveals a description (not keyboard-only), fully on-screen.
      await cloud.hover();
      const cloudTip = page.getByTestId('stt-desc-cloud');
      await expect(cloudTip).toBeVisible();
      insideViewport(await cloudTip.boundingBox(), vp.width, vp.height);

      await priv.hover();
      await expect(privTip).toBeVisible();

      // No horizontal overflow of the document at this width.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      await page.screenshot({ path: `/tmp/ss-mode-selector-${vp.name}.png` });
    });
  }
});
