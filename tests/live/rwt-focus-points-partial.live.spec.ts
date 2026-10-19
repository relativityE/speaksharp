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
import { test } from './helpers/rwtProductionTest';
import { loadRwtFixture, rwtLaunchArgs } from './helpers/rwtJourney';
import { WEBGPU, focusPointsJourney } from './helpers/rwtFocusPointsJourney';
import { JourneyFinalizer } from './helpers/rwtWatchdog';

test.use({
    permissions: ['microphone'],
    // Signup types a password and the DOM later holds transcript and point text: no trace, video or screenshot.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(loadRwtFixture('focus_points_partial_tts'), { webgpu: WEBGPU }) },
});

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();

test.describe('RWT — Focus Points @live', () => {
    const owner = { email: '', uid: '' };
    test.afterEach(async () => {
        // #1593 (Sam, #1662 RETURN control 1): the journey's ONE owned finalization (rows, account cleanup, receipt) — the
        // same memoized run the journey's finally starts, so a test timeout still deletes the account and writes the receipt.
        await finalizer.drain();
        owner.email = '';
        owner.uid = '';
    });

    test('partial fixture — one paraphrased and one absent point', async ({ page }, testInfo) => {
        test.setTimeout(1_500_000); // cold model acquisition + a ~60 s take + review + Analytics
        await focusPointsJourney(page, testInfo, 'focus_points_partial_tts', 'focus-points-partial', owner, 4, finalizer);
    });
});
