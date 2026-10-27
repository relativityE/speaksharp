/**
 * RWT R3 (row 17) — adverse states on the deployed product, each on its own run-owned account and fresh browser context.
 *  - mic denied: in `rwt-adverse-mic-denied.live.spec.ts`, because its `=deny` launch options must be file-level.
 *  - download fails: the Private model's own-origin asset requests are refused on first acquisition. The page must state
 *    the failure with Retry, never claim ready, and stay Private with no Cloud request; once the fault is removed,
 *    Retry downloads the model and a take saves.
 *  - offline mid-download: the browser goes offline while the model is downloading, then back online; same assertions.
 * The journey itself is shared: helpers/rwtAdverseJourney.ts.
 * Live-only by necessity: the E2E build never loads the model. Receipts are content-free. Preparation only: execution
 * requires a fresh release-bound RWT authorization.
 */
import { test } from './helpers/rwtProductionTest';
import { rwtLaunchArgs } from './helpers/rwtJourney';
import { finalizer, fixture, runVariant } from './helpers/rwtAdverseJourney';

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});
test.describe.configure({ mode: 'serial' });

test.describe('RWT — adverse microphone and model states @live', () => {
    test.afterEach(async () => {
        await finalizer.drain();
    });

    test('model download fails: Retry, never ready, stays Private, no Cloud; fixed → Retry saves a take', async ({ page, browser }, testInfo) => {
        test.setTimeout(1_800_000);
        await runVariant(page, browser, testInfo, 'download-fails');
    });

    test('offline mid-download: Retry, never ready, stays Private, no Cloud; back online → Retry saves a take', async ({ page, browser }, testInfo) => {
        test.setTimeout(1_800_000);
        await runVariant(page, browser, testInfo, 'offline-mid-download');
    });
});
