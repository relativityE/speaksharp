/**
 * RWT R2 (row 16) — leaving a recording and coming back, and one account in two tabs, on the deployed product.
 *
 * Nothing is intercepted: these are the person's own actions on a real Private take.
 *  - navigate away: Products → Focus Points mid-recording, then back to Open Mic;
 *  - close the tab: the tab is closed mid-recording (the browser's "Leave site?" is answered Leave), then Open Mic is
 *    opened in a new tab of the same browser;
 *  - two tabs (#1476): tab B presses Start while tab A records, then presses Start again to take over.
 * Each return must leave no live microphone or stuck recording, tell the truth about the abandoned take, and let the
 * next take save only itself with no take left `active` on the server. Private never reaches Cloud STT. Receipts are
 * content-free. Preparation only: execution requires a fresh release-bound RWT authorization.
 */
import { createClient } from '@supabase/supabase-js';
import type { BrowserContext, Dialog, Page, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/rwtProductionTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import { routeVercelBypass } from './helpers/deployedLiveTest';
import { applyRwtIdentity, rwtIdentityFor, rwtPageReady } from './helpers/rwtBrowserIdentity';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RwtReceipt, installMicAcquisitionCounter, loadRwtFixture, rwtLaunchArgs,
    suppressPageSnapshot, telemetryClassRows,
} from './helpers/rwtJourney';
import { flatTabState, isRecording, observeCloudStt, persistedId, tabState } from './helpers/rwtPageState';
import { RECORDER_BAR } from '../helpers/micControls';
import { type RunOwner, prepareRunOwnedAccount } from './helpers/rwtDisposableAccount';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { CoachingGenerationTap } from './helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from './helpers/rwtCoachingCollector';
import { FINALIZE_SETTLE_MS, FinalizationSteps, OwnedCleanup, finalizeOwnedCleanup, JourneyFinalizer, armWatchdog, watchProfileFor } from './helpers/rwtWatchdog';
import { openProductsItem } from './helpers/productsMenu';
import {
    preparePrivateModelIfPrompted, selectBenchmarkMode, startBenchmarkRecording, stopBenchmarkRecording, waitForPrivateEngineReady,
} from './helpers/benchmark-utils';
import {
    ABANDON_SUITE, type AbandonVariant, BLOCKED_COPY, DISPLACED_COPY, type RowFacts, SAME_BROWSER_TAB_COPY,
    TWO_TAB_SUITE, answerLeaveDialog, classifyRecoveryClaim, leavePromptVerdict, leftTakeSavedOnce, leftTakeSavedVerdict, newLeaveDialogs, newRowsSince, nextTakeOnlyItselfVerdict, priorTakeSaved, noCloudVerdict, recoveryNoticeVerdict, releasedVerdict,
    addCompletedTakeIds, installModelStatusHistory, leaseRefusalWindowVerdict, openObservationWindow, closeObservationWindow, type ObservationClose, refreshCompletedTakeIds, returnStartVerdict, secondTabBlockedVerdict, takeOverRowsVerdict, takeOverVerdict,
} from './helpers/rwtAbandonTakeover';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
const fixture = loadRwtFixture('open_mic_tts');
/** Long enough to pass the 5 s no-persist guard, short enough that the take is still mid-speech when it is left. */
const MID_TAKE_MS = 8_000;

test.use({
    permissions: ['microphone'], trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: rwtLaunchArgs(fixture, { webgpu: false }) },
});
test.describe.configure({ mode: 'serial' });

const refusalShown = (page: Page) => page.getByText(BLOCKED_COPY).or(page.getByText(SAME_BROWSER_TAB_COPY)).first()
    .waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
async function readRows(uid: string): Promise<RowFacts[]> {
    const { data, error } = await admin!.from('sessions').select('id,status').eq('user_id', uid).order('created_at');
    if (error || !Array.isArray(data)) throw new Error(`session row read failed (fail closed): ${error?.code ?? 'unreadable'}`);
    return data.map((r) => ({ id: String(r.id), status: typeof r.status === 'string' ? r.status : null }));
}

/** Every page of the scenario: analytics, coaching and the Cloud STT observer (request URLs and sockets, never bodies). */
function observe(page: Page, tap: AnalyticsTap, generations: CoachingGenerationTap, cloud: { requests: number }): void {
    tap.attach(page); generations.attach(page);
    observeCloudStt(page, cloud);
}

async function openOpenMic(page: Page): Promise<void> {
    await page.goto('/practice');
    await openProductsItem(page, 'open-mic');
    await page.waitForURL(/\/session/, { timeout: 45_000 });
}

async function startFirstPrivateTake(page: Page, label: string): Promise<void> {
    await selectBenchmarkMode(page, 'private');
    const setup = await preparePrivateModelIfPrompted(page, 900_000);
    if (!setup.recordingAlreadyStarted) {
        await waitForPrivateEngineReady(page, 600_000);
        await startBenchmarkRecording(page, label);
    }
}

/** #1593 (live case 12): the journey's finalization must survive a test timeout — see `JourneyFinalizer`. */
const finalizer = new JourneyFinalizer();

async function finishJourney(receipt: RwtReceipt, testInfo: TestInfo, tap: AnalyticsTap, generations: CoachingGenerationTap,
    owner: RunOwner, claimed: boolean, cloud: { requests: number }, takes: string[], takeBaseline: readonly RowFacts[] | null,
    steps: FinalizationSteps, beforeReport?: () => Promise<void>): Promise<void> {
    await steps.step('no cloud row', () => {
        const cloudVerdict = noCloudVerdict(cloud.requests);
        receipt.row('no Cloud STT request', cloudVerdict.status, cloudVerdict.detail, { cloudRequests: cloud.requests });
    });
    await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);
    await steps.step('coaching budget', async () => {
        const sessionIdsVerified = await refreshCompletedTakeIds(takes, takeBaseline, () => readRows(owner.uid));
        coachingRequestBudgetRow(receipt, generations, { maximum: 2, oneRequestPerSession: takes, sessionIdsVerified });
    });
    // A signup that died before its uid was read is still found by its created email.
    if (owner.uid || owner.email) {
        // Sam, #1662 RETURN on f527a033 (item 1): ONE owned deletion; its own settlement decides the row.
        await finalizeOwnedCleanup(steps, receipt, new OwnedCleanup(
            () => cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX })));
    }
    await steps.step('telemetry rows', () => telemetryClassRows(receipt, tap, claimed, false));
    // Codex P2 on 76a0bf6e: work that must be reported (closing extra devices) runs before the report seals the steps.
    if (beforeReport) await beforeReport();
    steps.report(receipt);
    receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
}

async function abandonAndReturn(page: Page, testInfo: TestInfo, variant: AbandonVariant): Promise<void> {
    const suite = `${ABANDON_SUITE}-${variant}`;
    const receipt = new RwtReceipt(`${ABANDON_SUITE}-${variant}`);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    const cloud = { requests: 0 };
    observe(page, tap, generations, cloud);
    const owner: RunOwner = { email: '', uid: '' };
    // #1593 fail early: an unexpected failure, refusal or stall ends the journey in seconds, not at the 30-minute timeout.
    const watch = armWatchdog({ page, tap, profile: watchProfileFor(suite), label: suite });
    const takes: string[] = [];
    let claimed = false;
    let rowsBeforeFirst: RowFacts[] | null = null;
    // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
    // (which Playwright runs after a timeout) run this same memoized closure exactly once.
    const finish = finalizer.once(async () => {
        // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
        const steps = new FinalizationSteps();
        // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
        // (bounded; page-independent, since a finalizer may run after its tabs closed).
        await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
        await steps.step('watchdog', () => watch.record(receipt));
        await finishJourney(receipt, testInfo, tap, generations, owner, claimed, cloud, takes, rowsBeforeFirst, steps);
    });
    try {
        await suppressPageSnapshot(testInfo);
        claimed = await prepareRunOwnedAccount(page, receipt, owner, `abandon-${variant}`, admin, SERVICE_ROLE);
        if (!claimed) return;
        await openOpenMic(page);
        // The account's rows before the first take: the baseline the left take's persistence is read against.
        rowsBeforeFirst = await readRows(owner.uid);
        await startFirstPrivateTake(page, `abandon-${variant}-1`);
        await page.waitForTimeout(MID_TAKE_MS);
        const during = await tabState(page);
        const midTake = during.runtimeState === 'RECORDING' && during.liveTracks > 0;
        receipt.row('take is recording before leaving', midTake ? 'PASS' : 'HOLD', midTake
            ? 'a Private take was recording with a live microphone when the person left'
            : 'the take was not recording when the person left, so abandonment was not exercised', { ...during });
        if (!midTake) return;

        let returned = page;
        // #1593 (Sam, #1662 RETURN control 3): the left take's lease and the truthful return refusal are expected from the
        // leave until the return Start has been judged; the next take is strict.
        watch.setFaultPhase(true);
        if (variant === 'navigate-away') {
            // #1258 run 38876623812: the product asks before leaving a live recording. Unanswered, Playwright dismisses it
            // (the person's Cancel) and the page rightly stays; a person leaving answers Leave. Only the first exact leave
            // confirm is accepted; every other dialog is dismissed and counted (Sam 6218709582). Counts only, no text stored.
            const dialogs = newLeaveDialogs();
            const answerLeave = (d: Dialog) => {
                void (answerLeaveDialog(dialogs, { type: d.type(), message: d.message() }) === 'accept' ? d.accept() : d.dismiss());
            };
            page.on('dialog', answerLeave);
            let arrived = false;
            try {
                await openProductsItem(page, 'focus-points');
                arrived = await page.waitForURL(/\/practice\?product=focus-points/, { timeout: 45_000 }).then(() => true, () => false);
            } finally { page.off('dialog', answerLeave); }
            const asked = leavePromptVerdict({ ...dialogs, arrived });
            receipt.row('leave prompt answered Leave', asked.status, asked.detail, { ...dialogs, arrived });
            if (asked.status !== 'PASS') return;
            await page.waitForTimeout(3_000);
            const afterLeaving = await tabState(page);
            const left = releasedVerdict(afterLeaving, 'after leaving');
            receipt.row('leaving mid-recording releases the microphone', left.status, left.detail, { ...afterLeaving });
            // #1593 (live case 9, run 39167895568): Focus Points opens its setup as a MODAL over the header, which
            // intercepted the Products click for 20 s. A person closes it before using Products again — exactly as the
            // pending-start and returning-user journeys do — so the return below is reachable.
            const setupOpen = await page.getByTestId('objective-setup-dialog').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
            if (setupOpen) {
                await page.keyboard.press('Escape');
                await expect(page.getByTestId('objective-setup-dialog')).toHaveCount(0, { timeout: 10_000 });
            }
            await openProductsItem(page, 'open-mic');
            await page.waitForURL(/\/session/, { timeout: 45_000 });
        } else {
            // A person closing the tab sees the browser's "Leave site?" and chooses Leave.
            let leavePrompt = false;
            page.on('dialog', (d) => {
                if (d.type() === 'beforeunload') { leavePrompt = true; void d.accept(); } else { void d.dismiss(); }
            });
            const context = page.context();
            const closed = page.waitForEvent('close', { timeout: 30_000 }).then(() => true).catch(() => false);
            await page.close({ runBeforeUnload: true });
            const tabClosed = await closed;
            receipt.row('leaving mid-recording releases the microphone', tabClosed ? 'PASS' : 'FAIL', tabClosed
                ? 'the tab closed, ending its document and every microphone track it held'
                : 'the tab did not close after the person chose Leave', { leavePrompt, tabClosed });
            returned = await context.newPage();
            // #1593: its identity and proven document tracking are in place before its first navigation.
            await rwtPageReady(returned);
            watch.setPage(returned);
            observe(returned, tap, generations, cloud);
            await installMicAcquisitionCounter(returned);
            await openOpenMic(returned);
        }

        await returned.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 60_000 });
        await returned.waitForTimeout(3_000);
        const back = await tabState(returned);
        const noResume = releasedVerdict(back, 'after returning');
        receipt.row('return does not resume the abandoned take', noResume.status, noResume.detail, { ...back });
        const notice = returned.getByTestId('session-recovery-actions');
        const shown = await notice.count() > 0;
        const noticeText = shown ? await returned.getByTestId('session-recovery-message').innerText().catch(() => '') : '';
        // The left take's persistence as the server holds it, against the pre-first-Start baseline, read before the notice is
        // dismissed and before the next take; the next-take baseline is unchanged. Server truth judges the notice for BOTH
        // variants (Codex P1 r4296551963, Sam 6219377681 option a).
        const rowsAtReturn = await readRows(owner.uid);
        // Two distinct observations (Sam 6220514829): whether any transcript persisted (judges the notice), and whether the
        // left take was saved exactly once (the navigate-away idempotency gate). Both from the complete new-row set.
        const leftTakeSaved = priorTakeSaved(rowsBeforeFirst, rowsAtReturn);
        const leftTakeOnce = leftTakeSavedOnce(rowsBeforeFirst, rowsAtReturn);
        const leftTakeRows = newRowsSince(rowsBeforeFirst, rowsAtReturn);
        addCompletedTakeIds(takes, leftTakeRows);
        const leftTakeRowCounts = { newRows: leftTakeRows.length, newCompleted: leftTakeRows.filter((r) => r.status === 'completed').length };
        if (variant === 'navigate-away') {
            // Codex P1 r4296551953 / r4297070691: Leave is "Stop and save" — exactly one completed row for the left take.
            const kept = leftTakeSavedVerdict(leftTakeOnce);
            receipt.row('leaving saved the left take', kept.status, kept.detail, { leftTakeOnce, leftTakeSaved, ...leftTakeRowCounts });
        }
        const recovery = recoveryNoticeVerdict({
            shown,
            state: shown ? await notice.getAttribute('data-recovery-state') : null,
            ...classifyRecoveryClaim(noticeText),
            priorTakeSaved: leftTakeSaved,
        });
        receipt.row('recovery notice is truthful', recovery.status, recovery.detail,
            { shown, leftTakeSaved, unresolvedBanner: await returned.getByTestId('session-unresolved-recovery').count() > 0 });
        if (shown) await returned.getByTestId('session-recovery-dismiss').click();

        // The next take: the person presses Start, and presses again only if the product says why it refused.
        const rowsBeforeNext = await readRows(owner.uid);
        await waitForPrivateEngineReady(returned, 600_000);
        await returned.getByTestId('mic-start').click();
        const firstPressRecorded = await isRecording(returned, 30_000);
        let refusalCopyShown = false;
        let secondPressRecorded: boolean | null = null;
        if (!firstPressRecorded) {
            refusalCopyShown = await refusalShown(returned);
            if (refusalCopyShown) {
                // Codex P2 r4314462589: the expected first refusal is spent — the explicit retry is strict, as on the two-device
                // take-over: a refusal or an allowed lease failure of THIS press trips the watchdog at once.
                watch.setStartRefusedAllowed(false);
                watch.setFaultPhase(false);
                await returned.getByTestId('mic-start').click();
                secondPressRecorded = await isRecording(returned, 60_000);
            }
        }
        const start = returnStartVerdict({ firstPressRecorded, refusalCopyShown, secondPressRecorded });
        receipt.row('return Start is truthful', start.status, start.detail, { firstPressRecorded, refusalCopyShown, secondPressRecorded });
        watch.setFaultPhase(false);
        if (start.status !== 'PASS') return;
        await returned.waitForTimeout(Math.round((fixture.entry.speechSeconds + 4) * 1000));
        await stopBenchmarkRecording(returned, `abandon-${variant}-2`, 180_000);
        await expect(returned.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
        const nextId = await persistedId(returned);
        if (nextId) takes.push(nextId);
        const rowsAfter = await readRows(owner.uid);
        const only = nextTakeOnlyItselfVerdict(rowsBeforeNext, rowsAfter, nextId);
        receipt.row('next take saves only itself', only.status, only.detail,
            { rowsBefore: rowsBeforeNext.length, rowsAfter: rowsAfter.length, activeAfter: rowsAfter.filter((r) => r.status === 'active').length });
    } catch (error) {
        receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
        throw error;
    } finally {
        await finish();
    }
}

test.describe('RWT — leaving a recording, and two tabs @live', () => {
    test.afterEach(async () => {
        await finalizer.drain();
    });

    test('navigate away mid-recording, return, and the next take saves only itself', async ({ page }, testInfo) => {
        test.setTimeout(1_800_000);
        await abandonAndReturn(page, testInfo, 'navigate-away');
    });

    test('close the tab mid-recording, reopen, and the next take saves only itself', async ({ page }, testInfo) => {
        test.setTimeout(1_800_000);
        await abandonAndReturn(page, testInfo, 'close-tab');
    });

    test('one account, two places: a same-browser tab is refused locally; another device is refused by the lease and takes over the one engine', async ({ page: tabA, browser, baseURL }, testInfo) => {
        test.setTimeout(1_800_000);
        const receipt = new RwtReceipt(TWO_TAB_SUITE);
        const tap = new AnalyticsTap();
        const generations = new CoachingGenerationTap();
        const cloud = { requests: 0 };
        observe(tabA, tap, generations, cloud);
        const owner: RunOwner = { email: '', uid: '' };
        const takes: string[] = [];
        let claimed = false;
        let rowsBeforeFirst: RowFacts[] | null = null;
        let sameBrowserTab: Page | null = null;
        let otherDevice: BrowserContext | null = null;
        // #1593 fail early, across both places: tab A's context and the other device are closed together on a trip.
        const watch = armWatchdog({ page: tabA, tap, profile: watchProfileFor(TWO_TAB_SUITE), label: TWO_TAB_SUITE, contexts: () => [otherDevice] });
        // #1593 (Sam, #1662 RETURN control 1): ONE owned finalization — the body's finally and the suite's afterEach
        // (which Playwright runs after a timeout) run this same memoized closure exactly once.
        const finish = finalizer.once(async () => {
            // Sam, #1662 RETURN: every step is bounded and isolated, so cleanup and the receipt always run.
            const steps = new FinalizationSteps();
            // Codex P2 r4313846488: a failure still queued in PostHog reaches the tap BEFORE the watchdog's terminal scan
            // (bounded; page-independent, since a finalizer may run after its tabs closed).
            await steps.step('telemetry settle', () => tap.settleEveryPage((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
            await steps.step('watchdog', () => watch.record(receipt));
            // Sam, #1662 RETURN on f527a033 (item 2): each close is its own bounded, isolated step — a hung first close can
            // neither block the drain nor skip the second close. Codex P2 on 76a0bf6e: they run after the coaching settle
            // and cleanup but BEFORE the report, so a failed or timed-out close is in the receipt.
            await finishJourney(receipt, testInfo, tap, generations, owner, claimed, cloud, takes, rowsBeforeFirst, steps, async () => {
                await steps.step('same-browser tab close', () => sameBrowserTab?.close());
                await steps.step('other device close', () => otherDevice?.close());
            });
        });
        try {
            await suppressPageSnapshot(testInfo);
            claimed = await prepareRunOwnedAccount(tabA, receipt, owner, 'two-tab', admin, SERVICE_ROLE);
            if (!claimed) return;
            rowsBeforeFirst = await readRows(owner.uid);
            await openOpenMic(tabA);
            await startFirstPrivateTake(tabA, 'two-tab-a');
            await tabA.waitForTimeout(3_000);

            // (1) SAME BROWSER (PM 6207105255): a second tab of this context meets this browser's own tab lock before any
            // server lease is involved. It must be refused truthfully and start no engine; A keeps recording.
            // #1593: from the second tab on, lease refusals and the displaced take are this journey's expected faults; the
            // take-over press itself is strict (setStartRefusedAllowed(false) below).
            watch.setFaultPhase(true);
            sameBrowserTab = await tabA.context().newPage();
            await rwtPageReady(sameBrowserTab);
            observe(sameBrowserTab, tap, generations, cloud);
            // Codex P1 r4309261415: the long waits of this phase run on the second tab, so its DOM is what can stall.
            watch.setPage(sameBrowserTab);
            await installMicAcquisitionCounter(sameBrowserTab);
            await openOpenMic(sameBrowserTab);
            await waitForPrivateEngineReady(sameBrowserTab, 600_000);
            await sameBrowserTab.getByTestId('mic-start').click();
            const localRefusal = await refusalShown(sameBrowserTab);
            await sameBrowserTab.waitForTimeout(2_000);
            const [refusedLocal, stillA] = [await tabState(sameBrowserTab), await tabState(tabA)];
            const local = secondTabBlockedVerdict({ refusalCopyShown: localRefusal, tabB: refusedLocal, tabA: stillA });
            receipt.row('same-browser tab is refused', local.status, local.detail,
                { refusalCopyShown: localRefusal, ...flatTabState('tabB', refusedLocal), ...flatTabState('tabA', stillA) });
            watch.setPage(tabA);
            await sameBrowserTab.close();
            sameBrowserTab = null;

            // (2) ANOTHER DEVICE: an isolated context, signed in normally to the SAME run-owned account. Only here does the
            // server's account lease decide: refused first, then the person's explicit second press takes over.
            otherDevice = await browser.newContext({ baseURL, permissions: ['microphone'] });
            await routeVercelBypass(otherDevice, baseURL);
            const deviceB = await otherDevice.newPage();
            // From here every long wait (sign-in, the cold press, the refusal, the take-over recording) runs on device B.
            watch.setPage(deviceB);
            // Sam, #1662 RETURN on f527a033 (item 7): the lease failure codes this phase expects are tab A's displacement only;
            // device B's own recording stays strict throughout the take-over (its expected first-press refusal is a refusal).
            watch.scopeFailureAllowance([tabA]);
            await applyRwtIdentity(otherDevice, deviceB, await rwtIdentityFor(browser));
            observe(deviceB, tap, generations, cloud);
            await installMicAcquisitionCounter(deviceB);
            if (!owner.signInOn) throw new Error('the run-owned account cannot sign in on another device');
            await owner.signInOn(deviceB);
            await openOpenMic(deviceB);
            await selectBenchmarkMode(deviceB, 'private');
            // #1593 (live case 11, run 39167899488): a fresh device has no model, and since #1415 the cold control is ONE
            // activation — consent, download AND start ("Download & start recording" = `onStart`). Under A's lease that
            // press is a Start the lease decides, so it is the person's first press here; the download-only setup helper
            // (which requires the status to leave `download-required`) asserted a control the product no longer has.
            const coldB = await deviceB.evaluate(() => document.documentElement.getAttribute('data-model-status')) === 'download-required';
            // Sam, #1662 RETURN (lease-before-model): observe model work from BEFORE the first press through the refusal —
            // every model-asset request on device B, and every published model status (a final snapshot cannot prove no
            // prior work: loading → download-required would look clean).
            let modelRequestsB = 0;
            otherDevice.on('request', (r) => { if (/\/models\//.test(r.url())) modelRequestsB += 1; });
            await deviceB.evaluate(installModelStatusHistory);
            // Case 11 window (Sam's 13:13 ACCEPT of PM 9fc69b51; RETURN on c8e5d59f): ONE continuous observation window in
            // each page, opened before the first press — A's runtime transitions and track continuity, B's model, microphone
            // and runtime history — closed by one synchronous read just before the take-over press. Bound to each page's
            // document by its token: a replaced document has no window, which is a lost observation, never zero activity.
            const windowToken = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const openedA = await tabA.evaluate(openObservationWindow, { token: `${windowToken}-a`, recorderTestId: RECORDER_BAR }).catch(() => false);
            const openedB = await deviceB.evaluate(openObservationWindow, { token: `${windowToken}-b`, recorderTestId: RECORDER_BAR }).catch(() => false);
            if (coldB) {
                await deviceB.getByTestId('mic-download').click();
            } else {
                await waitForPrivateEngineReady(deviceB, 600_000);
                await deviceB.getByTestId('mic-start').click();
            }
            // Sam, #1662 RETURN (lease-before-model): the lease decides BEFORE any engine or model work — the start handler
            // acquires it first (useSessionLifecycle acquireTakeLease). So the first press must be refused within a bounded
            // window, and on a cold device the model must still be `download-required` when it is: a refusal that only
            // arrives after model preparation began is a FAIL, never a slow PASS. Model work belongs to the take-over press.
            const refusalShownB = deviceB.getByText(BLOCKED_COPY).first();
            const refusedInTime = await refusalShownB.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
            const modelRequestsBeforeRefusal = modelRequestsB;
            // The hold the person waits, then the closing observation of both pages, immediately before the take-over press.
            await deviceB.waitForTimeout(2_000);
            const closedB = await deviceB.evaluate(closeObservationWindow).catch(() => null);
            const closedA = await tabA.evaluate(closeObservationWindow).catch(() => null);
            const lost: ObservationClose = { token: null, runtimeTransitions: [], runtimeNow: null, modelTransitions: [], modelNow: null, micAcquisitionsSinceOpen: null, tracksStoppedSinceOpen: 0, liveTracksAtOpen: 0, liveTracks: 0, recorderVisible: false };
            const observedWindow = openedA && openedB && closedA?.token === `${windowToken}-a` && closedB?.token === `${windowToken}-b`;
            const refusal = leaseRefusalWindowVerdict({
                observed: observedWindow, refusalCopyShown: refusedInTime, cold: coldB, modelRequests: modelRequestsB, b: closedB ?? lost, a: closedA ?? lost,
            });
            receipt.row('another device is refused by the account lease', refusal.status, refusal.detail, {
                refusalCopyShown: refusedInTime, coldB, observedWindow, modelRequestsBeforeRefusal, modelRequestsInWindow: modelRequestsB,
                modelTransitionsB: (closedB ?? lost).modelTransitions.length, micAcquisitionsB: (closedB ?? lost).micAcquisitionsSinceOpen ?? -1,
                runtimeTransitionsA: (closedA ?? lost).runtimeTransitions.length, tracksStoppedA: (closedA ?? lost).tracksStoppedSinceOpen,
                micAcquisitionsA: (closedA ?? lost).micAcquisitionsSinceOpen ?? -1,
                deviceBRuntimeState: (closedB ?? lost).runtimeNow, deviceBLiveTracks: (closedB ?? lost).liveTracks,
                tabARuntimeState: (closedA ?? lost).runtimeNow, tabALiveTracks: (closedA ?? lost).liveTracks,
            });

            // The person's explicit second press is the take-over — on whichever primary control the refused page renders
            // (still the cold `mic-download` when the lease refused before any download).
            // Codex P2 r4309303711: the expected refusal is spent — a refusal of THIS press trips the watchdog at once, and a
            // take-over that never records ends the scenario here instead of carrying on through the later waits.
            watch.setStartRefusedAllowed(false);
            await deviceB.locator('[data-testid="mic-start"], [data-testid="mic-download"]').first().click();
            if (!(await isRecording(deviceB, coldB ? 900_000 : 60_000))) throw new Error('the explicit take-over press did not start a recording');
            const displacedCopyShown = await tabA.getByText(DISPLACED_COPY).waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
            await expect.poll(async () => (await tabState(tabA)).liveTracks, { timeout: 20_000 }).toBe(0).catch(() => undefined);
            const [displacedA, takingB] = [await tabState(tabA), await tabState(deviceB)];
            const moved = takeOverVerdict({ tabA: displacedA, tabB: takingB, displacedCopyShown });
            receipt.row('take-over moves the one engine', moved.status, moved.detail,
                { displacedCopyShown, ...flatTabState('tabA', displacedA), ...flatTabState('deviceB', takingB) });
            // Codex P2 r4309443360: the displaced take's lease codes were the expected faults; from here device B's own
            // recording and save are strict — B failing with a lease code is never excused.
            watch.setFaultPhase(false);

            await deviceB.waitForTimeout(6_000);
            await stopBenchmarkRecording(deviceB, 'two-tab-b', 180_000);
            await expect(deviceB.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
            await expect(tabA.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
            const takeOverId = await persistedId(deviceB);
            const displacedId = await persistedId(tabA);
            for (const id of [displacedId, takeOverId]) if (id) takes.push(id);
            const rows = await readRows(owner.uid);
            const closed = takeOverRowsVerdict(rows, displacedId, takeOverId);
            receipt.row('both takes saved, none left active', closed.status, closed.detail,
                { rows: rows.length, activeAfter: rows.filter((r) => r.status === 'active').length, distinctTakes: displacedId !== takeOverId });
        } catch (error) {
            receipt.row('scenario execution', 'FAIL', error instanceof Error ? error.name : 'scenario_error');
            throw error;
        } finally {
            await finish();
        }
    });
});
