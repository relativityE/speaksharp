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
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/rwtProductionTest';
import { cleanupRunOwnedAccount } from './helpers/runOwnedCleanup';
import {
    AnalyticsTap, RWT_ACCOUNT_PREFIX, RwtReceipt, installMicAcquisitionCounter, loadRwtFixture, rwtLaunchArgs,
    suppressPageSnapshot, telemetryClassRows,
} from './helpers/rwtJourney';
import { flatTabState, isRecording, observeCloudStt, persistedId, tabState } from './helpers/rwtPageState';
import { type RunOwner, prepareRunOwnedAccount } from './helpers/rwtDisposableAccount';
import { bindReadbackJourneys } from './helpers/rwtOracles';
import { CoachingGenerationTap } from './helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from './helpers/rwtCoachingCollector';
import { openProductsItem } from './helpers/productsMenu';
import {
    preparePrivateModelIfPrompted, selectBenchmarkMode, startBenchmarkRecording, stopBenchmarkRecording, waitForPrivateEngineReady,
} from './helpers/benchmark-utils';
import {
    ABANDON_SUITE, type AbandonVariant, BLOCKED_COPY, DISPLACED_COPY, type RowFacts, SAME_BROWSER_TAB_COPY,
    TWO_TAB_SUITE, nextTakeOnlyItselfVerdict, noCloudVerdict, recoveryNoticeVerdict, releasedVerdict,
    returnStartVerdict, secondTabBlockedVerdict, takeOverRowsVerdict, takeOverVerdict,
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

async function finish(receipt: RwtReceipt, testInfo: TestInfo, tap: AnalyticsTap, generations: CoachingGenerationTap,
    owner: RunOwner, claimed: boolean, cloud: { requests: number }, takes: string[]): Promise<void> {
    const cloudVerdict = noCloudVerdict(cloud.requests);
    receipt.row('no Cloud STT request', cloudVerdict.status, cloudVerdict.detail, { cloudRequests: cloud.requests });
    await generations.settle();
    coachingRequestBudgetRow(receipt, generations, { maximum: 2, oneRequestPerSession: takes });
    if (owner.uid) {
        try {
            await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: owner.uid, createdEmail: owner.email, runOwnedPrefix: RWT_ACCOUNT_PREFIX });
            receipt.row('run-owned cleanup', 'PASS', 'the run-owned account was deleted and residue checks passed');
        } catch {
            receipt.row('run-owned cleanup', 'FAIL', 'run-owned account deletion or residue readback failed');
        }
    }
    telemetryClassRows(receipt, tap, claimed, false);
    receipt.write(testInfo, bindReadbackJourneys(tap.events, { recording: [], feedback: false }), tap.trafficTypes());
}

async function abandonAndReturn(page: Page, testInfo: TestInfo, variant: AbandonVariant): Promise<void> {
    const receipt = new RwtReceipt(`${ABANDON_SUITE}-${variant}`);
    const tap = new AnalyticsTap();
    const generations = new CoachingGenerationTap();
    const cloud = { requests: 0 };
    observe(page, tap, generations, cloud);
    const owner: RunOwner = { email: '', uid: '' };
    const takes: string[] = [];
    let claimed = false;
    try {
        await suppressPageSnapshot(testInfo);
        claimed = await prepareRunOwnedAccount(page, receipt, owner, `abandon-${variant}`, admin, SERVICE_ROLE);
        if (!claimed) return;
        await openOpenMic(page);
        await startFirstPrivateTake(page, `abandon-${variant}-1`);
        await page.waitForTimeout(MID_TAKE_MS);
        const during = await tabState(page);
        const midTake = during.runtimeState === 'RECORDING' && during.liveTracks > 0;
        receipt.row('take is recording before leaving', midTake ? 'PASS' : 'HOLD', midTake
            ? 'a Private take was recording with a live microphone when the person left'
            : 'the take was not recording when the person left, so abandonment was not exercised', { ...during });
        if (!midTake) return;

        let returned = page;
        if (variant === 'navigate-away') {
            await openProductsItem(page, 'focus-points');
            await page.waitForURL(/\/practice\?product=focus-points/, { timeout: 45_000 });
            await page.waitForTimeout(3_000);
            const afterLeaving = await tabState(page);
            const left = releasedVerdict(afterLeaving, 'after leaving');
            receipt.row('leaving mid-recording releases the microphone', left.status, left.detail, { ...afterLeaving });
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
        const recovery = recoveryNoticeVerdict({
            shown,
            state: shown ? await notice.getAttribute('data-recovery-state') : null,
            claimsSavedTranscript: noticeText.includes('transcript was saved') && !noticeText.includes('No transcript was saved'),
        });
        receipt.row('recovery notice is truthful', recovery.status, recovery.detail,
            { shown, unresolvedBanner: await returned.getByTestId('session-unresolved-recovery').count() > 0 });
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
                await returned.getByTestId('mic-start').click();
                secondPressRecorded = await isRecording(returned, 60_000);
            }
        }
        const start = returnStartVerdict({ firstPressRecorded, refusalCopyShown, secondPressRecorded });
        receipt.row('return Start is truthful', start.status, start.detail, { firstPressRecorded, refusalCopyShown, secondPressRecorded });
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
        await finish(receipt, testInfo, tap, generations, owner, claimed, cloud, takes);
    }
}

test.describe('RWT — leaving a recording, and two tabs @live', () => {
    test('navigate away mid-recording, return, and the next take saves only itself', async ({ page }, testInfo) => {
        test.setTimeout(1_800_000);
        await abandonAndReturn(page, testInfo, 'navigate-away');
    });

    test('close the tab mid-recording, reopen, and the next take saves only itself', async ({ page }, testInfo) => {
        test.setTimeout(1_800_000);
        await abandonAndReturn(page, testInfo, 'close-tab');
    });

    test('two tabs: the second is refused, an explicit take-over moves the one engine, nothing goes to Cloud', async ({ page: tabA }, testInfo) => {
        test.setTimeout(1_800_000);
        const receipt = new RwtReceipt(TWO_TAB_SUITE);
        const tap = new AnalyticsTap();
        const generations = new CoachingGenerationTap();
        const cloud = { requests: 0 };
        observe(tabA, tap, generations, cloud);
        const owner: RunOwner = { email: '', uid: '' };
        const takes: string[] = [];
        let claimed = false;
        let tabB: Page | null = null;
        try {
            await suppressPageSnapshot(testInfo);
            claimed = await prepareRunOwnedAccount(tabA, receipt, owner, 'two-tab', admin, SERVICE_ROLE);
            if (!claimed) return;
            await openOpenMic(tabA);
            await startFirstPrivateTake(tabA, 'two-tab-a');
            await tabA.waitForTimeout(3_000);

            tabB = await tabA.context().newPage();
            observe(tabB, tap, generations, cloud);
            await installMicAcquisitionCounter(tabB);
            await openOpenMic(tabB);
            await waitForPrivateEngineReady(tabB, 600_000);
            await tabB.getByTestId('mic-start').click();
            const refusalCopyShown = await refusalShown(tabB);
            await tabB.waitForTimeout(2_000);
            const [refusedB, stillA] = [await tabState(tabB), await tabState(tabA)];
            const blocked = secondTabBlockedVerdict({ refusalCopyShown, tabB: refusedB, tabA: stillA });
            receipt.row('second tab is refused truthfully', blocked.status, blocked.detail,
                { refusalCopyShown, ...flatTabState('tabB', refusedB), ...flatTabState('tabA', stillA) });

            // The person's explicit second press is the take-over.
            await tabB.getByTestId('mic-start').click();
            await isRecording(tabB, 60_000);
            const displacedCopyShown = await tabA.getByText(DISPLACED_COPY).waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
            await expect.poll(async () => (await tabState(tabA)).liveTracks, { timeout: 20_000 }).toBe(0).catch(() => undefined);
            const [displacedA, takingB] = [await tabState(tabA), await tabState(tabB)];
            const moved = takeOverVerdict({ tabA: displacedA, tabB: takingB, displacedCopyShown });
            receipt.row('take-over moves the one engine', moved.status, moved.detail,
                { displacedCopyShown, ...flatTabState('tabA', displacedA), ...flatTabState('tabB', takingB) });

            await tabB.waitForTimeout(6_000);
            await stopBenchmarkRecording(tabB, 'two-tab-b', 180_000);
            await expect(tabB.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
            await expect(tabA.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 180_000 }).catch(() => undefined);
            const takeOverId = await persistedId(tabB);
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
            await finish(receipt, testInfo, tap, generations, owner, claimed, cloud, takes);
            await tabB?.close().catch(() => undefined);
        }
    });
});
