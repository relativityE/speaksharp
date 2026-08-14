import { test, expect, type Page } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, startRecording, stopRecording } from './helpers';

/**
 * #1042 PR2 / #1116 — "How Open Mic works" Session help overlay.
 *
 * Proves the overlay's behavior on the deployed-equivalent built app: it lives in the session title
 * block, opens as a fully-opaque floating panel with THREE steps and a start CTA, closes on
 * Escape / Close / the CTA with focus return, is a bottom sheet on mobile, and is disabled (cannot
 * open) while a recording is active — never navigating and never starting a recording itself.
 *
 * Redesign note (#1116): the modal was cut from six steps + intro + closing paragraph to three
 * action items + a teal "Got it — start speaking" CTA; the intro/feedback paragraphs were removed.
 * The at-rest status bar it used to sit "above" is suppressed (#1046 slice 0), so this asserts the
 * button's placement in the title block instead.
 */

const DIR = 'test-results/freeform-help';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
// One of the three Private-only step action lines — proves the current product contract, not the
// retired multi-engine chooser copy.
const STEP_ACTION = 'Set up Private once';
const START_CTA = /got it — start speaking/i;

async function openSession(page: Page) {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15_000 }).catch(() => { /* some builds settle to IDLE */ });
    await expect(page.getByTestId('freeform-help-button')).toBeVisible({ timeout: 15_000 });
}

test.describe('#1042 PR2 Freeform help overlay', () => {
    test('desktop: opens with three steps + CTA, closes on Escape with focus return, disabled while recording', async ({ page }) => {
        await openSession(page);
        await page.setViewportSize(DESKTOP);

        const help = page.getByTestId('freeform-help-button');
        await expect(help).toHaveAttribute('aria-disabled', 'false');
        // The help affordance lives in the session title block (an entry point, not a status row).
        await expect(page.getByTestId('session-title-block')).toContainText('How');
        const inTitleBlock = await help.evaluate(
            (el) => !!el.closest('[data-testid="session-title-block"]'),
        );
        expect(inTitleBlock).toBe(true);

        await help.click();
        const overlay = page.getByTestId('freeform-help-overlay');
        await expect(overlay).toBeVisible();
        // The panel must be FULLY OPAQUE (no page bleed-through) — fail if it settles translucent.
        await expect
            .poll(async () => overlay.evaluate((el) => parseFloat(getComputedStyle(el).opacity || '1')))
            .toBe(1);
        // The redesigned content: exactly three steps, a real action line, and the start CTA.
        await expect(page.getByTestId('freeform-help-steps').getByRole('listitem')).toHaveCount(3);
        await expect(overlay).toContainText(STEP_ACTION);
        await expect(page.getByTestId('freeform-help-start')).toHaveText(START_CTA);
        await page.screenshot({ path: `${DIR}/01-desktop-open.png`, fullPage: true });

        // Escape closes and focus returns to the trigger.
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
        await expect(help).toBeFocused();

        // The primary CTA also closes the modal.
        await help.click();
        await expect(overlay).toBeVisible();
        await page.getByTestId('freeform-help-start').click();
        await expect(overlay).toHaveCount(0);

        // #1222 mockup: the whole title row (which hosts "How Open Mic works") is a BEFORE-state
        // affordance only — during recording it is dropped so the transcript/slots get the room. So once
        // recording starts, the help button is ABSENT (not merely disabled) and the overlay cannot open.
        await startRecording(page);
        await expect(page.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during', { timeout: 15_000 });
        await expect(page.getByTestId('freeform-help-button')).toHaveCount(0);
        await expect(page.getByTestId('freeform-help-overlay')).toHaveCount(0);
        await page.screenshot({ path: `${DIR}/02-desktop-disabled.png`, fullPage: true });
        // Stop the recording to leave a clean state.
        await stopRecording(page);
        await expect(page.locator('html')).not.toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 20_000 });
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
        await expect(overlay).toContainText(STEP_ACTION);
        await page.screenshot({ path: `${DIR}/03-mobile-open.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
    });
});
