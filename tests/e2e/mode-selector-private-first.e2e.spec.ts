import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * P0.2 — Private-first mode hierarchy + the SINGLE controlled description surface.
 *
 * Proves the selector reads Private (Recommended) → Browser → Cloud (Pro) across
 * responsive widths, and that the mode description is ONE controlled flyout — never three overlapping
 * bubbles. Hard geometry assertions: at most one visible flyout; it never intersects the dropdown menu,
 * never overlaps Live Coaching, stays fully in the viewport, keeps a visible gap, and never obscures a
 * mode label. Where no non-overlapping side fits (narrow widths), the desktop flyout is suppressed and
 * the single "About transcription modes" panel is the fallback. Screenshots captured per width + per mode.
 */
const VIEWPORTS = [
  { name: 'w320', width: 320, height: 844 },
  { name: 'w375', width: 375, height: 812 },
  { name: 'w390', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];
const SHOTS = 'test-results/mode-selector';

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box | null, b: Box | null) =>
  !!(a && b) && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const inViewport = (a: Box | null, vw: number, vh: number) =>
  !!a && a.x >= -0.5 && a.y >= -0.5 && a.x + a.width <= vw + 0.5 && a.y + a.height <= vh + 0.5;

async function openMenu(page: Page) {
  await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
  await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();
}

// The single flyout, if present and visible. Returns the bounding box or null when suppressed.
async function visibleFlyoutBox(page: Page): Promise<Box | null> {
  const fly = page.getByTestId('stt-mode-flyout');
  if (await fly.count() === 0) return null;
  if (!(await fly.isVisible())) return null;
  return await fly.boundingBox();
}

test.describe('Private-first mode selector + single description surface (responsive)', () => {
  for (const vp of VIEWPORTS) {
    test(`order, tags, labels + no-overflow at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

      await openMenu(page);
      const priv = page.getByTestId(TEST_IDS.STT_MODE_PRIVATE);
      const browser = page.getByTestId(TEST_IDS.STT_MODE_NATIVE);
      const cloud = page.getByTestId(TEST_IDS.STT_MODE_CLOUD);

      // Every label remains visible (compact one-line rows).
      await expect(priv).toBeVisible();
      await expect(browser).toBeVisible();
      await expect(cloud).toBeVisible();

      // #1041: only Private is Recommended; Browser carries NO badge (Quick preview retired); Cloud = Pro.
      await expect(priv.getByTestId('stt-mode-tag-recommended')).toBeVisible();
      await expect(browser.getByTestId('stt-mode-tag-quick-preview')).toHaveCount(0);
      await expect(browser.getByText(/quick preview/i)).toHaveCount(0);
      await expect(cloud.getByTestId('stt-mode-tag-pro')).toBeVisible();
      await expect(browser.getByTestId('stt-mode-tag-recommended')).toHaveCount(0);
      await expect(cloud.getByTestId('stt-mode-tag-recommended')).toHaveCount(0);

      // Private-first DOM order.
      const order = await page.evaluate((ids) => {
        const el = (id: string) => document.querySelector(`[data-testid="${id}"]`);
        const p = el(ids.priv), b = el(ids.browser), c = el(ids.cloud);
        if (!p || !b || !c) return null;
        const pb = p.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
        const bc = b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING;
        return Boolean(pb) && Boolean(bc);
      }, { priv: TEST_IDS.STT_MODE_PRIVATE, browser: TEST_IDS.STT_MODE_NATIVE, cloud: TEST_IDS.STT_MODE_CLOUD });
      expect(order).toBe(true);

      // NEVER more than one description bubble in the DOM (single controlled surface).
      expect(await page.getByTestId('stt-mode-flyout').count()).toBeLessThanOrEqual(1);

      // No horizontal overflow of the document at this width.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      await page.screenshot({ path: `${SHOTS}/rows-${vp.name}.png` });
    });
  }

  test('desktop: ONE flyout, disjoint from menu + Live Coaching, follows the active row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await openMenu(page);

    const menu = page.getByRole('menu');
    const liveCoaching = page.getByTestId('live-coaching-score-card');
    const rows = {
      private: page.getByTestId(TEST_IDS.STT_MODE_PRIVATE),
      native: page.getByTestId(TEST_IDS.STT_MODE_NATIVE),
      cloud: page.getByTestId(TEST_IDS.STT_MODE_CLOUD),
    };
    const expectedText: Record<string, RegExp> = {
      private: /on your device/i,
      native: /browser.s speech recognition/i,
      cloud: /external transcription server/i,
    };

    // Transition Private → Browser → Cloud; each step: exactly ONE visible flyout, correct content,
    // and geometrically disjoint from the menu and Live Coaching, fully inside the viewport.
    for (const modeName of ['private', 'native', 'cloud'] as const) {
      await rows[modeName].hover();
      const fly = page.getByTestId('stt-mode-flyout');
      await expect(fly).toBeVisible();
      await expect(fly).toHaveAttribute('data-mode', modeName);
      await expect(fly).toHaveText(expectedText[modeName]);
      // Exactly one flyout element.
      expect(await fly.count()).toBe(1);

      const flyBox = await fly.boundingBox();
      const menuBox = await menu.boundingBox();
      const lcBox = await liveCoaching.boundingBox();
      expect(flyBox && menuBox).toBeTruthy();
      // Disjoint from the menu (does not obscure any row).
      expect(intersects(flyBox, menuBox)).toBeFalsy();
      // Does not overlap Live Coaching.
      expect(intersects(flyBox, lcBox)).toBeFalsy();
      // Fully inside the viewport.
      expect(inViewport(flyBox, 1280, 800)).toBe(true);
      // Visible 8–12px gap between the menu and the bubble (allow AA rounding).
      if (flyBox && menuBox) {
        const gap = flyBox.x < menuBox.x
          ? menuBox.x - (flyBox.x + flyBox.width) // flyout on the left
          : flyBox.x - (menuBox.x + menuBox.width); // flyout on the right
        expect(gap).toBeGreaterThanOrEqual(7);
        expect(gap).toBeLessThanOrEqual(14);
      }
      // Every mode label stays visible/unobscured while the flyout is up.
      await expect(rows.private).toBeVisible();
      await expect(rows.native).toBeVisible();
      await expect(rows.cloud).toBeVisible();

      await page.screenshot({ path: `${SHOTS}/flyout-${modeName}-desktop.png` });
    }

    // Mouse leave closes the flyout.
    await page.mouse.move(2, 2);
    await expect(page.getByTestId('stt-mode-flyout')).toBeHidden();
  });

  test('desktop keyboard: focus through all three rows keeps exactly one flyout, mutually exclusive', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await openMenu(page);

    // ArrowDown highlights the first item (Private) → single flyout shows Private + aria-describedby wires up.
    await page.keyboard.press('ArrowDown');
    const fly = page.getByTestId('stt-mode-flyout');
    await expect(fly).toBeVisible();
    await expect(fly).toHaveAttribute('data-mode', 'private');
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toHaveAttribute('aria-describedby', 'stt-mode-flyout-desc');
    expect(await fly.count()).toBe(1);

    await page.keyboard.press('ArrowDown');
    await expect(fly).toHaveAttribute('data-mode', 'native');
    expect(await fly.count()).toBe(1);

    await page.keyboard.press('ArrowDown');
    await expect(fly).toHaveAttribute('data-mode', 'cloud');
    expect(await fly.count()).toBe(1);
    // Disjoint from the menu even under keyboard navigation.
    expect(intersects(await fly.boundingBox(), await page.getByRole('menu').boundingBox())).toBeFalsy();
  });

  test('narrow (375px): flyout is suppressed; the single About panel is the fallback', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });
    await openMenu(page);

    // No room for a disjoint side flyout → it must NOT be visible.
    await page.getByTestId(TEST_IDS.STT_MODE_CLOUD).hover();
    expect(await visibleFlyoutBox(page)).toBeNull();

    // Close the menu; the single "About transcription modes" help lists ALL three descriptions —
    // readable without selecting a mode, no per-row info icons, tap/click (not hover) driven.
    await page.keyboard.press('Escape');
    await page.getByTestId('stt-mode-help').click();
    await expect(page.getByTestId('stt-modes-about')).toBeVisible();
    await expect(page.getByTestId('stt-about-private')).toBeVisible();
    await expect(page.getByTestId('stt-about-native')).toBeVisible();
    await expect(page.getByTestId('stt-about-cloud')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/about-panel-375.png` });
  });

  // The STT menu must be FULLY OPAQUE at every frame of the open transition — the mic/timer/status pill
  // must never show through. We slow the menu animation so a whole-surface fade (if present) is caught
  // near opacity 0 rather than escaping the sample window.
  for (const width of [320, 375, 390]) {
    test(`STT menu is fully opaque at every frame of opening (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

      // Stretch the menu's open animation to 3s so the sample window sits early in the transition.
      await page.addStyleTag({ content: '[role="menu"]{ animation-duration: 3s !important; animation-delay: 0s !important; }' });

      await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();

      // Sample computed opacity across ~12 animation frames right after opening.
      const probe = await menu.evaluate((el) => new Promise<{ reads: number[]; bg: string }>((resolve) => {
        const reads: number[] = [];
        let n = 0;
        const tick = () => {
          reads.push(parseFloat(getComputedStyle(el).opacity));
          if (++n < 12) requestAnimationFrame(tick);
          else resolve({ reads, bg: getComputedStyle(el).backgroundColor });
        };
        requestAnimationFrame(tick);
      }));

      // Opacity is 1 at EVERY sampled frame (no whole-surface fade).
      expect(Math.min(...probe.reads)).toBe(1);

      // Background color is fully opaque (alpha 1) — nothing behind can bleed through.
      const rgba = probe.bg.match(/rgba?\(([^)]+)\)/);
      expect(rgba).not.toBeNull();
      const parts = rgba![1].split(',').map((s) => s.trim());
      const alpha = parts.length === 4 ? parseFloat(parts[3]) : 1;
      expect(alpha).toBe(1);

      // Settled state is opaque too.
      await page.waitForTimeout(300);
      expect(await menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

      // Readable contrast: popover foreground token is dark-on-light (or light-on-dark), never see-through.
      await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();

      // No horizontal overflow at this width.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      await page.screenshot({ path: `${SHOTS}/menu-opaque-${width}.png` });
    });
  }

  // The touch "About transcription modes" help and the mode dropdown are mutually exclusive — at most one
  // description/help surface at a time, no overlap/clipping, and the dropdown stays opaque.
  for (const width of [320, 375, 390]) {
    test(`About panel and dropdown are mutually exclusive at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

      const menu = page.getByRole('menu');
      const about = page.getByTestId('stt-mode-help-content');

      // Open the dropdown → menu present, About absent, and the menu is fully opaque.
      await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
      await expect(menu).toBeVisible();
      await expect(about).toHaveCount(0);
      expect(await menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

      // Dismiss the dropdown (Escape), then open About → About present, menu absent (never both).
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await page.getByTestId('stt-mode-help').click();
      await expect(about).toBeVisible();
      await expect(menu).toHaveCount(0);
      // aria wiring + no clipping (fully inside the viewport).
      await expect(page.getByTestId('stt-mode-help')).toHaveAttribute('aria-expanded', 'true');
      const box = await about.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      }
      // Capture the About-open / dropdown-closed state (the review-relevant view: the single touch help
      // surface with NO overlapping tooltip and NO dropdown behind it).
      await page.screenshot({ path: `${SHOTS}/about-exclusive-${width}.png` });

      // Opening the dropdown again CLOSES About (mutually exclusive).
      await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
      await expect(menu).toBeVisible();
      await expect(about).toHaveCount(0);

      // No horizontal overflow at this width.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
