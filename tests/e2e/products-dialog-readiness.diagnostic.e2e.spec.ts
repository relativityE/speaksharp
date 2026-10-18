/**
 * #1258 — the returning-user RWT Products bridge, mocked backend (run 36834757084 waited 5 minutes for
 * `nav-products-focus-points`). Products → Open Mic closes the menu; pressing Products again while that menu is still
 * leaving the page does not open it. The shared live helper must wait the exit out, so the same back-to-back sequence
 * the live suite performs reaches every destination here.
 */
import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';
import { openProductsItem } from '../live/helpers/productsMenu';

test.describe('Products dialog diagnostic — unchanged navigation order, retries zero', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            const win = window as Window & { __CLI_DIALOG_TRACE__?: unknown[] };
            const records: unknown[] = [];
            win.__CLI_DIALOG_TRACE__ = records;
            let previous = '';
            const snapshot = (event: string) => {
                const modal = document.querySelector('[data-testid="objective-setup-dialog"]');
                const active = document.activeElement;
                const state = {
                    modalPresent: !!modal,
                    modalState: modal?.getAttribute('data-state') ?? null,
                    menuStates: [...document.querySelectorAll('[role="menu"]')].slice(0, 4).map((menu) => menu.getAttribute('data-state')),
                    modalPointerEvents: modal instanceof HTMLElement ? getComputedStyle(modal).pointerEvents : null,
                    modalVisible: modal instanceof HTMLElement && modal.getClientRects().length > 0,
                    focusInsideModal: !!modal && modal.contains(active),
                    activeTag: active?.tagName ?? null,
                    activeRole: active?.getAttribute('role') ?? null,
                    bodyPointerEvents: document.body ? getComputedStyle(document.body).pointerEvents : null,
                    closeEnabled: modal?.querySelector('button')?.getAttribute('disabled') === null,
                };
                const identity = JSON.stringify(state);
                if (event === 'mutation' && identity === previous) return;
                previous = identity;
                if (records.length < 200) records.push({ event, at: performance.now(), ...state });
            };
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                snapshot('escape-capture');
                requestAnimationFrame(() => snapshot('escape-next-frame'));
            }, true);
            document.addEventListener('focusin', () => snapshot('focusin'), true);
            document.addEventListener('DOMContentLoaded', () => {
                new MutationObserver(() => snapshot('mutation')).observe(document.body, {
                    childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'style'],
                });
            }, { once: true });
        });
    });
    test.afterEach(async ({ page }, info) => {
        const records = await page.evaluate(() => (window as Window & { __CLI_DIALOG_TRACE__?: unknown[] }).__CLI_DIALOG_TRACE__ ?? []).catch(() => []);
        await info.attach('modal-readiness-and-escape', { body: JSON.stringify(records, null, 2), contentType: 'application/json' });
    });
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
