/**
 * RWT R3 (row 17) — adverse states on the deployed product, each on its own run-owned account and fresh browser context.
 *  - mic denied: the browser's microphone permission for the site is set to Blocked (as a person's site setting would be)
 *    before Start. The page must say so, record nothing, and make no Cloud request; once access is allowed, a take saves.
 *  - download fails: the Private model's own-origin asset requests are refused on first acquisition. The page must state
 *    the failure with Retry, never claim ready, and stay Private with no Cloud request; once the fault is removed,
 *    Retry downloads the model and a take saves.
 *  - offline mid-download: the browser goes offline while the model is downloading, then back online; same assertions.
 * Live-only by necessity: the E2E build never loads the model. Receipts are content-free. Preparation only: execution
 * requires a fresh release-bound RWT authorization.
 */
import { createClient } from '@supabase/supabase-js';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/rwtProductionTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RwtReceipt, loadRwtFixture, rwtLaunchArgs, suppressPageSnapshot, telemetryClassRows,
} from './helpers/rwtJourney';
import { type RunOwner, prepareRunOwnedAccount } from './helpers/rwtDisposableAccount';
import { isRecording, observeCloudStt, persistedId, tabState } from './helpers/rwtPageState';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { CoachingGenerationTap } from './helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from './helpers/rwtCoachingCollector';
import { openProductsItem } from './helpers/productsMenu';
import { selectBenchmarkMode, stopBenchmarkRecording } from './helpers/benchmark-utils';
import { noCloudVerdict } from './helpers/rwtAbandonTakeover';
import { CleanupBackstop, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
import {
    ADVERSE_SUITE, type AdverseVariant, MIC_BLOCKED_COPY, MODEL_ASSETS, MODEL_FAILED_STATES, downloadFailureVerdict,
    micDeniedVerdict, recoveredTakeVerdict,
} from './helpers/rwtAdverse';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
const fixture = loadRwtFixture('open_mic_tts');
const MODEL_PATH = /\/models\//;
const PRIMARY_CONTROLS = ['mic-start', 'mic-retry', 'mic-download'] as const;

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});
test.describe.configure({ mode: 'serial' });

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

/** Every value the page publishes as its model status, in order (state names only). */
async function armModelStatusLog(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __rwtModelStatuses__?: string[] };
        const log: string[] = [];
        w.__rwtModelStatuses__ = log;
        const root = document.documentElement;
        const push = () => { const s = root.getAttribute('data-model-status'); if (s !== null && log[log.length - 1] !== s) log.push(s); };
        push();
        new MutationObserver(push).observe(root, { attributes: true, attributeFilter: ['data-model-status'] });
    });
}
const modelStatuses = (page: Page) => page.evaluate(() => (window as unknown as { __rwtModelStatuses__?: string[] }).__rwtModelStatuses__ ?? []);
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

/** #1593 (live case 12): the run-owned cleanup must survive a test timeout — see `CleanupBackstop`. */
const backstop = new CleanupBackstop<RunOwner>();

async function runVariant(page: Page, browser: Browser, testInfo: TestInfo, variant: AdverseVariant): Promise<void> {
    const suite = `${ADVERSE_SUITE}-${variant}`;
    const receipt = new RwtReceipt(`${ADVERSE_SUITE}-${variant}`);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    const cloud = { requests: 0 };
    tap.attach(page); generations.attach(page); observeCloudStt(page, cloud);
    const owner: RunOwner = backstop.track({ email: '', uid: '' });
    const takes: string[] = [];
    let claimed = false;
    const context = page.context();
    // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the 30-minute timeout.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(suite), label: suite });
    try {
        await suppressPageSnapshot(testInfo);
        claimed = await prepareRunOwnedAccount(page, receipt, owner, `adverse-${variant}`, admin, SERVICE_ROLE);
        if (!claimed) return;
        await page.goto('/practice');
        await openProductsItem(page, 'open-mic');
        await page.waitForURL(/\/session/, { timeout: 45_000 });
        await selectBenchmarkMode(page, 'private');
        await armModelStatusLog(page);

        if (variant === 'mic-denied') {
            await setSiteMicrophone(page, browser, 'denied');
            const denialApplied = (await micPermissionState(page)) === 'denied';
            const control = page.getByTestId('mic-download').or(page.getByTestId('mic-start')).filter({ visible: true }).first();
            // Live case 12: with the microphone denied, a RECORDING transition is the failure itself — stop there. Armed
            // whether or not the denial reads as applied: a recording here is never this scenario's truthful outcome.
            watch.setForbidRecording(true);
            await control.click();
            // The model downloads first on a fresh account; the blocked microphone is met at the recording boundary.
            const blockedCopyShown = await page.getByText(MIC_BLOCKED_COPY).first().waitFor({ timeout: 900_000 }).then(() => true).catch(() => false);
            await page.waitForTimeout(2_000);
            const state = await tabState(page);
            const denied = micDeniedVerdict({ denialApplied, blockedCopyShown, tab: state });
            receipt.row('blocked microphone is stated truthfully', denied.status, denied.detail,
                { denialApplied, blockedCopyShown, ...state, mode: await sttMode(page) });
            watch.setForbidRecording(false);
            await setSiteMicrophone(page, browser, 'granted');
            await context.grantPermissions(['microphone']);
            const recovered = await saveRecoveredTake(page, owner.uid, `adverse-${variant}`, takes);
            receipt.row('after allowing the microphone a take saves', recovered.status, recovered.detail);
        } else {
            const modelFailures = { afterFault: 0 };
            let faultOn = false;
            context.on('requestfailed', (r) => { if (faultOn && MODEL_PATH.test(r.url())) modelFailures.afterFault += 1; });
            if (variant === 'download-fails') {
                await context.route(MODEL_ASSETS, (route) => route.abort('failed'));
                faultOn = true;
                await page.getByTestId('mic-download').click();
            } else {
                let modelRequests = 0;
                context.on('request', (r) => { if (MODEL_PATH.test(r.url())) modelRequests += 1; });
                await page.getByTestId('mic-download').click();
                await expect.poll(() => modelRequests, { timeout: 120_000 }).toBeGreaterThan(0).catch(() => undefined);
                await context.setOffline(true);
                faultOn = true;
            }
            await failedState(page, 300_000);
            const failure = downloadFailureVerdict({
                exercised: modelFailures.afterFault > 0,
                statuses: await modelStatuses(page),
                finalStatus: await modelStatus(page),
                retryOffered: await page.getByTestId('mic-retry').isVisible().catch(() => false),
                mode: await sttMode(page),
            });
            receipt.row('model download failure is stated truthfully', failure.status, failure.detail,
                { modelFailuresAfterFault: modelFailures.afterFault, finalStatus: await modelStatus(page), mode: await sttMode(page),
                    ...(await tabState(page)) });
            // Remove the cause the way it ends for a person: the asset host answers again, or the network comes back.
            if (variant === 'download-fails') await context.unroute(MODEL_ASSETS);
            else await context.setOffline(false);
            faultOn = false;
            const recovered = await saveRecoveredTake(page, owner.uid, `adverse-${variant}`, takes);
            receipt.row('Retry downloads the model and a take saves', recovered.status, recovered.detail,
                { sawReadyAfterRetry: (await modelStatuses(page)).includes('ready'), mode: await sttMode(page) });
        }
    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        watch.record(receipt);
        await context.setOffline(false).catch(() => undefined);
        await context.unroute(MODEL_ASSETS).catch(() => undefined);
        const cloudVerdict = noCloudVerdict(cloud.requests);
        receipt.row('no Cloud STT request', cloudVerdict.status, cloudVerdict.detail, { cloudRequests: cloud.requests });
        await generations.settle();
        coachingRequestBudgetRow(receipt, generations, { maximum: 1, oneRequestPerSession: takes });
        if (owner.uid) {
            try {
                await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
                backstop.done(owner);
                receipt.row('run-owned cleanup', 'PASS', 'the run-owned account was deleted and residue checks passed');
            } catch {
                receipt.row('run-owned cleanup', 'FAIL', 'run-owned account deletion or residue readback failed');
            }
        }
        telemetryClassRows(receipt, tap, claimed, false);
        receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
    }
}

test.describe('RWT — adverse microphone and model states @live', () => {
    test.afterEach(async () => {
        await backstop.drain((o) => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: o.uid, createdEmail: o.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX }));
    });

    /**
     * #1593 (live case 12, run 39167876945): `--use-fake-ui-for-media-stream` auto-approves every media request without
     * consulting the site permission, and the context was created with the microphone already granted — so the CDP
     * "Blocked" setting never reached `getUserMedia` and the take recorded. This variant alone launches without the
     * auto-approve flag and without the pre-granted permission; the fake capture DEVICE stays, so once the person allows
     * the microphone a take still records the fixture.
     */
    test.describe('mic denied (real permission decision)', () => {
        test.use({
            permissions: [],
            launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }).filter((a) => a !== '--use-fake-ui-for-media-stream') },
        });
        test('mic denied: stated truthfully, nothing records, no Cloud; allowed → a take saves', async ({ page, browser }, testInfo) => {
            test.setTimeout(1_800_000);
            await runVariant(page, browser, testInfo, 'mic-denied');
        });
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
