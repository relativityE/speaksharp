import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * #1184: Private is the ONLY engine — there is no selector and no Native/Cloud choice.
 *
 * Start the take with its ONE control, arming the authoritative start BEFORE the click. A warm browser
 * shows `mic-start`. A cold one shows `mic-download`, and since #1415/#1416 that single activation
 * downloads the model AND records — it is not a download-only step. The retired `ensurePrivateReady`
 * clicked `mic-download` to "ready" the recorder and then waited for an idle, enabled `mic-start` that its
 * own click had already consumed: Production was recording while the canary waited for a Start it could
 * never see (run 35646081865, `594e95ac`). Either path is exactly one click, so the
 * `create_session_and_update_usage` response is armed first and captured on both, and exactly one
 * session is written. The cold budget covers the one-time model download that precedes the start.
 *
 * The path taken is returned and attached, so a warm run can never again pass while silently skipping
 * the first-run journey every new account takes.
 */
export async function startTake(page: Page): Promise<{ authoritativeStart: Promise<Response>; path: 'cold' | 'warm' }> {
    const downloadBtn = page.getByTestId('mic-download');
    const startBtn = page.getByTestId('mic-start');
    await expect(downloadBtn.or(startBtn).first()).toBeVisible({ timeout: 15000 });
    const path: 'cold' | 'warm' = (await downloadBtn.count()) > 0 ? 'cold' : 'warm';
    const control: Locator = path === 'cold' ? downloadBtn.first() : startBtn;
    await expect(control).toBeEnabled({ timeout: 15000 });
    const authoritativeStart = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().includes('/rest/v1/rpc/create_session_and_update_usage'),
    { timeout: path === 'cold' ? 150000 : 20000 });
    await control.click();
    return { authoritativeStart, path };
}
