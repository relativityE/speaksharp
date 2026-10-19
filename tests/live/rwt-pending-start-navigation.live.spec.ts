/**
 * RWT gap coverage — leaving Open Mic while a cold private-model Start is pending.
 *
 * This is a natural user-action check: it does not throttle, intercept, or fail any network request. A fresh disposable
 * account provides a cold model path; the test starts acquisition, leaves through Products, and checks that no microphone
 * or session survives. Preparation only; execution requires a fresh release-bound RWT authorization.
 */
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/rwtProductionTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RWT_CANARY_CLAIM_ACK_VALUE, RwtReceipt, canaryClaimAuthorized,
    installMicAcquisitionCounter, loadRwtFixture, markRunOwnedAccountCanary,
    newDisposableEmail, requireApprovedSurface, rwtLaunchArgs,
    rwtPreconditionFailures, runOwnedIdentityFailures, signUpDisposableAccount, telemetryClassRows, suppressPageSnapshot,
} from './helpers/rwtJourney';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { CoachingGenerationTap } from './helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from './helpers/rwtCoachingCollector';
import { openProductsItem } from './helpers/productsMenu';
import { selectBenchmarkMode } from './helpers/benchmark-utils';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';

const SUITE = 'pending-start-navigation';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
const fixture = loadRwtFixture('open_mic_tts');

async function readMicEvidence(page: Page): Promise<{ acquisitions: number; liveTracks: number }> {
    const state = await page.evaluate(() => {
        const w = window as unknown as { __rwtMicAcquisitions__?: number[]; __rwtMicStreams__?: MediaStream[] };
        const acquisitions = w.__rwtMicAcquisitions__;
        const streams = w.__rwtMicStreams__;
        const media = navigator.mediaDevices;
        const originalGetUserMedia = media ? Object.getPrototypeOf(media)?.getUserMedia : undefined;
        const counterInstalled = Boolean(media && Object.prototype.hasOwnProperty.call(media, 'getUserMedia')
            && media.getUserMedia !== originalGetUserMedia);
        if (!media || typeof media.getUserMedia !== 'function' || !counterInstalled
            || !Array.isArray(acquisitions) || !Array.isArray(streams)
            || !acquisitions.every((at) => Number.isFinite(at))) return null;
        const tracks = streams.flatMap((stream) => stream.getAudioTracks());
        if (tracks.some((track) => track.readyState !== 'live' && track.readyState !== 'ended')) return null;
        return {
            acquisitions: acquisitions.length,
            liveTracks: tracks.filter((track) => track.readyState === 'live').length,
        };
    });
    if (!state) throw new Error('microphone acquisition/track evidence was unavailable or malformed');
    return state;
}

async function readSessionIds(uid: string): Promise<string[]> {
    const { data, error } = await admin!.from('sessions').select('id').eq('user_id', uid).order('id');
    if (error || !Array.isArray(data) || data.some((row) => typeof row.id !== 'string')) {
        throw new Error(`session identity read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    }
    return data.map((row) => String(row.id));
}

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();
test.afterEach(async () => {
    await finalizer.drain();
});

test('leaving during a cold Start does not leave a recording or session behind @live', async ({ page }, testInfo) => {
    test.setTimeout(1_500_000);
    const receipt = new RwtReceipt(SUITE);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    tap.attach(page); generations.attach(page);
    let email = '';
    let uid = '';
    let claimed = false;
    let accountDeleted = false;
    const owner = { uid: '', email: '' };
    // #1593 fail early: an unexpected failure, refusal or stall (case 4's dead Start) ends the journey in seconds.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(SUITE), label: SUITE });
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        await steps.step('watchdog', () => watch.record(receipt));
        await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
        // Abandoning a pending Start and returning saves nothing, so the whole scenario sends no coaching request.
        await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 0 }));
        // A signup that died before its uid was read is still found by its created email.
        if ((uid || email) && !accountDeleted) {
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion; its own settlement decides the row.
            accountDeleted = (await finalizeOwnedCleanup(steps, receipt, new OwnedCleanup(
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: uid, createdEmail: email, runOwnedPrefix: RWT_ACCOUNT_PREFIX })))) === 'deleted';
        }
        await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, false));
        steps.report(receipt);
        receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
    });
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
        owner.email = email;
        receipt.forbid(email, SERVICE_ROLE);
        const account = await signUpDisposableAccount(page, email);
        uid = account.uid;
        owner.uid = uid;
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
        if (!claimVisible) {
            receipt.halt('canary claim', 'HOLD before navigation scenario: the fresh-login canary claim was absent');
            return;
        }

        await page.goto('/practice');
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });
        await selectBenchmarkMode(page, 'private');
        await page.waitForFunction(() => document.documentElement.getAttribute('data-model-status') === 'download-required', undefined, { timeout: 60_000 });
        const sessionIdentityBefore = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
        const sessionIdsBefore = await readSessionIds(uid);
        receipt.row('cold Start is pending', 'PASS', 'the cold private model is waiting for the person’s Start action', { priorSessions: sessionIdsBefore.length });

        // This is the normal product CTA, not a synthetic network delay. Navigate away as soon as the real UI
        // reports its acquisition phase; the route change is the user's cancellation action under test.
        // #1593 (Sam, #1662 RETURN control 3): the abandoned Start's own cancellation (and the return's gate) is this
        // journey's expected fault — from the press until the return has been checked.
        watch.setFaultPhase(true);
        await page.getByTestId('mic-download').click({ timeout: 15_000 });
        // Codex P1 r4247193674: TranscriptionService publishes BOTH DOWNLOADING and ENGINE_INITIALIZING as the root
        // `data-model-status="loading"`; `downloading`/`initializing` are never written, so only `loading` is the pending Start.
        const pendingObserved = await page.waitForFunction(
            () => document.documentElement.getAttribute('data-model-status') === 'loading',
            undefined, { timeout: 15_000 }).then(() => true).catch(() => false);
        receipt.row('Start transition observed', pendingObserved ? 'PASS' : 'HOLD', pendingObserved
            ? 'the user-triggered Start left the cold waiting state before navigation'
            : 'the pending Start transition was too brief or could not be observed; cancellation is not qualified');
        const micAtLeave = await readMicEvidence(page);
        await openProductsItem(page, 'focus-points');
        await page.waitForURL(/\/practice\?product=focus-points/, { timeout: 45_000 });
        // #1258 (live round 1, run 38847635290): Focus Points opens its setup as a MODAL over the header. A person closes it
        // before using Products again — exactly as the returning-user journey does — so the return below is reachable.
        const setupOpen = await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
        if (setupOpen) {
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0, { timeout: 10_000 });
        }
        // Codex P1 r4247193687: a correctly CANCELLED Start retires the engine on unmount and publishes `idle` (or returns
        // to `download-required`); completion publishes `ready`, failure `error`/`init-failed`. Any readable status other
        // than `loading` is a settled abandoned Start — requiring completion or failure would HOLD every good cancellation.
        const startSettledAfterLeave = await page.waitForFunction(() => {
            const status = document.documentElement.getAttribute('data-model-status');
            return status !== null && status !== 'loading';
        }, undefined, { timeout: 600_000 }).then(() => true).catch(() => false);
        receipt.row('abandoned Start settles after leaving', startSettledAfterLeave ? 'PASS' : 'HOLD', startSettledAfterLeave
            ? 'the pending model/start operation reached a terminal state after navigation'
            : 'the operation did not reach a readable terminal state; delayed Start remains unproven');
        if (startSettledAfterLeave) await page.waitForTimeout(2_000);
        const recorderStillVisible = await page.getByTestId('recorder-stop').count().then((n) => n > 0);
        const micAfterLeave = await readMicEvidence(page);
        const noLateAcquisition = micAfterLeave.acquisitions === micAtLeave.acquisitions;
        const released = !recorderStillVisible && micAfterLeave.liveTracks === 0 && noLateAcquisition;
        receipt.row('leaving pending Start releases microphone', released ? 'PASS' : 'FAIL',
            released ? 'after leaving Open Mic, no recorder, live microphone track, or later acquisition remained'
                : 'a recorder remained, a mic track stayed live, or acquisition continued after leaving',
            { recorderVisible: recorderStillVisible, liveTracks: micAfterLeave.liveTracks, acquisitionsAtLeave: micAtLeave.acquisitions, acquisitionsAfterLeave: micAfterLeave.acquisitions });
        const sessionIdsAfterLeave = await readSessionIds(uid);
        const sameSessionIdentityAfterLeave = JSON.stringify(sessionIdsAfterLeave) === JSON.stringify(sessionIdsBefore);
        receipt.row('leaving pending Start creates no session', sameSessionIdentityAfterLeave ? 'PASS' : 'FAIL',
            sameSessionIdentityAfterLeave ? 'abandonment left the account session identities unchanged' : 'abandonment created or changed a session identity',
            { priorSessions: sessionIdsBefore.length, sessionsAfterLeave: sessionIdsAfterLeave.length });

        // Return through the real Products navigation. The previously abandoned operation must not resume recording,
        // reopen the microphone, or leave stale session state; the visible primary action must match the model state.
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });
        await expect(page.getByTestId('mic-card')).toBeVisible({ timeout: 30_000 });
        const modelStatus = await page.getByTestId('mic-card').getAttribute('data-model-status');
        const controlForStatus: Record<string, string> = {
            'download-required': 'mic-download',
            ready: 'mic-start',
            idle: 'mic-start',
            warming: 'mic-start',
            error: 'mic-retry',
            'init-failed': 'mic-retry',
        };
        const expectedControl = modelStatus ? controlForStatus[modelStatus] : undefined;
        const startControl = expectedControl ? page.getByTestId(expectedControl) : null;
        const startAvailable = Boolean(startControl)
            && await startControl!.isVisible().catch(() => false)
            && await startControl!.isEnabled().catch(() => false);
        // #1593 (case 4, run 39165065684): the FAIL named no cause. Record WHAT the return showed — which primary control
        // exists, whether it is visible/enabled, its closed aria-label (`Starting…` = a stale start wait, `…unavailable while
        // your last session finishes` = the Progress gate, plain `Start recording` disabled = runtime/finalizing state) and the
        // session-shell state — so a failure classifies its own cause. Closed product copy and booleans only.
        const controlState = async (id: string) => {
            const el = page.getByTestId(id);
            const present = (await el.count()) > 0;
            return {
                present,
                visible: present ? await el.first().isVisible().catch(() => false) : false,
                enabled: present ? await el.first().isEnabled().catch(() => false) : false,
                ariaLabel: present ? await el.first().getAttribute('aria-label').catch(() => null) : null,
            };
        };
        const [startState, downloadState, retryState] = await Promise.all([controlState('mic-start'), controlState('mic-download'), controlState('mic-retry')]);
        const shellState = await page.getByTestId('session-shell').first().getAttribute('data-session-state').catch(() => null);
        receipt.row('return to Open Mic exposes truthful Start state', startAvailable ? 'PASS' : 'FAIL',
            startAvailable ? `return shows the ${expectedControl} action for model state ${modelStatus}`
                : `return did not expose an enabled Start/retry action consistent with model state ${modelStatus ?? 'unreadable'}`,
            {
                modelStatus: modelStatus ?? null, expectedControl: expectedControl ?? null, shellState,
                startPresent: startState.present, startVisible: startState.visible, startEnabled: startState.enabled, startAriaLabel: startState.ariaLabel,
                downloadPresent: downloadState.present, downloadVisible: downloadState.visible, downloadEnabled: downloadState.enabled, downloadAriaLabel: downloadState.ariaLabel,
                retryPresent: retryState.present, retryVisible: retryState.visible, retryEnabled: retryState.enabled, retryAriaLabel: retryState.ariaLabel,
            });
        const recorderAfterReturn = await page.getByTestId('recorder-stop').count().then((n) => n > 0);
        const micAfterReturn = await readMicEvidence(page);
        const sessionIdsAfterReturn = await readSessionIds(uid);
        const sessionIdentityAfterReturn = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
        const noUnexpectedResume = !recorderAfterReturn && micAfterReturn.liveTracks === 0
            && micAfterReturn.acquisitions === micAtLeave.acquisitions
            && sessionIdentityAfterReturn === sessionIdentityBefore
            && JSON.stringify(sessionIdsAfterReturn) === JSON.stringify(sessionIdsBefore);
        receipt.row('return does not resume abandoned recording', noUnexpectedResume ? 'PASS' : 'FAIL',
            noUnexpectedResume ? 'return left the recorder stopped, mic evidence unchanged and saved session identities unchanged'
                : 'return resumed/acquired the mic or changed saved session identity after abandonment',
            { recorderVisible: recorderAfterReturn, liveTracks: micAfterReturn.liveTracks, acquisitions: micAfterReturn.acquisitions,
                priorSessions: sessionIdsBefore.length, sessionsAfterReturn: sessionIdsAfterReturn.length,
                sessionIdentityUnchanged: sessionIdentityAfterReturn === sessionIdentityBefore });
    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        await finish();
    }
});
