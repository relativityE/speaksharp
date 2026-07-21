import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * The session ⓘ help popovers (selected-mode STT help + SpeakSharp Score help) must stay
 * fully inside the viewport on a mobile width — no left/right clipping. The #952 desktop
 * dropdown hover tooltip must remain unchanged.
 */
test.describe('Help popover mobile readability', () => {
  const assertInViewport = async (box: { x: number; width: number } | null, viewportWidth: number) => {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  };

  test('ⓘ help stays inside the viewport on mobile; desktop dropdown tooltip unchanged', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 844 });

    // Selected-mode STT ⓘ — opens on tap, fully readable, no clip.
    await page.getByTestId('stt-mode-help').click();
    await expect(page.getByTestId('stt-mode-help-content')).toBeVisible();
    await assertInViewport(await page.getByTestId('stt-mode-help-content').boundingBox(), 390);
    await page.screenshot({ path: '/tmp/ss-mobile-stt-help.png' });
    await page.keyboard.press('Escape');

    // SpeakSharp Score ⓘ — same component, also fully readable, no clip.
    await page.getByTestId('score-help').click();
    await expect(page.getByTestId('score-help-content')).toBeVisible();
    await assertInViewport(await page.getByTestId('score-help-content').boundingBox(), 390);
    await page.screenshot({ path: '/tmp/ss-mobile-score-help.png' });
    await page.keyboard.press('Escape');

    // Desktop: the single controlled dropdown description flyout still reveals on hover (unchanged).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
    await page.getByTestId(TEST_IDS.STT_MODE_CLOUD).hover();
    const fly = page.getByTestId('stt-mode-flyout');
    await expect(fly).toBeVisible();
    await expect(fly).toHaveAttribute('data-mode', 'cloud');
    await expect(fly).toContainText(/external transcription server/i);
    await page.screenshot({ path: '/tmp/ss-desktop-dropdown-after-clamp.png' });
  });
});
