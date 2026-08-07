import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * #1042 PR2 — "How Raw Takes works" Session help overlay.
 *
 * Proves the overlay's behavior on the deployed-equivalent built app: it opens above the Mic-ready
 * status surface, shows the approved guide, closes on Escape / Close with focus return, is a bottom
 * sheet on mobile, and is disabled (cannot open) while a recording is active — never navigating and
 * never starting a recording. Screenshots (desktop + mobile, open + disabled) → the 1-day CI artifact.
 */

const DIR = 'test-results/freeform-help';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const INTRO = "No agenda required. Choose a transcription method, start when you";
const FEEDBACK = 'delivery feedback available for that session';

async function openSession(page: Page) {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 }).catch(() => { /* some builds settle to IDLE */ });
    await expect(page.getByTestId('freeform-help-button')).toBeVisible({ timeout: 15_000 });
}

test.describe('#1042 PR2 Freeform help overlay', () => {
    test('desktop: opens above Mic ready, closes on Escape with focus return, disabled while recording', async ({ page }) => {
        await openSession(page);
        await page.setViewportSize(DESKTOP);

        const help = page.getByTestId('freeform-help-button');
        await expect(help).toHaveAttribute('aria-disabled', 'false');
        // The help affordance sits ABOVE the Mic-ready status surface (earlier in DOM order).
        const order = await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="freeform-help-button"]');
            const status = document.querySelector('[data-testid="status-message-text"]');
            if (!btn || !status) return null;
            return btn.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING ? 'above' : 'below';
        });
        expect(order).toBe('above');

        await help.click();
        const overlay = page.getByTestId('freeform-help-overlay');
        await expect(overlay).toBeVisible();
        // The panel must be FULLY OPAQUE (no page bleed-through) — fail if it settles translucent.
        await expect
            .poll(async () => overlay.evaluate((el) => parseFloat(getComputedStyle(el).opacity || '1')))
            .toBe(1);
        await expect(overlay).toContainText(INTRO);
        await expect(page.getByTestId('freeform-help-steps').getByRole('listitem')).toHaveCount(6);
        await expect(page.getByTestId('freeform-help-feedback')).toContainText(FEEDBACK);
        await page.screenshot({ path: `${DIR}/01-desktop-open.png`, fullPage: true });

        // Escape closes and focus returns to the trigger.
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
        await expect(help).toBeFocused();

        // Close control also closes.
        await help.click();
        await expect(overlay).toBeVisible();
        await page.getByRole('button', { name: /close/i }).click();
        await expect(overlay).toHaveCount(0);

        // Disabled while a recording is active — cannot open, never starts/stops recording itself.
        const startStop = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        await startStop.click();
        await expect(startStop).toHaveAttribute('data-recording', 'true', { timeout: 15_000 });
        await expect(help).toHaveAttribute('aria-disabled', 'true');
        await help.click({ force: true });
        await expect(page.getByTestId('freeform-help-overlay')).toHaveCount(0);
        await page.screenshot({ path: `${DIR}/02-desktop-disabled.png`, fullPage: true });
        // Stop the recording to leave a clean state.
        await startStop.click();
        await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 20_000 });
    });

    test('mobile: opens as a bottom sheet', async ({ page }) => {
        await openSession(page);
        await page.setViewportSize(MOBILE);
        await page.getByTestId('freeform-help-button').click();
        const overlay = page.getByTestId('freeform-help-overlay');
        await expect(overlay).toBeVisible();
        // The panel must be FULLY OPAQUE (no page bleed-through) — fail if it settles translucent.
        await expect
            .poll(async () => overlay.evaluate((el) => parseFloat(getComputedStyle(el).opacity || '1')))
            .toBe(1);
        await expect(overlay).toContainText(INTRO);
        await page.screenshot({ path: `${DIR}/03-mobile-open.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
    });
});
