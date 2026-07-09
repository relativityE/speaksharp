import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * PO requirement: hovering (or keyboard-focusing) a mode in the STT dropdown —
 * Cloud, Browser, 🔒 Private — reveals that mode's approved description inline.
 * Not the native title= tooltip; a styled reveal via Radix data-highlighted.
 */
test.describe('STT dropdown option tooltips', () => {
  test('reveals each mode description on hover and keyboard focus', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 });

    // Open the mode dropdown; approved order + labels: Cloud, Browser, Private.
    await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_CLOUD)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_NATIVE)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.STT_MODE_PRIVATE)).toBeVisible();

    // Keyboard focus reveals the description: ArrowDown highlights the first item (Cloud),
    // with the pointer still on the trigger so there is no pointer/keyboard conflict.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('stt-desc-cloud')).toBeVisible();

    // Hover Cloud -> approved description reveals (and is actually visible via CSS).
    await page.getByTestId(TEST_IDS.STT_MODE_CLOUD).hover();
    await expect(page.getByTestId('stt-desc-cloud')).toBeVisible();
    await expect(page.getByTestId('stt-desc-cloud')).toContainText(/external transcription server/i);
    await page.screenshot({ path: '/tmp/ss-e2e-hover-cloud.png' });

    // Hover Browser.
    await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).hover();
    await expect(page.getByTestId('stt-desc-native')).toBeVisible();
    await expect(page.getByTestId('stt-desc-native')).toContainText(/browser.s speech service/i);
    await page.screenshot({ path: '/tmp/ss-e2e-hover-browser.png' });

    // Hover Private (the last item).
    await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).hover();
    await expect(page.getByTestId('stt-desc-private')).toBeVisible();
    await expect(page.getByTestId('stt-desc-private')).toContainText(/on your device/i);
    await page.screenshot({ path: '/tmp/ss-e2e-hover-private.png' });
  });
});
