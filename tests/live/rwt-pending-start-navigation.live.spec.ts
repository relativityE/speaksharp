/**
 * RWT gap coverage — leaving Open Mic while a cold private-model Start is pending.
 *
 * This is a natural user-action check: it does not throttle, intercept, or fail any network request. A fresh disposable
 * account provides a cold model path; the test starts acquisition, leaves through Products, and checks that no microphone
 * or session survives. Preparation only; execution requires a fresh release-bound RWT authorization.
 */
import { createClient } from '@supabase/supabase-js';
import { test } from './helpers/rwtProductionTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RWT_CANARY_CLAIM_ACK_VALUE, RwtReceipt, canaryClaimAuthorized,
    installMicAcquisitionCounter, loadRwtFixture, markRunOwnedAccountCanary,
    micAcquisitions, newDisposableEmail, liveMicTracks, requireApprovedSurface, rwtLaunchArgs,
    rwtPreconditionFailures, runOwnedIdentityFailures, signUpDisposableAccount, telemetryClassRows, suppressPageSnapshot,
} from './helpers/rwtJourney';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { openProductsItem } from './helpers/productsMenu';
import { selectBenchmarkMode } from './helpers/benchmark-utils';

const SUITE = 'pending-start-navigation';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
const fixture = loadRwtFixture('open_mic_tts');

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});

test('leaving during a cold Start does not leave a recording or session behind @live', async ({ page }, testInfo) => {
    test.setTimeout(1_500_000);
    const receipt = new RwtReceipt(SUITE);
    const tap = new AnalyticsTap();
    tap.attach(page);
    let email = '';
    let uid = '';
    let claimed = false;
    let accountDeleted = false;
    try {
        await suppressPageSnapshot(testInfo);
        const missing = rwtPreconditionFailures();
        if (!canaryClaimAuthorized() || process.env.RWT_CANARY_CLAIM_ACK !== RWT_CANARY_CLAIM_ACK_VALUE) {
            missing.push('AUTHORIZATION GATE: the separate run-owned canary-claim acknowledgement is absent');
        }
        if (missing.length > 0) {
            receipt.halt('preflight', `HOLD before Production writes: ${missing.join('; ')}`);
            return;
        }
        await installMicAcquisitionCounter(page);
        await page.goto('/auth/signup');
        await requireApprovedSurface(page, receipt);
        email = newDisposableEmail('pending-start');
        receipt.forbid(email, SERVICE_ROLE);
        const account = await signUpDisposableAccount(page, email);
        uid = account.uid;
        const identity = await runOwnedIdentityFailures(admin as never, uid, email);
        if (identity.length > 0) throw new Error(`run-owned identity preflight failed: ${identity.join('; ')}`);
        receipt.row('run-owned signup', 'PASS', 'fresh disposable account and profile verified');
        claimed = await markRunOwnedAccountCanary(admin as never, uid, email);
        if (!claimed) {
            receipt.halt('canary claim', 'HOLD before qualifying traffic: the run-owned canary claim was not applied');
            return;
        }
        await account.signOutAndSignIn();
        const claimVisible = await page.evaluate(() => Object.keys(localStorage).some((key) => {
            if (!/^sb-.*-auth-token$/.test(key)) return false;
            try { return JSON.parse(localStorage.getItem(key) ?? '{}').user?.app_metadata?.canary === true; }
            catch { return false; }
        }));
        receipt.row('canary claim in fresh login', claimVisible ? 'PASS' : 'FAIL', claimVisible
            ? 'fresh sign-in carries the run-owned server-issued canary claim' : 'fresh sign-in lacks the run-owned canary claim');

        await page.goto('/practice');
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });
        await selectBenchmarkMode(page, 'private');
        await page.waitForFunction(() => document.documentElement.getAttribute('data-model-status') === 'download-required', undefined, { timeout: 60_000 });
        const { count: before, error: beforeError } = await admin!.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid);
        if (beforeError) throw new Error(`pre-start session read failed (fail closed): ${beforeError.code ?? 'unknown'}`);
        receipt.row('cold Start is pending', 'PASS', 'the cold private model is waiting for the person’s Start action', { priorSessions: before ?? 0 });

        // This is the normal product CTA, not a synthetic network delay. Navigate away as soon as the real UI
        // reports its acquisition phase; the route change is the user's cancellation action under test.
        await page.getByTestId('mic-download').click({ timeout: 15_000 });
        const pendingObserved = await page.waitForFunction(() => {
            const status = document.documentElement.getAttribute('data-model-status');
            return status === 'downloading' || status === 'initializing';
        }, undefined, { timeout: 15_000 }).then(() => true).catch(() => false);
        receipt.row('Start transition observed', pendingObserved ? 'PASS' : 'HOLD', pendingObserved
            ? 'the user-triggered Start left the cold waiting state before navigation'
            : 'the pending Start transition was too brief or could not be observed; cancellation is not qualified');
        const countAtLeave = (await micAcquisitions(page)).length;
        await openProductsItem(page, 'focus-points');
        await page.waitForURL(/\/practice\?product=focus-points/, { timeout: 45_000 });
        const startSettledAfterLeave = await page.waitForFunction(() => {
            const status = document.documentElement.getAttribute('data-model-status');
            return status === 'ready' || status === 'error' || status === 'init-failed';
        }, undefined, { timeout: 600_000 }).then(() => true).catch(() => false);
        receipt.row('abandoned Start settles after leaving', startSettledAfterLeave ? 'PASS' : 'HOLD', startSettledAfterLeave
            ? 'the pending model/start operation reached a terminal state after navigation'
            : 'the operation did not reach a readable terminal state; delayed Start remains unproven');
        if (startSettledAfterLeave) await page.waitForTimeout(2_000);
        const recorderStillVisible = await page.getByTestId('recorder-stop').count().then((n) => n > 0).catch(() => false);
        const activeTracks = await liveMicTracks(page).catch(() => null);
        const afterAcquisitions = (await micAcquisitions(page).catch(() => []));
        const noLateAcquisition = afterAcquisitions.length === countAtLeave;
        const released = !recorderStillVisible && activeTracks === 0 && noLateAcquisition;
        receipt.row('leaving pending Start releases microphone', released ? 'PASS' : 'FAIL',
            released ? 'after leaving Open Mic, no recorder, live microphone track, or later acquisition remained'
                : 'a recorder remained, microphone state was live/unreadable, or acquisition continued after leaving',
            { recorderVisible: recorderStillVisible, liveTracks: activeTracks, acquisitionsAtLeave: countAtLeave, acquisitionsAfterLeave: afterAcquisitions.length });
        const { count: after, error: afterError } = await admin!.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid);
        if (afterError) throw new Error(`post-navigation session read failed (fail closed): ${afterError.code ?? 'unknown'}`);
        receipt.row('leaving pending Start creates no session', (after ?? 0) === (before ?? 0) ? 'PASS' : 'FAIL',
            (after ?? 0) === (before ?? 0) ? 'no session row was left by the abandoned Start' : 'the abandoned Start left a session row',
            { priorSessions: before ?? 0, sessionsAfterLeave: after ?? 0 });
    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        if (uid && !accountDeleted) {
            try {
                await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: uid, createdEmail: email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
                accountDeleted = true;
                receipt.row('run-owned cleanup', 'PASS', 'the run-owned account was deleted and residue checks passed');
            } catch {
                receipt.row('run-owned cleanup', 'FAIL', 'run-owned account deletion or residue readback failed');
            }
        }
        telemetryClassRows(receipt, tap, claimed, false);
        receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
    }
});
