import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * The session ⓘ help popovers (selected-mode STT help + session-feedback help) must stay fully inside the
 * viewport on a mobile width — no clipping. The desktop dropdown hover flyout remains a single controlled
 * surface. #1120 S1 (PR #1155): Cloud is customer-invisible — the desktop flyout is exercised on the
 * Private/Browser rows (NOT Cloud), and there is NO Cloud row/flyout target.
 */
test.describe('Help popover mobile readability (Cloud absent)', () => {
  const assertInViewport = async (box: { x: number; width: number } | null, viewportWidth: number) => {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  };

  test('ⓘ help stays inside the viewport on mobile; desktop dropdown flyout works on Private/Browser', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', sttPrivatePrimary: true });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 844 });

    // Selected-mode STT ⓘ — opens on tap, fully readable, no clip.
    await page.getByTestId('stt-mode-help').click();
    await expect(page.getByTestId('stt-mode-help-content')).toBeVisible();
    await assertInViewport(await page.getByTestId('stt-mode-help-content').boundingBox(), 390);
    // The touch help lists Private + Browser only — no Cloud About entry.
    await expect(page.getByTestId('stt-about-cloud')).toHaveCount(0);
    await page.screenshot({ path: '/tmp/ss-mobile-stt-help.png' });
    await page.keyboard.press('Escape');

    // Session-feedback ⓘ — same component, also fully readable, no clip.
    await page.getByTestId('score-help').click();
    await expect(page.getByTestId('score-help-content')).toBeVisible();
    await assertInViewport(await page.getByTestId('score-help-content').boundingBox(), 390);
    await page.keyboard.press('Escape');

    // Desktop: the single controlled dropdown flyout reveals on hover — on the Browser row (Cloud is absent).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toHaveCount(0);
    await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).hover();
    const fly = page.getByTestId('stt-mode-flyout');
    await expect(fly).toBeVisible();
    await expect(fly).toHaveAttribute('data-mode', 'native');
    await expect(fly).toContainText(/browser.s (built-in )?speech recognition/i);
    await page.screenshot({ path: '/tmp/ss-desktop-dropdown-browser.png' });
  });
});
