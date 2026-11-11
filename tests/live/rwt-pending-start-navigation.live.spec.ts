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
import { RETURN_SETTLE_DEFAULTS, returnControlSample, settleReturnControlState, type ReturnControlState } from './helpers/rwtReturnControlState';
import {
    preparePrivateModelIfPrompted, selectBenchmarkMode, startBenchmarkRecording, stopBenchmarkRecording, waitForPrivateEngineReady,
} from './helpers/benchmark-utils';
import { nextTakeIdArrived, type SessionRowFacts } from './helpers/rwtSaveRetry';
import { recoveryTakePlan, recoveryTakeVerdict } from './helpers/rwtPendingStartRecovery';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, aliveReceipt, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
import { HarnessParityTap, type StartPressBudget } from './helpers/rwtHarnessParity';

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

/** Content-free facts for every session row of the run-owned account (lengths and states, never text). */
async function readSessionRows(uid: string): Promise<SessionRowFacts[]> {
    const { data, error } = await admin!.from('sessions')
        .select('id,status,idempotency_key,transcript_state,transcript,created_at').eq('user_id', uid).order('created_at');
    if (error || !Array.isArray(data)) throw new Error(`session row read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    return data.map((row) => ({
        id: String(row.id),
        status: typeof row.status === 'string' ? row.status : null,
        hasIdempotencyKey: typeof row.idempotency_key === 'string' && row.idempotency_key.length > 0,
        transcriptState: typeof row.transcript_state === 'string' ? row.transcript_state : null,
        transcriptLength: typeof row.transcript === 'string' ? row.transcript.length : 0,
    }));
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

/**
 * Harness parity (catalog AHT-04, minimumStarts 2), from the journey's DESIGN (not a run's count). The journey presses two Starts:
 *   1. the cold Start it abandons — `mic-download` (`page.getByTestId('mic-download').click`, below);
 *      the return to Open Mic only reads the controls (`settleReturnControlState`) and presses none;
 *   2. the deliberate recovery take — whichever control the settled return offers: `mic-download` when the abandoned model was
 *      retired (`preparePrivateModelIfPrompted`, whose one press downloads AND starts the take) or `mic-start` when it is warm
 *      (`startBenchmarkRecording`). Never both, and never `mic-retry` (a Retry return HOLDs the take instead of pressing).
 * So: 2 presses in all, `mic-download` at most 2, `mic-start` at most 1.
 */
const AHT04_START_PRESS_BUDGET: StartPressBudget = { total: 2, perControl: { 'mic-download': 2, 'mic-start': 1 } };
/** The page-close step's own bound: each page close is itself bounded at 15 s inside it. */
const PARITY_CLOSE_STEP_MS = 60_000;

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();
test.afterEach(async () => {
    await finalizer.drain();
});

test('leaving during a cold Start does not leave a recording or session behind @live', async ({ page }, testInfo) => {
    // The recovery take may download the model again (up to 900 s), on top of the abandoned cold Start.
    test.setTimeout(2_400_000);
    const receipt = new RwtReceipt(SUITE);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    tap.attach(page); generations.attach(page);
    // Harness parity (PO route 2026-11-10): Cloud STT requests and Start presses on every page of this journey's context;
    // attached in the body below, before the first navigation.
    const parity = new HarnessParityTap();
    let email = '';
    let uid = '';
    let claimed = false;
    let accountDeleted = false;
    const owner = { uid: '', email: '' };
    /** The recovery take's saved session, once the page binds it; its one coaching request is allowed (and no other). */
    let recoveryId: string | null = null;
    // #1593 fail early: an unexpected failure, refusal or stall (case 4's dead Start) ends the journey in seconds.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(SUITE), label: SUITE });
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
        // (bounded; page-independent, since a finalizer may run after its tabs closed).
        await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
        await steps.step('watchdog', () => watch.record(receipt));
        await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
        // Abandoning a pending Start and returning saves nothing; only the deliberate recovery take may ask for coaching, once.
        await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations,
            recoveryId ? { maximum: 1, oneRequestPerSession: [recoveryId] } : { maximum: 0 }));
        // Harness parity rows (catalog AHT-04: no-cloud-stt, start-press-budget, owned-pages-closed), before the account is
        // deleted. Bounded steps, rows only while each step is alive, and the page close in its own step, last before cleanup.
        await steps.step('harness parity counts', (alive) => {
            parity.noCloudSttRow(aliveReceipt(receipt, alive));
            parity.startPressRow(aliveReceipt(receipt, alive), AHT04_START_PRESS_BUDGET);
        });
        await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);
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
        // Before the first navigation: the click recorder is an init script.
        await parity.attach(page.context());
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
        // #1593 (case 4, run 39165065684): the FAIL named no cause. Record WHAT the return showed — which primary control
        // exists, whether it is visible/enabled, its closed aria-label (`Starting…` = a stale start wait, `…unavailable while
        // your last session finishes` = the Progress gate, plain `Start recording` disabled = runtime/finalizing state) and the
        // session-shell state — so a failure classifies its own cause. Closed product copy and booleans only.
        // #1593 (CLI audit 1792782759, Sam 1792798707): one read taken the moment the card appears can catch a healthy
        // remount still resolving availability. The return is judged on a SETTLED state within a fixed deadline; a stuck
        // or unknown state still FAILs. A read that throws is counted as a read error, never coerced into a verdict.
        // Each read receives the remaining budget as its Playwright timeout (Sam HOLD on 81a442b2); the helper also races
        // it against that budget, so a stalled locator can never outlive the deadline.
        const controlState = async (id: string, timeout: number): Promise<ReturnControlState> => {
            const el = page.getByTestId(id).first();
            const present = (await page.getByTestId(id).count()) > 0;
            return {
                present,
                visible: present ? await el.isVisible() : false,
                enabled: present ? await el.isEnabled({ timeout }) : false,
                ariaLabel: present ? await el.getAttribute('aria-label', { timeout }) : null,
            };
        };
        const returned = await settleReturnControlState(async (remainingMs) => {
            const timeout = Math.max(1, remainingMs);
            const modelStatus = await page.getByTestId('mic-card').getAttribute('data-model-status', { timeout });
            const [start, download, retry] = await Promise.all([
                controlState('mic-start', timeout), controlState('mic-download', timeout), controlState('mic-retry', timeout),
            ]);
            const shellState = await page.getByTestId('session-shell').first().getAttribute('data-session-state', { timeout });
            return returnControlSample(modelStatus, shellState, { start, download, retry });
        });
        const last = returned.last;
        receipt.row('return to Open Mic exposes truthful Start state', returned.settled ? 'PASS' : 'FAIL',
            returned.settled ? `return settled on the ${last?.expectedControl} action for model state ${last?.modelStatus}`
                : `return did not settle on an enabled Start/retry action consistent with model state ${last?.modelStatus ?? 'unreadable'} within ${RETURN_SETTLE_DEFAULTS.deadlineMs} ms`,
            {
                modelStatus: last?.modelStatus ?? null, expectedControl: last?.expectedControl ?? null, shellState: last?.shellState ?? null,
                startPresent: last?.start.present ?? false, startVisible: last?.start.visible ?? false, startEnabled: last?.start.enabled ?? false, startAriaLabel: last?.start.ariaLabel ?? null,
                downloadPresent: last?.download.present ?? false, downloadVisible: last?.download.visible ?? false, downloadEnabled: last?.download.enabled ?? false, downloadAriaLabel: last?.download.ariaLabel ?? null,
                retryPresent: last?.retry.present ?? false, retryVisible: last?.retry.visible ?? false, retryEnabled: last?.retry.enabled ?? false, retryAriaLabel: last?.retry.ariaLabel ?? null,
                settleSamples: returned.samples.length, settleElapsedMs: returned.elapsedMs, settleReadErrors: returned.readErrors,
                firstModelStatus: returned.samples[0]?.modelStatus ?? null, firstActionable: returned.samples[0]?.actionable ?? false,
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

        // Catalog `deliberate-recovery-saved`: one deliberate take from the control the settled return offers saves exactly one
        // completed session, bound by the page, with its transcript kept. From here on nothing is an expected fault.
        watch.setFaultPhase(false);
        const plan = recoveryTakePlan(returned.settled, last?.expectedControl ?? null);
        if (!plan.drive) {
            receipt.row('deliberate recovery take saved', plan.verdict.status, plan.verdict.detail,
                { returnSettled: returned.settled, returnControl: last?.expectedControl ?? null });
        } else {
            const priorIds = await readSessionIds(uid);
            const setup = await preparePrivateModelIfPrompted(page, 900_000);
            if (!setup.recordingAlreadyStarted) {
                await waitForPrivateEngineReady(page, 600_000);
                await startBenchmarkRecording(page, 'pending-start-recovery');
            }
            await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
            await stopBenchmarkRecording(page, 'pending-start-recovery', 180_000);
            // Wait for the take's OWN saved identity, never merely "different", which the start-of-take clear satisfies at once.
            const bound = await expect.poll(async () => nextTakeIdArrived(
                await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id')), sessionIdentityBefore),
            { timeout: 180_000 }).toBe(true).then(() => true).catch(() => false);
            recoveryId = bound ? await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id')) : null;
            const rows = await readSessionRows(uid);
            const recovered = recoveryTakeVerdict(priorIds, rows, recoveryId);
            receipt.row('deliberate recovery take saved', recovered.status, recovered.detail,
                { returnControl: plan.control, setupStartedTake: setup.recordingAlreadyStarted, persistedIdBound: recoveryId !== null,
                    priorSessions: priorIds.length, rows: rows.length, completed: rows.filter((r) => r.status === 'completed').length });
        }
    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        await finish();
    }
});
