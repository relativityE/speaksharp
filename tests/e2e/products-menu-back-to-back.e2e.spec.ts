/**
 * #1258 — the returning-user RWT Products bridge, mocked backend (run 36834757084 waited 5 minutes for
 * `nav-products-focus-points`). Products → Open Mic closes the menu; pressing Products again while that menu is still
 * leaving the page does not open it. The shared live helper must wait the exit out, so the same back-to-back sequence
 * the live suite performs reaches every destination here.
 */
import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { openProductsItem } from '../live/helpers/productsMenu';

test.describe('Products menu used back to back (#1258 returning-user bridge)', () => {
    test('Practice → Open Mic → Focus Points setup → Open Mic, each through the header Products menu', async ({ page }) => {
        test.setTimeout(90_000);
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/practice');

        await openProductsItem(page, 'open-mic', 8_000);
        await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30_000 });

        // Immediately after the previous choice, as the live suite does.
        await openProductsItem(page, 'focus-points', 8_000);
        await expect(page.getByTestId('objective-setup-dialog')).toBeVisible({ timeout: 15_000 });

        await page.keyboard.press('Escape');
        await openProductsItem(page, 'open-mic', 8_000);
        await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30_000 });
    });
});
