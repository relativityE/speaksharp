/**
 * RWT PRODUCT 2 — FOCUS POINTS, PARTIAL DEV FIXTURE (PO script row 11: "Also test a separate Dev fixture with one
 * partial and one absent point so yellow and red/amber states are genuinely exercised").
 *
 * Points 1–2 spoken in full, point 3 only paraphrased, point 4 absent (tests/fixtures/rwt manifest). Independent of
 * the PO-corpus spec: own browser, account, receipt and cleanup. Journey and verdicts: helpers/rwtFocusPointsJourney.ts.
 *
 * DISPATCH: rc-gates.yml gate=gate-3-dast diagnostic_dast_spec=tests/live/rwt-focus-points-partial.live.spec.ts
 *           rwt_writes_ack=RWT-DISPOSABLE-ACCOUNT-WRITES [comparison_cell=v4:distil:q4/focus_points]
 */
import { test } from './helpers/deployedLiveTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import { RWT_ACCOUNT_PREFIX, loadRwtFixture, rwtLaunchArgs } from './helpers/rwtJourney';
import { WEBGPU, admin, focusPointsJourney } from './helpers/rwtFocusPointsJourney';

test.use({
    permissions: ['microphone'],
    // Signup types a password and the DOM later holds transcript and point text: no trace, video or screenshot.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(loadRwtFixture('focus_points_partial_tts'), { webgpu: WEBGPU }) },
});

test.describe('RWT — Focus Points @live', () => {
    const owner = { email: '', uid: '' };
    test.afterEach(async () => {
        await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
        owner.email = '';
        owner.uid = '';
    });

    test('partial fixture — one paraphrased and one absent point', async ({ page }, testInfo) => {
        test.setTimeout(1_500_000); // cold model acquisition + a ~60 s take + review + Analytics
        await focusPointsJourney(page, testInfo, 'focus_points_partial_tts', 'focus-points-partial', owner);
    });
});
