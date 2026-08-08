import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

/**
 * The session-feedback ⓘ help popover must stay fully inside the viewport on a mobile width — no
 * left/right clipping.
 *
 * #1184: the selected-mode STT ⓘ help and the STT dropdown hover flyout were removed with the
 * Private/Browser/Cloud selector (Private is the only engine), so only the session-feedback popover
 * remains to clamp-check here.
 */
test.describe('Help popover mobile readability', () => {
  const assertInViewport = async (box: { x: number; width: number } | null, viewportWidth: number) => {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  };

  test('session-feedback ⓘ help stays inside the viewport on mobile', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session?coaching=treatment');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 844 });

    // Session-feedback ⓘ — opens on tap, fully readable, no clip.
    await page.getByTestId('score-help').click();
    await expect(page.getByTestId('score-help-content')).toBeVisible();
    await assertInViewport(await page.getByTestId('score-help-content').boundingBox(), 390);
    await page.screenshot({ path: '/tmp/ss-mobile-score-help.png' });
  });
});
