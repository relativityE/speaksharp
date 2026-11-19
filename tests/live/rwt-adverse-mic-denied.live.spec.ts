/**
 * RWT R3 (row 17) — mic denied, on the deployed product with its own run-owned account and fresh browser: the browser's
 * microphone permission for the site is Blocked before Start. The page must say so, capture must never start, no take may
 * be saved for the test account, and no Cloud request may be made. J7.a scope (PO and Sam, 2026-11-19): the app never tries
 * to unblock the microphone and this test never allows it, so recovery on the same page is recorded as UNTESTED, never a pass.
 * The journey is shared with `rwt-adverse-mic-model.live.spec.ts` (helpers/rwtAdverseJourney.ts); this variant lives in its own file because its `=deny` launch options must be
 * file-level — Playwright refuses `launchOptions` inside a describe group, which left the variant uncollectable.
 * Live-only by necessity. Receipts are content-free. Preparation only: execution requires a fresh release-bound RWT
 * authorization.
 */
import { test } from './helpers/rwtProductionTest';
import { rwtLaunchArgs } from './helpers/rwtJourney';
import { finalizer, fixture, runVariant } from './helpers/rwtAdverseJourney';

/**
 * #1593 (live case 12, run 39167876945): `--use-fake-ui-for-media-stream` auto-approves every media request without
 * consulting the site permission, so the CDP "Blocked" setting never reached `getUserMedia` and the take recorded.
 * Local probe 2026-10-18 (Chromium, same flags): auto-approve → a live track even when denied; no flag → a
 * NotSupportedError, not a denial; `=deny` → the truthful NotAllowedError a blocked site setting produces. This
 * variant launches with `=deny` and no pre-granted permission, and nothing in it ever grants the microphone.
 */
test.use({
    permissions: [], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false })
        .map((a) => (a === '--use-fake-ui-for-media-stream' ? '--use-fake-ui-for-media-stream=deny' : a)) },
});
test.describe.configure({ mode: 'serial' });

test.describe('RWT — adverse microphone and model states @live', () => {
    test.afterEach(async () => {
        await finalizer.drain();
    });

    test.describe('mic denied (real permission decision)', () => {
        test('mic denied: stated truthfully, capture never starts, no take saved, no Cloud; same-page recovery untested', async ({ page, browser }, testInfo) => {
            test.setTimeout(1_800_000);
            await runVariant(page, browser, testInfo, 'mic-denied');
        });
    });
});
