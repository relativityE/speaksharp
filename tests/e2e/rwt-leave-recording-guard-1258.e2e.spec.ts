/**
 * #1258 RWT abandon/two-tabs (round 2, run 38876623812) — the navigate-away case waited 45 s for
 * `/practice?product=focus-points` after Products → Focus Points mid-recording, and the URL never changed.
 *
 * App.tsx installs an INTENDED in-app leave guard while a take is listening on /session: a capture-phase click on
 * any same-origin link off /session is prevented and the person is asked "A recording is still active. Stop and save
 * this session before leaving?". Playwright dismisses an unhandled dialog, which is the person choosing Cancel, so the
 * guard keeps them on the recording. These controls prove that mechanism offline, with the existing mock engine.
 */
import type { Dialog, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockLiveTranscript, navigateToRoute, startRecording } from './helpers';
import { openProductsItem } from '../live/helpers/productsMenu';
import { LEAVE_PROMPT_COPY as LEAVE_PROMPT, answerLeaveDialog, leavePromptVerdict, newLeaveDialogs } from '../live/helpers/rwtAbandonTakeover';

async function recordingOnSession(page: Page): Promise<void> {
    await navigateToRoute(page, '/session');
    await startRecording(page);
    await mockLiveTranscript(page, ['This take is recording when the person opens Products.']);
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING');
}

test.describe('#1258 RWT — Products → Focus Points while recording meets the leave guard', () => {
    test('an unanswered (dismissed) leave prompt keeps the person on the recording: the URL never reaches Focus Points', async ({ proPage: page }) => {
        await recordingOnSession(page);
        const prompts: { type: string; message: string }[] = [];
        page.on('dialog', (d: Dialog) => { prompts.push({ type: d.type(), message: d.message() }); void d.dismiss(); });

        await openProductsItem(page, 'focus-points');
        await expect.poll(() => prompts.length, { timeout: 5_000 }).toBe(1);
        expect(prompts[0], 'the guard asked before leaving').toEqual({ type: 'confirm', message: LEAVE_PROMPT });
        await page.waitForTimeout(2_000);
        expect(new URL(page.url()).pathname, 'Cancel keeps the person on the session').toBe('/session');
        await expect(page.locator('html'), 'and the take is still recording').toHaveAttribute('data-runtime-state', 'RECORDING');
    });

    test('the live spec\'s exact conditions (NO dialog handler): the URL never reaches Focus Points, as in run 38876623812', async ({ proPage: page }) => {
        await recordingOnSession(page);
        await openProductsItem(page, 'focus-points');
        const arrived = await page.waitForURL(/\/practice\?product=focus-points/, { timeout: 5_000 }).then(() => true, () => false);
        expect(arrived, 'Playwright dismissed the unhandled confirm, so the guard kept the page').toBe(false);
        await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING');
    });

    test('accepting the leave prompt stops the take, then lands on Focus Points setup', async ({ proPage: page }) => {
        await recordingOnSession(page);
        // The live spec's own narrow handler: only the first exact leave confirm is accepted (Sam 6218709582).
        const dialogs = newLeaveDialogs();
        const answerLeave = (d: Dialog) => {
            void (answerLeaveDialog(dialogs, { type: d.type(), message: d.message() }) === 'accept' ? d.accept() : d.dismiss());
        };
        page.on('dialog', answerLeave);
        let arrived = false;
        try {
            await openProductsItem(page, 'focus-points');
            arrived = await page.waitForURL(/\/practice\?product=focus-points/, { timeout: 30_000 }).then(() => true, () => false);
        } finally { page.off('dialog', answerLeave); }
        expect(dialogs, 'exactly one leave prompt, answered Leave; nothing else').toEqual({ prompts: 1, unexpectedDialogs: 0, stopFailedAlerts: 0 });
        expect(leavePromptVerdict({ ...dialogs, arrived }).status).toBe('PASS');
        await expect(page.locator('html'), 'the hard navigation left no live take').not.toHaveAttribute('data-runtime-state', 'RECORDING');
    });
});
