/**
 * RWT PRODUCT 2 — FOCUS POINTS SESSION (PO script RWT_TWO_PRODUCT_USER_JOURNEY, rows 8–12; #1258).
 *
 *   8. Products → Focus Points opens the setup (not a notice), and navigation opens no microphone;
 *   9. topic Other → "A better weekly team handoff", the four points, pace 1:00, Head to session;
 *  10. the rail during speech — each point's marker changes WHILE it is spoken (live), the next point is marked;
 *  11. Stop — the final point verdicts, n/4, and the per-point average = elapsed ÷ detected (not the 1:00 guide),
 *      against the persisted objective session and evidence;
 *  12. the saved session opens in Analytics with the same transcript.
 *
 * This spec plays the PO corpus, which should end 4/4. The partial/absent Dev fixture is its own spec
 * (`rwt-focus-points-partial.live.spec.ts`) because the fake-microphone file is a per-browser launch option.
 * Journey and verdicts: helpers/rwtFocusPointsJourney.ts.
 *
 * INDEPENDENT of the Open Mic suite. Same verdict model: FAIL is a product finding; HOLD is an evidence state.
 * The script is explicit that Stop-time-only detection FAILS row 10 — a marker that changes only after Stop is not
 * the requested live behaviour.
 *
 * DISPATCH: rc-gates.yml gate=gate-3-dast diagnostic_dast_spec=tests/live/rwt-focus-points-session.live.spec.ts
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
    launchOptions: { args: rwtLaunchArgs(loadRwtFixture('focus_points_tts'), { webgpu: WEBGPU }) },
});

test.describe('RWT — Focus Points @live', () => {
    const owner = { email: '', uid: '' };
    test.afterEach(async () => {
        await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
        owner.email = '';
        owner.uid = '';
    });

    test('PO corpus — all four points detected live', async ({ page }, testInfo) => {
        test.setTimeout(1_500_000); // cold model acquisition + a ~60 s take + review + Analytics
        await focusPointsJourney(page, testInfo, 'focus_points_tts', 'focus-points-session', owner);
    });
});
