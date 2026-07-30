import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * #1047 conversion repair — the Free→Private trial nudge and the anonymous `?trial=private` handoff,
 * exercised end-to-end against the real app lifecycle (mocked network). An eligible Free account has an
 * AVAILABLE Private sample; the mock `check-usage-limit` reflects the mock profile's sample fields.
 */
const ELIGIBLE_SAMPLE = {
    private_sample_available: true,
    private_sample_limit_seconds: 300,
    private_sample_seconds_remaining: 300,
    private_sample_seconds_used: 0,
};

test.describe('#1047 Free→Private trial nudge + handoff', () => {
    test('eligible Free on an idle Browser session sees the nudge; "Try Private" selects Private (no auto-record)', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: ELIGIBLE_SAMPLE });
        await navigateToRoute(page, '/session', { waitForMocks: false });

        // Browser is the default mode; the eligible Free account is offered the trial nudge.
        const nudge = page.getByTestId('private-trial-nudge');
        await expect(nudge).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('private-trial-nudge-title')).toHaveText('5-minute Private trial available');
        await expect(page.getByTestId('stt-mode-select')).toContainText('Browser');

        // "Try Private" selects Private only — it does NOT start recording (the timer stays idle).
        await page.getByTestId('private-trial-nudge-cta').click();
        await expect(page.getByTestId('stt-mode-select')).toContainText('Private'); // Private now selected
        await expect(nudge).toBeHidden();                                            // nudge only shows on Browser
        await expect(page.getByTestId('session-timer')).toHaveAttribute('data-timer-active', 'false'); // never auto-records
    });

    test('anonymous handoff: /session?trial=private preselects Private for an eligible account', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { userType: 'free', mockProfile: ELIGIBLE_SAMPLE });
        await navigateToRoute(page, '/session?trial=private', { waitForMocks: false });

        // The intent preselects Private → the nudge is not shown (Private already selected), the mode
        // selector reads Private, and no unavailable-notice is present (the account IS eligible).
        await expect(page.getByTestId('stt-mode-select')).toContainText('Private', { timeout: 30000 });
        await expect(page.getByTestId('private-trial-nudge')).toHaveCount(0);
        await expect(page.getByTestId('private-trial-unavailable-notice')).toHaveCount(0);
    });
});
