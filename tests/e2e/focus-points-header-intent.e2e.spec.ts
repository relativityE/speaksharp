/**
 * Header → Focus Points intent (#1543 CI flake root cause, #1258 PM RETURN 5901196048) — real browser, mocked backend.
 *
 * `/session` → Products → Focus Points navigates to `/practice?product=focus-points`. The url IS the intent: the setup
 * stays open across a reload while the person is still choosing points, Escape ends it, and SAVING ends it too — Back
 * from the session must not reopen a blank setup for a brief that was already saved (a duplicate capture).
 *
 * #1545 (Escape CONTROL failure, run 36660747085): the route exit layer restored stale route children after the
 * header transition — Escape closed the setup and it reopened, and the Practice page that had just appeared was
 * remounted (a keypress lost, typed text dropped). Those two tests run with the CPU slowed through CDP so the
 * transition window is wide enough to hit reliably (mocked-backend browser evidence, not Production).
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

const POINTS = ['Name the price', 'State the guarantee', 'Explain the timeline'] as const;

const SLOWED_CPU_RATE = 12;

async function focusPointsFromSessionHeader(page: Page, { slowCpu = false, onSession }: { slowCpu?: boolean; onSession?: () => Promise<void> } = {}) {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');
    if (slowCpu) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWED_CPU_RATE });
    }
    await page.getByTestId('practice-card-freeform').click();
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30_000 });
    await onSession?.();
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

    test('CASUALTY: Escape during the header transition closes the setup and it stays closed (Home stays Home)', async ({ page }) => {
        await focusPointsFromSessionHeader(page, { slowCpu: true });
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/\/practice$/, { timeout: 10_000 });
        await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
        // Past every route animation: a restored stale page used to reopen the setup from the old url here.
        await page.waitForTimeout(2_000);
        await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0);
        await expect(page.getByTestId('practice-root')).toHaveCount(1);
    });

    test('CASUALTY: typing into the setup during the header transition is kept — the page is not remounted', async ({ page }) => {
        await focusPointsFromSessionHeader(page, {
            slowCpu: true,
            // Count every first-point input ever attached from here on: one setup should mean exactly one input.
            onSession: () => page.evaluate(() => {
                const w = window as Window & { __setupInputsAttached?: number };
                w.__setupInputsAttached = 0;
                const seen = new WeakSet<Element>();
                new MutationObserver(() => {
                    document.querySelectorAll('[data-testid="objective-point-label-0"]').forEach((el) => {
                        if (!seen.has(el)) { seen.add(el); w.__setupInputsAttached = (w.__setupInputsAttached ?? 0) + 1; }
                    });
                }).observe(document.body, { childList: true, subtree: true });
            }),
        });
        const field = page.getByTestId('objective-point-label-0');
        await field.fill(POINTS[0]);
        await page.waitForTimeout(2_000);
        await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
        await expect(field).toHaveValue(POINTS[0]);
        // The setup was built once: the page was not unmounted and mounted again around the person's typing.
        expect(await page.evaluate(() => (window as Window & { __setupInputsAttached?: number }).__setupInputsAttached)).toBe(1);
    });
});
