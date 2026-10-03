/**
 * #1258 — open one item of the header Products menu, on whichever header this viewport renders.
 *
 * Run 36834757084 (returning-user RWT, e4d5e9a54) waited the full 5-minute test limit for
 * `nav-products-focus-points`: Products → Open Mic had just closed the menu, the next Products press landed while
 * that menu was still leaving the page, and a press during the exit can fail to open it (mocked-backend reproduction
 * with the old helper: 7 of 10 runs). Nothing pressed Products again, so the item never appeared. So: wait until no
 * menu is on the page, press Products, prove it opened, then choose the item — every wait bounded, so a real failure
 * is a visible error, not a hang.
 */
import { expect, type Page } from '@playwright/test';

export type ProductsMenuItem = 'open-mic' | 'focus-points';

export const PRODUCTS_MENU_TIMEOUT_MS = 20_000;

export async function openProductsItem(page: Page, item: ProductsMenuItem, timeout = PRODUCTS_MENU_TIMEOUT_MS): Promise<void> {
    const desktop = page.getByTestId('nav-products-button');
    const isDesktop = await desktop.isVisible().catch(() => false);
    const trigger = isDesktop ? desktop : page.getByTestId('nav-mobile-products-button');
    await expect(page.getByRole('menu'), 'the previous Products menu has finished closing').toHaveCount(0, { timeout });
    await trigger.click({ timeout });
    await expect(trigger, 'the Products menu opened').toHaveAttribute('aria-expanded', 'true', { timeout });
    await page.getByTestId(isDesktop ? `nav-products-${item}` : `nav-mobile-products-${item}`).click({ timeout });
}
