/**
 * Header → Focus Points intent (#1543 CI flake root cause, #1258 PM RETURN 5901196048) — real browser, mocked backend.
 *
 * `/session` → Products → Focus Points navigates to `/practice?product=focus-points`. The url IS the intent: the setup
 * stays open across a reload while the person is still choosing points, Escape ends it, and SAVING ends it too — Back
 * from the session must not reopen a blank setup for a brief that was already saved (a duplicate capture).
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

const POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline'] as const;

async function focusPointsFromSessionHeader(page: Page) {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30_000 });
    await page.getByTestId('nav-products-button').click();
    await page.getByTestId('nav-products-focus-points').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/practice\?product=focus-points$/);
}

test.describe('header → Focus Points: the url holds the intent until the person closes or completes the setup', () => {
    test('CASUALTY: save → session → Back does not reopen a blank setup', async ({ page }) => {
        await focusPointsFromSessionHeader(page);
        await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
        for (let i = 0; i < POINTS.length; i++) await page.getByTestId(`objective-point-label-${i}`).fill(POINTS[i]);
        await page.getByTestId('objective-setup-submit').click();
        await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30_000 });

        await page.goBack();
        await expect(page).not.toHaveURL(/product=focus-points/, { timeout: 10_000 });
        // Give a late-mounting page every chance to (wrongly) reopen the setup before asserting it did not.
        await page.waitForTimeout(1_500);
        await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
    });

    test('CONTROL: the shared current-product state still says Focus Points after the page transition settles (#1545 P2 r4139959728; the race itself is proven by the PracticePage component casualty)', async ({ page }) => {
        await focusPointsFromSessionHeader(page);
        // Let every exiting page finish its exit animation; an exiting PracticePage used to clear the shared surface then.
        await page.waitForTimeout(1_500);
        await expect(page.getByTestId('nav-products-button')).toHaveAttribute('aria-current', 'page');
    });

    test('CONTROL: a reload while the setup is open keeps it open', async ({ page }) => {
        await focusPointsFromSessionHeader(page);
        await page.reload();
        await expect(page.getByTestId('objective-setup-dialog')).toBeVisible({ timeout: 30_000 });
        await expect(page).toHaveURL(/product=focus-points/);
    });

    test('CONTROL: Escape closes the setup and ends the intent (Home stays Home)', async ({ page }) => {
        await focusPointsFromSessionHeader(page);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
        await expect(page).toHaveURL(/\/practice$/);
        await page.waitForTimeout(1_000);
        await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
    });
});
