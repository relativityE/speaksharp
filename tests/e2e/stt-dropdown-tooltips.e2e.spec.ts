import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * PO requirement: hovering (or keyboard-focusing) a mode in the STT dropdown — Private (Recommended),
 * Browser, Cloud — reveals that mode's approved description. There is ONE controlled description
 * surface (`stt-mode-flyout`) that follows the active row — never three independent bubbles. (Full
 * geometry/containment coverage lives in mode-selector-private-first.e2e.spec.ts.)
 */
test.describe('STT dropdown option description (single controlled surface)', () => {
  test('one flyout follows the active mode on hover and keyboard focus', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    // Open the mode dropdown; Private-first order + labels: Private (Recommended), Browser, Cloud.
    await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_NATIVE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toBeVisible();

    const fly = page.getByTestId('stt-mode-flyout');

    // Keyboard focus reveals the description: ArrowDown highlights the first item (Private, Recommended).
    await page.keyboard.press('ArrowDown');
    await expect(fly).toBeVisible();
    await expect(fly).toHaveAttribute('data-mode', 'private');
    // Still exactly one surface.
    expect(await fly.count()).toBe(1);

    // Hover Cloud → the SAME single surface switches to Cloud's approved copy.
    await page.getByTestId(TEST_IDS.STT_MODE_CLOUD).hover();
    await expect(fly).toHaveAttribute('data-mode', 'cloud');
    await expect(fly).toContainText(/external transcription server/i);
    expect(await fly.count()).toBe(1);

    // Hover Browser.
    await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).hover();
    await expect(fly).toHaveAttribute('data-mode', 'native');
    await expect(fly).toContainText(/browser.s speech service/i);
    expect(await fly.count()).toBe(1);

    // Hover Private (now the first, Recommended item).
    await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).hover();
    await expect(fly).toHaveAttribute('data-mode', 'private');
    await expect(fly).toContainText(/on your device/i);
    expect(await fly.count()).toBe(1);
  });
});
