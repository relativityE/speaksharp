/**
 * RWT R3 (row 17): the adverse-state journey shared by `rwt-adverse-mic-model.live.spec.ts` (download fails, offline
 * mid-download) and `rwt-adverse-mic-denied.live.spec.ts` (mic denied). Moved verbatim from the former single spec: the
 * mic-denied variant needs its own file-level `launchOptions` (`=deny`), which Playwright refuses inside a describe group.
 */
import { createClient } from '@supabase/supabase-js';
import { chromium, type Browser, type Page, type TestInfo } from '@playwright/test';
import { routeVercelBypass } from './deployedLiveTest';
import { applyRwtIdentity, rwtIdentityFor } from './rwtBrowserIdentity';
import { expect } from './rwtProductionTest';
import { cleanupRunOwnedAccount } from './runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RwtReceipt, installMicAcquisitionCounter, loadRwtFixture, micAcquisitionLog, rwtLaunchArgs,
    suppressPageSnapshot, telemetryClassRows,
} from './rwtJourney';
import { type RunOwner, prepareRunOwnedAccount } from './rwtDisposableAccount';
import { isRecording, observeCloudStt, persistedId, tabState } from './rwtPageState';
import { bindReadbackJourneys } from './rwtOracles';
import { CoachingGenerationTap } from './coachingGenerationTap';
import { coachingRequestBudgetRow } from './rwtCoachingCollector';
import { openProductsItem } from './productsMenu';
import { selectBenchmarkMode, stopBenchmarkRecording } from './benchmark-utils';
import { noCloudVerdict } from './rwtAbandonTakeover';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './rwtWatchdog';
import {
    ADVERSE_SUITE, type AdverseVariant, MIC_BLOCKED_COPY, MODEL_ASSETS, MODEL_FAILED_STATES, downloadFailureVerdict, armModelStatusLog, readModelStatusLog, AttemptFaultCounter,
    deniedAfterPress, micDeniedVerdict, recoveredTakeVerdict,
} from './rwtAdverse';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
export const fixture = loadRwtFixture('open_mic_tts');
const MODEL_PATH = /\/models\//;
const PRIMARY_CONTROLS = ['mic-start', 'mic-retry', 'mic-download'] as const;

/** The site's microphone permission, set the way a person's site setting sets it (Blocked / Allowed). */
async function setSiteMicrophone(page: Page, browser: Browser, setting: 'denied' | 'granted'): Promise<void> {
    const pageSession = await page.context().newCDPSession(page);
    const { targetInfo } = await pageSession.send('Target.getTargetInfo');
    await pageSession.detach();
    const browserSession = await browser.newBrowserCDPSession();
    try {
        await browserSession.send('Browser.setPermission', {
            // CDP `Browser.setPermission` takes a W3C PermissionDescriptor (`microphone`); `audioCapture` is the distinct
            // `Browser.grantPermissions` PermissionType, which Chrome rejects here (run 38876633963).
            permission: { name: 'microphone' }, setting, origin: new URL(page.url()).origin,
            browserContextId: targetInfo.browserContextId,
        });
    } finally {
        await browserSession.detach();
    }
}
const micPermissionState = (page: Page) => page.evaluate(async () =>
    (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state).catch(() => null);

/**
 * Sam's ACCEPT of PM 731eb5c0: the COMPLETE published model-status history (rwtAdverse `armModelStatusLog`), bound to the
 * page's document by a token. `observed` false (no log in this document) is a lost observation, never "never ready".
 */
const modelStatusToken = `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const modelStatuses = async (page: Page): Promise<{ observed: boolean; statuses: string[] }> => {
    const log = await page.evaluate(readModelStatusLog).catch(() => ({ token: null, statuses: [] as string[] }));
    return { observed: log.token === modelStatusToken, statuses: log.statuses };
};
const modelStatus = (page: Page) => page.locator('html').getAttribute('data-model-status');
const sttMode = (page: Page) => page.locator('html').getAttribute('data-stt-mode');
const failedState = (page: Page, timeout: number) => page.waitForFunction(
    (states: string[]) => states.includes(document.documentElement.getAttribute('data-model-status') ?? ''),
    [...MODEL_FAILED_STATES] as string[], { timeout }).then(() => true).catch(() => false);

/** The person presses whichever primary control the page offers, until a take records (at most twice). */
async function pressUntilRecording(page: Page): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const control = page.getByTestId(PRIMARY_CONTROLS[0]).or(page.getByTestId(PRIMARY_CONTROLS[1])).or(page.getByTestId(PRIMARY_CONTROLS[2]))
            .filter({ visible: true }).first();
        const ready = await expect(control).toBeEnabled({ timeout: 600_000 }).then(() => true).catch(() => false);
        if (!ready) return false;
        await control.click();
        if (await isRecording(page, 600_000)) return true;
    }
    return false;
}

async function saveRecoveredTake(page: Page, uid: string, label: string, takes: string[]) {
    const recorded = await pressUntilRecording(page);
    let savedId: string | null = null;
    let savedStatus: string | null = null;
    if (recorded) {
        await page.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
        await stopBenchmarkRecording(page, label, 180_000);
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
        savedId = await persistedId(page);
        if (savedId) {
            takes.push(savedId);
            const { data, error } = await admin!.from('sessions').select('status').eq('id', savedId).eq('user_id', uid).maybeSingle();
            if (error) throw new Error(`session row read failed (fail closed): ${error.code ?? 'unknown'}`);
            savedStatus = typeof data?.status === 'string' ? data.status : null;
        }
    }
    return recoveredTakeVerdict({ recorded, savedId, savedStatus });
}

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
export const finalizer = new JourneyFinalizer();

export async function runVariant(page: Page, browser: Browser, testInfo: TestInfo, variant: AdverseVariant): Promise<void> {
    const suite = `${ADVERSE_SUITE}-${variant}`;
    const receipt = new RwtReceipt(`${ADVERSE_SUITE}-${variant}`);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    const cloud = { requests: 0 };
    tap.attach(page); generations.attach(page); observeCloudStt(page, cloud);
    const owner: RunOwner = { email: '', uid: '' };
    const takes: string[] = [];
    let claimed = false;
    const context = page.context();
    // Mic-denied only: the browser in which the person allows the microphone (see below).
    let recoveryBrowser: Browser | null = null;
    // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the 30-minute timeout.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(suite), label: suite, contexts: () => recoveryBrowser?.contexts() ?? [] });
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
        // (bounded; page-independent, since a finalizer may run after its tabs closed).
        await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
        await steps.step('watchdog', () => watch.record(receipt));
        await steps.step('recovery browser close', () => recoveryBrowser?.close());
        await steps.step('offline restore', () => context.setOffline(false));
        await steps.step('model route restore', () => context.unroute(MODEL_ASSETS));
        await steps.step('no cloud row', () => {
            const cloudVerdict = noCloudVerdict(cloud.requests);
            receipt.row('no Cloud STT request', cloudVerdict.status, cloudVerdict.detail, { cloudRequests: cloud.requests });
        });
        await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
        await steps.step('coaching budget', () => coachingRequestBudgetRow(receipt, generations, { maximum: 1, oneRequestPerSession: takes }));
        // A signup that died before its uid was read is still found by its created email.
        if (owner.uid || owner.email) {
            // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion; its own settlement decides the row.
            await finalizeOwnedCleanup(steps, receipt, new OwnedCleanup(
                () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX })));
        }
        await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, false));
        steps.report(receipt);
        receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
    });
    try {
        await suppressPageSnapshot(testInfo);
        claimed = await prepareRunOwnedAccount(page, receipt, owner, `adverse-${variant}`, admin, SERVICE_ROLE);
        if (!claimed) return;
        // The acquisition boundary's own outcomes (grants and NotAllowedError) are observed from the first page load.
        await installMicAcquisitionCounter(page);
        await page.goto('/practice');
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });
        await selectBenchmarkMode(page, 'private');
        await page.evaluate(armModelStatusLog, modelStatusToken);

        if (variant === 'mic-denied') {
            await setSiteMicrophone(page, browser, 'denied');
            // Informational only (Sam, #1662 RETURN): the verdict is decided at the acquisition boundary below.
            const permissionQuery = await micPermissionState(page);
            const control = page.getByTestId('mic-download').or(page.getByTestId('mic-start')).filter({ visible: true }).first();
            // Live case 12: with the microphone denied, a RECORDING transition is the failure itself — stop there. Armed
            // whether or not the denial reads as applied: a recording here is never this scenario's truthful outcome.
            watch.setForbidRecording(true);
            // #1593 (Sam, #1662 RETURN control 3): the denial's own failed Start is expected only in this step.
            watch.setFaultPhase(true);
            // Sam, #1662 RETURN: only THIS press's acquisition outcome counts — an earlier rejection on the page cannot
            // qualify a later Start that failed for another reason.
            const acquisitionsBeforePress = (await micAcquisitionLog(page)).length;
            await control.click();
            // The model downloads first on a fresh account; the blocked microphone is met at the recording boundary.
            const blockedCopyShown = await page.getByText(MIC_BLOCKED_COPY).first().waitFor({ timeout: 900_000 }).then(() => true).catch(() => false);
            await page.waitForTimeout(2_000);
            const state = await tabState(page);
            const acquisitions = await micAcquisitionLog(page);
            const deniedAtAcquisition = deniedAfterPress(acquisitions, acquisitionsBeforePress);
            const rejections = acquisitions.filter((a) => a.id >= acquisitionsBeforePress && a.outcome !== 'granted' && a.outcome !== 'pending');
            const denied = micDeniedVerdict({ deniedAtAcquisition, blockedCopyShown, tab: state });
            receipt.row('blocked microphone is stated truthfully', denied.status, denied.detail,
                { deniedAtAcquisition, acquisitionRejections: rejections.length, permissionQuery, blockedCopyShown, ...state, mode: await sttMode(page) });
            watch.setForbidRecording(false);
            watch.setFaultPhase(false);
            // #1593 (local probe, 2026-10-18): only `--use-fake-ui-for-media-stream=deny` makes the browser answer a
            // truthful NotAllowedError, and that browser can never grant afterwards. Allowing the microphone is therefore
            // what a person does next: the same account, in a browser that allows it (the harness's ordinary launch).
            recoveryBrowser = await chromium.launch({ args: rwtLaunchArgs(fixture, { webgpu: false }) });
            const baseURL = new URL(page.url()).origin;
            const allowed = await recoveryBrowser.newContext({ baseURL, permissions: ['microphone'] });
            await routeVercelBypass(allowed, baseURL);
            const allowedPage = await allowed.newPage();
            await applyRwtIdentity(allowed, allowedPage, await rwtIdentityFor(recoveryBrowser));
            tap.attach(allowedPage); generations.attach(allowedPage); observeCloudStt(allowedPage, cloud);
            watch.setPage(allowedPage);
            if (!owner.signInOn) throw new Error('the run-owned account cannot sign in on another browser');
            await owner.signInOn(allowedPage);
            await allowedPage.goto('/practice');
            await openProductsItem(allowedPage, 'open-mic');
            await allowedPage.waitForURL(/\/session/, { timeout: 45_000 });
            await selectBenchmarkMode(allowedPage, 'private');
            const recovered = await saveRecoveredTake(allowedPage, owner.uid, `adverse-${variant}`, takes);
            // Sam, #1662 RETURN: this proves recovery for the SAME ACCOUNT in a FRESH, allowing browser — not Allow→Retry in
            // the originally denied page, which a `=deny` browser cannot grant.
            receipt.row('after allowing the microphone a take saves', recovered.status,
                `${recovered.detail} (same account, fresh allowing browser; not Allow→Retry in the denied page)`,
                { recoveryScope: 'same_account_fresh_browser' });
        } else {
            // Sam's ACCEPT of PM 731eb5c0: only this download attempt's model-WEIGHT failures while the fault is armed count,
            // and the fault is armed BEFORE it is induced (a failure delivered during the awaited injection still counts).
            const fault = new AttemptFaultCounter<object>();
            context.on('request', (r) => fault.onRequest(r, r.url()));
            context.on('requestfailed', (r) => fault.onFailed(r));
            let injected = false;
            if (variant === 'download-fails') {
                // Codex P1 r on f527a033: the phase opens BEFORE the fault is injected, so a failure the injection causes is
                // always captured inside it (events are judged by their own capture time).
                watch.setFaultPhase(true); // the injected model fault is expected only until the cause is removed
                fault.armFault();
                injected = await context.route(MODEL_ASSETS, (route) => route.abort('failed')).then(() => true, () => false);
                fault.startAttempt();
                await page.getByTestId('mic-download').click();
            } else {
                let modelRequests = 0;
                context.on('request', (r) => { if (MODEL_PATH.test(r.url())) modelRequests += 1; });
                fault.startAttempt();
                await page.getByTestId('mic-download').click();
                await expect.poll(() => modelRequests, { timeout: 120_000 }).toBeGreaterThan(0).catch(() => undefined);
                watch.setFaultPhase(true); // opened before going offline: the offline transition itself fails the download
                fault.armFault();
                injected = await context.setOffline(true).then(() => true, () => false);
            }
            await failedState(page, 300_000);
            const history = await modelStatuses(page);
            const failure = downloadFailureVerdict({
                exercised: injected && fault.failures > 0,
                observed: history.observed,
                statuses: history.statuses,
                finalStatus: await modelStatus(page),
                retryOffered: await page.getByTestId('mic-retry').isVisible().catch(() => false),
                mode: await sttMode(page),
            });
            receipt.row('model download failure is stated truthfully', failure.status, failure.detail,
                { faultInjected: injected, modelWeightFailuresAfterFault: fault.failures, statusesObserved: history.observed, statusChanges: history.statuses.length,
                    finalStatus: await modelStatus(page), mode: await sttMode(page), ...(await tabState(page)) });
            // Remove the cause the way it ends for a person: the asset host answers again, or the network comes back.
            if (variant === 'download-fails') await context.unroute(MODEL_ASSETS);
            else await context.setOffline(false);
            fault.disarm();
            watch.setFaultPhase(false);
            const recovered = await saveRecoveredTake(page, owner.uid, `adverse-${variant}`, takes);
            const after = await modelStatuses(page);
            receipt.row('Retry downloads the model and a take saves', recovered.status, recovered.detail,
                { sawReadyAfterRetry: after.observed && after.statuses.includes('ready'), statusesObserved: after.observed, mode: await sttMode(page) });
        }
    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        await finish();
    }
}
