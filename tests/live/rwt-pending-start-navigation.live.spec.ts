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
import { openProductsItem } from './helpers/productsMenu';
import { selectBenchmarkMode } from './helpers/benchmark-utils';

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

test('leaving during a cold Start does not leave a recording or session behind @live', async ({ page }, testInfo) => {
    test.setTimeout(1_500_000);
    const receipt = new RwtReceipt(SUITE);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    tap.attach(page); generations.attach(page);
    let providerCallCount = 0;
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/get-ai-suggestions')) providerCallCount++;
    });
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
        await page.getByTestId('mic-download').click({ timeout: 15_000 });
        const pendingObserved = await page.waitForFunction(() => {
            const status = document.documentElement.getAttribute('data-model-status');
            return status === 'downloading' || status === 'initializing';
        }, undefined, { timeout: 15_000 }).then(() => true).catch(() => false);
        receipt.row('Start transition observed', pendingObserved ? 'PASS' : 'HOLD', pendingObserved
            ? 'the user-triggered Start left the cold waiting state before navigation'
            : 'the pending Start transition was too brief or could not be observed; cancellation is not qualified');
        const micAtLeave = await readMicEvidence(page);
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
        receipt.row('return to Open Mic exposes truthful Start state', startAvailable ? 'PASS' : 'FAIL',
            startAvailable ? `return shows the ${expectedControl} action for model state ${modelStatus}`
                : `return did not expose an enabled Start/retry action consistent with model state ${modelStatus ?? 'unreadable'}`);
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
        await generations.settle();
        receipt.row('coaching provider-call budget', providerCallCount === 0 ? 'PASS' : 'FAIL',
            providerCallCount === 0 ? 'pending-Start abandonment and return made no coaching-provider request'
                : 'pending-Start abandonment unexpectedly triggered coaching-provider traffic',
            { providerCalls: providerCallCount, responses: generations.exchanges.length, maximum: 0 });
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
