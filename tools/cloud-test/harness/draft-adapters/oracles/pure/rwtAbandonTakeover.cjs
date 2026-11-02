// Exact main70e TypeScript source mechanically transpiled; no browser/network executed.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBSERVATION_TICK_MS = exports.RECOVERY_NOTICE_COPY = exports.newLeaveDialogs = exports.CLOUD_STT_REQUEST = exports.STOP_FAILED_ALERT_COPY = exports.LEAVE_PROMPT_COPY = exports.DISPLACED_COPY = exports.SAME_BROWSER_TAB_COPY = exports.BLOCKED_COPY = exports.TWO_TAB_SUITE = exports.ABANDON_VARIANTS = exports.ABANDON_SUITE = void 0;
exports.actionablePrivateStartForLease = actionablePrivateStartForLease;
exports.pressPrivateStartForLease = pressPrivateStartForLease;
exports.releasedVerdict = releasedVerdict;
exports.answerLeaveDialog = answerLeaveDialog;
exports.leavePromptVerdict = leavePromptVerdict;
exports.returnStartVerdict = returnStartVerdict;
exports.classifyRecoveryClaim = classifyRecoveryClaim;
exports.newRowsSince = newRowsSince;
exports.completedTakeIds = completedTakeIds;
exports.addCompletedTakeIds = addCompletedTakeIds;
exports.refreshCompletedTakeIds = refreshCompletedTakeIds;
exports.priorTakeSaved = priorTakeSaved;
exports.leftTakeSavedOnce = leftTakeSavedOnce;
exports.leftTakeSavedVerdict = leftTakeSavedVerdict;
exports.recoveryNoticeVerdict = recoveryNoticeVerdict;
exports.nextTakeOnlyItselfVerdict = nextTakeOnlyItselfVerdict;
exports.modelWorkBeforeRefusal = modelWorkBeforeRefusal;
exports.installModelStatusHistory = installModelStatusHistory;
exports.secondTabBlockedVerdict = secondTabBlockedVerdict;
exports.measureRealmClock = measureRealmClock;
exports.crossRealmBoundary = crossRealmBoundary;
exports.openObservationWindow = openObservationWindow;
exports.armTakeoverGesture = armTakeoverGesture;
exports.closeObservationWindow = closeObservationWindow;
exports.leaseRefusalWindowVerdict = leaseRefusalWindowVerdict;
exports.takeOverVerdict = takeOverVerdict;
exports.noCloudVerdict = noCloudVerdict;
exports.takeOverRowsVerdict = takeOverRowsVerdict;
/**
 * RWT R2 (row 16) — the pure verdicts behind `rwt-abandon-and-two-tabs`: leaving a recording mid-take (in-app
 * navigation, or closing the tab), returning, and the same account's two-tab take-over (#1476). Free of Playwright so
 * every rule is unit-tested with its failing controls. Inputs are content-free: states, counts and booleans.
 */
exports.ABANDON_SUITE = 'abandon-and-two-tabs';
exports.ABANDON_VARIANTS = ['navigate-away', 'close-tab'];
exports.TWO_TAB_SUITE = `${exports.ABANDON_SUITE}-take-over`;
/** The product's own refusal copy (#1476 account lease; the pre-#1476 same-browser tab lock may answer first). */
exports.BLOCKED_COPY = /A recording is active on .+\. Stop it there, or press Start again to take over here/;
/** Both wordings the product shows: the hook's longer line, and the controller's own status line. */
exports.SAME_BROWSER_TAB_COPY = /Active session in another tab\./;
exports.DISPLACED_COPY = 'This recording stopped because another device took over. What was recorded here is being saved.';
/**
 * #1258 (round 2, run 38876623812) — the product's in-app leave guard (App.tsx): while a take records on /session, a
 * same-origin link off /session is held and the person is asked this. OK stops and saves the take, then goes; Cancel stays.
 */
exports.LEAVE_PROMPT_COPY = 'A recording is still active. Stop and save this session before leaving?';
/** The guard's own alert when Leave could not stop and save the take (App.tsx). */
exports.STOP_FAILED_ALERT_COPY = 'We could not stop and save the recording yet. Please stop the session before leaving.';
/** The browser-side Cloud STT surfaces: its token function and its provider. Private must never reach either. */
exports.CLOUD_STT_REQUEST = /assemblyai/i;
/** Self-contained page predicate. A resolved mode is not a settled model-availability decision. */
function actionablePrivateStartForLease() {
    const root = document.documentElement;
    const status = root.getAttribute('data-model-status');
    const control = status === 'download-required' ? 'mic-download'
        : (status === 'ready' || (status === 'idle' && root.getAttribute('data-stt-ready') === 'true')) ? 'mic-start' : null;
    if (!control)
        return false;
    const button = document.querySelector(`[data-testid="${control}"]`);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length)
        return false;
    const style = getComputedStyle(button);
    return style.visibility !== 'hidden' && style.display !== 'none' ? control : false;
}
/**
 * Case 11's first activation: wait for the actionable cold/warm decision, never initialise a cold model.
 * Open refusal observation only AFTER background availability settles, immediately before the actual Start.
 * A replaced/disabled control fails its bounded click; it is never silently replaced by a different gesture.
 */
async function pressPrivateStartForLease(page, waitForReady, beforePress = async () => undefined) {
    const handle = await page.waitForFunction(actionablePrivateStartForLease, undefined, { timeout: 30_000 });
    let control;
    try {
        control = await handle.jsonValue();
    }
    finally {
        await handle.dispose();
    }
    if (control !== 'mic-download' && control !== 'mic-start')
        throw new Error('private Start control was not established');
    if (control === 'mic-start')
        await waitForReady(page, 30_000);
    await beforePress();
    await page.getByTestId(control).click({ timeout: 30_000 });
    return control === 'mic-download';
}
const recordingNow = (t) => t.runtimeState === 'RECORDING' || t.recorderVisible || t.liveTracks > 0;
/** After leaving: nothing records, no recorder shows, and every microphone track has ended. */
function releasedVerdict(t, where) {
    if (t.liveTracks > 0)
        return { status: 'FAIL', detail: `${where}: a microphone track is still live` };
    if (t.recorderVisible || t.runtimeState === 'RECORDING')
        return { status: 'FAIL', detail: `${where}: the page still shows or holds a recording` };
    return { status: 'PASS', detail: `${where}: nothing records and every microphone track has ended` };
}
const newLeaveDialogs = () => ({ prompts: 0, unexpectedDialogs: 0, stopFailedAlerts: 0 });
exports.newLeaveDialogs = newLeaveDialogs;
/**
 * #1258 (Sam 6218709582) — the ONE dialog the journey may accept: the first `confirm` carrying the product's exact leave
 * copy. Every other dialog — another copy, a repeat, a `prompt`, a `beforeunload`, any alert — is dismissed and counted,
 * so a wrong dialog can never be answered Leave. The guard's stop-failure alert is counted on its own.
 */
function answerLeaveDialog(seen, d) {
    if (d.type === 'confirm' && d.message === exports.LEAVE_PROMPT_COPY && seen.prompts === 0) {
        seen.prompts += 1;
        return 'accept';
    }
    if (d.type === 'alert' && d.message === exports.STOP_FAILED_ALERT_COPY)
        seen.stopFailedAlerts += 1;
    else
        seen.unexpectedDialogs += 1;
    return 'dismiss';
}
/**
 * Navigate away: the product asks once before leaving a live recording, in its own words; the person answers Leave; no
 * other dialog appears; the guard reports no stop failure; and the page reaches where they chose. An unanswered prompt
 * is the person choosing Cancel, which keeps them on the recording, so the journey must answer it. Arrival is NOT
 * persistence evidence: whether the left take saved is read from the server (`priorTakeSaved`).
 */
function leavePromptVerdict(o) {
    if (o.unexpectedDialogs > 0)
        return { status: 'FAIL', detail: 'an unexpected dialog appeared (other copy, a repeat, or another kind); it was dismissed, never accepted' };
    if (o.prompts === 0)
        return { status: 'FAIL', detail: 'the product did not ask before leaving a live recording' };
    if (o.stopFailedAlerts > 0)
        return { status: 'FAIL', detail: 'answering Leave could not stop and save the recording' };
    if (!o.arrived)
        return { status: 'FAIL', detail: 'answering Leave did not reach the chosen page' };
    return { status: 'PASS', detail: 'the product asked once before leaving the live recording; Leave reached the chosen page' };
}
/**
 * Returning: the first Start either records, or refuses with the product's truthful copy and records on the person's
 * explicit second press. A refusal without that copy, or a take-over that never records, is a FAIL.
 */
function returnStartVerdict(o) {
    if (o.firstPressRecorded)
        return { status: 'PASS', detail: 'Start recorded on the first press after returning' };
    if (!o.refusalCopyShown)
        return { status: 'FAIL', detail: 'Start did not record and gave no truthful reason' };
    if (o.secondPressRecorded !== true)
        return { status: 'FAIL', detail: 'Start was refused truthfully, but the explicit second press did not record' };
    return { status: 'PASS', detail: 'Start was refused with the truthful reason, and the explicit second press recorded' };
}
/**
 * #1258 (Sam 6218709582 / 6219021013) — the recovery notice's own wordings (SessionPage `session-recovery-message`). The two
 * interrupted wordings say the take was NOT saved (no completion was ever sent, so that is known). #1474 (Sam 1792278508):
 * the finalized wording claims neither — its save is unconfirmed — so it is truthful whatever the server holds.
 */
exports.RECOVERY_NOTICE_COPY = Object.freeze({
    finalized_pending_save: 'Your last session finished, but we couldn’t confirm it was saved. Its measurements were kept on this device.',
    interrupted_partial: 'Your last session was interrupted before it was saved. No transcript was saved, and only partial measurements were captured.',
    interrupted: 'Your last session was interrupted before it was saved. No transcript was saved.',
});
const UNSAVED_MARKERS = ['No transcript was saved', 'was not saved', 'no transcript was stored'];
/** What a recovery notice CLAIMS about the left take's transcript, from its text (classified, never stored). */
function classifyRecoveryClaim(text) {
    const claimsUnsavedTranscript = UNSAVED_MARKERS.some((m) => text.includes(m));
    return { claimsSavedTranscript: !claimsUnsavedTranscript && /transcript was saved/i.test(text), claimsUnsavedTranscript };
}
/** The rows the left take created: every row absent from the pre-first-Start baseline, as the SERVER holds it. */
function newRowsSince(baseline, atReturn) {
    const before = new Set(baseline.map((r) => r.id));
    return atReturn.filter((r) => !before.has(r.id));
}
/** Include every saved left take in the whole-scenario per-take coaching budget. */
function completedTakeIds(rows) {
    return rows.filter((row) => row.status === 'completed').map((row) => row.id);
}
/** Refresh after later server reads too: an abandoned take may finish saving after return. */
function addCompletedTakeIds(takes, rows) {
    for (const id of completedTakeIds(rows))
        if (!takes.includes(id))
            takes.push(id);
}
/** Finalization runs on successful, returned and thrown paths; unreadable identities are never verified. */
async function refreshCompletedTakeIds(takes, baseline, readFinalRows) {
    if (baseline === null)
        return false;
    try {
        addCompletedTakeIds(takes, newRowsSince(baseline, await readFinalRows()));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Whether ANY transcript of the take the person left was persisted, as the SERVER holds it: at least one completed row
 * that was not there before the first Start. This is what the recovery notice must tell the truth about (Sam 6220514829):
 * a "saved" notice is truthful even if a duplicate also exists — the duplicate fails the idempotency gate on its own.
 * Observed, never inferred from arrival or the absence of an alert.
 */
function priorTakeSaved(baseline, atReturn) {
    return newRowsSince(baseline, atReturn).some((r) => r.status === 'completed');
}
/**
 * Idempotency (Codex P1 r4297070691, Sam 6220514829): the left take was saved EXACTLY ONCE — one new row since the
 * pre-first-Start baseline, and it is completed. Zero rows, a duplicate completed row, completed plus an active/failed
 * row, or only active/failed rows are not "saved once"; observed before the next-take baseline absorbs them.
 */
function leftTakeSavedOnce(baseline, atReturn) {
    const created = newRowsSince(baseline, atReturn);
    return created.length === 1 && created[0].status === 'completed';
}
/**
 * #1258 Codex P1 r4296551953 (Sam 6219377681) — navigate away's Leave is "Stop and save": the take the person left must
 * hold a completed row on the server, judged against the pre-first-Start baseline. Arrival, the absence of an alert and
 * the absence of a notice prove nothing about persistence, so this row FAILs on its own whenever the row is absent.
 */
function leftTakeSavedVerdict(savedOnce) {
    return savedOnce
        ? { status: 'PASS', detail: 'the take the person left holds a completed row on the server' }
        : { status: 'FAIL', detail: 'Leave was answered, but the take the person left does not hold exactly one completed row on the server' };
}
/**
 * A recovery notice, when shown, must name a known state and tell the truth about the left take (#1258 Sam 6218709582):
 * it may say a transcript was saved only when one was, and may say none was only when none was. Both variants pass the
 * OBSERVED persistence (Codex P1 r4296551963, Sam 6219377681 option a): server truth is authoritative, and a close-tab
 * take that did persist is not itself a defect.
 */
function recoveryNoticeVerdict(o) {
    if (!o.shown)
        return { status: 'PASS', detail: 'no recovery notice was shown, so nothing is claimed about the left take' };
    if (o.state !== 'active_interrupted' && o.state !== 'finalized_pending_save') {
        return { status: 'FAIL', detail: `the recovery notice names an unknown state (${o.state ?? 'none'})` };
    }
    if (o.claimsSavedTranscript && !o.priorTakeSaved)
        return { status: 'FAIL', detail: 'the recovery notice claims a transcript was saved, but the left take was not' };
    if (o.claimsUnsavedTranscript && o.priorTakeSaved)
        return { status: 'FAIL', detail: 'the recovery notice says no transcript was saved, but the left take was saved' };
    return { status: 'PASS', detail: 'the recovery notice matches what the server holds for the left take' };
}
/**
 * The next take saves only itself: exactly one new row, completed, the one the page bound; and no row of the account is
 * left `active` (the abandoned take is closed, not orphaned).
 */
function nextTakeOnlyItselfVerdict(before, after, nextId) {
    if (nextId === null)
        return { status: 'FAIL', detail: 'the next take bound no saved session' };
    const known = new Set(before.map((r) => r.id));
    const created = after.filter((r) => !known.has(r.id));
    if (created.length !== 1)
        return { status: 'FAIL', detail: `the next take created ${created.length} session rows` };
    if (created[0].id !== nextId)
        return { status: 'FAIL', detail: 'the new row is not the session the page bound' };
    if (created[0].status !== 'completed')
        return { status: 'FAIL', detail: `the next take is ${created[0].status ?? 'unreadable'}, not completed` };
    const orphans = after.filter((r) => r.status === 'active').length;
    if (orphans > 0)
        return { status: 'FAIL', detail: `${orphans} session row(s) are still active after the next take saved` };
    return { status: 'PASS', detail: 'the next take saved one new completed session and no take was left active' };
}
/**
 * Sam, #1662 RETURN (case 11, lease-before-model): on a cold device, ANY model work observed from before the first press
 * through its refusal — a model-asset request, any published status other than `download-required`, or that status at
 * refusal — means the lease did not decide first. A final snapshot alone cannot prove it (loading → download-required).
 */
function modelWorkBeforeRefusal(o) {
    return o.cold && (o.modelRequests > 0 || o.statusHistory.some((s) => s !== 'download-required') || o.statusAtRefusal !== 'download-required');
}
/**
 * Sam, #1662 RETURN on f527a033 (item 6): every published model-status TRANSITION, in order. One MutationObserver callback
 * can carry several records, so reading the current attribute once per batch loses `loading → download-required`. Each
 * record's `oldValue` is the value BEFORE it, so the value after record i is record i+1's `oldValue` (the current value
 * after the last). Self-contained: it runs in the page (`page.evaluate(installModelStatusHistory)`), and the unit test drives
 * the same function through a real MutationObserver.
 */
function installModelStatusHistory() {
    const w = window;
    const history = [];
    w.__rwtModelStatusHistory__ = history;
    const root = document.documentElement;
    new MutationObserver((records) => {
        records.forEach((_record, i) => {
            const after = i + 1 < records.length ? records[i + 1].oldValue : root.getAttribute('data-model-status');
            history.push(after ?? 'absent');
        });
    }).observe(root, { attributes: true, attributeFilter: ['data-model-status'], attributeOldValue: true });
}
/** Two tabs: the second tab is refused truthfully, starts no engine, and the first tab keeps recording. */
function secondTabBlockedVerdict(o) {
    if (!o.refusalCopyShown)
        return { status: 'FAIL', detail: 'the second tab was not told why it could not record' };
    if (recordingNow(o.tabB))
        return { status: 'FAIL', detail: 'the refused tab started recording or opened the microphone' };
    if (!recordingNow(o.tabA) || o.tabA.liveTracks === 0)
        return { status: 'FAIL', detail: 'the first tab stopped recording when the second was refused' };
    return { status: 'PASS', detail: 'the second tab was refused truthfully with no engine or microphone, and the first kept recording' };
}
async function measureRealmClock(page, now = Date.now) {
    let best = null;
    for (let i = 0; i < 3; i += 1) {
        const t0 = now();
        let realm;
        try {
            realm = await page.evaluate(() => Date.now());
        }
        catch {
            return null;
        }
        const t1 = now();
        const sample = { offset: realm - (t0 + t1) / 2, error: (t1 - t0) / 2 };
        if (!best || sample.error < best.error)
            best = sample;
    }
    return best;
}
/**
 * B's gesture time mapped into A's clock, with the margin the two measurements actually support (each realm's offset error,
 * plus 1 ms for each realm's whole-millisecond clock). Never a universal constant.
 */
function crossRealmBoundary(gestureAtB, clockA, clockB) {
    return { until: gestureAtB - clockB.offset + clockA.offset, marginMs: clockA.error + clockB.error + 2 };
}
/**
 * Sam (case-11 delayed-observation RETURN on 21c8a9d9): the page's own heartbeat while a window is open. An observer record
 * is delivered at the end of the task that made the mutation, so it is always delivered BEFORE the next tick task runs:
 * an entry at or before the last tick ≤ the boundary is proven earlier, one after the first tick > the boundary proven
 * later, and anything between those ticks (a task straddling the boundary, a stalled loop) is uncertain.
 */
exports.OBSERVATION_TICK_MS = 10;
function openObservationWindow(arg) {
    const w = window;
    const root = document.documentElement;
    const openedAt = Date.now();
    const streams = w.__rwtMicStreams__ ?? [];
    const log = w.__rwtMicAcquisitionLog__;
    // Sam RETURN on 04920bce: the opening state is evidence too.
    const runtime = [root.getAttribute('data-runtime-state') ?? 'absent'];
    const runtimeAt = [openedAt];
    const model = [root.getAttribute('data-model-status') ?? 'absent'];
    const modelAt = [openedAt];
    const stopped = new Map();
    const openTracks = streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === 'live');
    for (const track of openTracks) {
        const stop = track.stop.bind(track);
        track.stop = () => { if (!stopped.has(track))
            stopped.set(track, Date.now()); stop(); };
        track.addEventListener('ended', () => { if (!stopped.has(track))
            stopped.set(track, Date.now()); });
    }
    const record = (records) => {
        const at = Date.now();
        records.forEach((r, i) => {
            const name = r.attributeName ?? '';
            const next = records.slice(i + 1).find((x) => x.attributeName === name);
            const after = next ? next.oldValue : root.getAttribute(name);
            if (name === 'data-runtime-state') {
                runtime.push(after ?? 'absent');
                runtimeAt.push(at);
            }
            else {
                model.push(after ?? 'absent');
                modelAt.push(at);
            }
        });
    };
    const observer = new MutationObserver(record);
    observer.observe(root, { attributes: true, attributeFilter: ['data-runtime-state', 'data-model-status'], attributeOldValue: true });
    const ticks = [openedAt];
    const heartbeat = setInterval(() => { ticks.push(Date.now()); }, arg.tickMs ?? 10);
    w.__rwtObservationWindow__ = {
        token: arg.token, recorderTestId: arg.recorderTestId, openedAt, runtime, runtimeAt, model, modelAt, stopped, openTracks, observer, record,
        liveTracksAtOpen: openTracks.length, acquisitionsAtOpen: log ? log.length : null, gesture: null, ticks, heartbeat,
    };
    return true;
}
/**
 * On B, immediately before the take-over press: the FIRST trusted click from now on marks the end of the refusal window at
 * that event, in B's own realm (pending observer records drained first). `acceptUntrusted` exists only for jsdom tests.
 */
function armTakeoverGesture(arg = {}) {
    const w = window;
    const win = w.__rwtObservationWindow__;
    if (!win)
        return false;
    const onClick = (event) => {
        if (win.gesture || (!event.isTrusted && !arg.acceptUntrusted))
            return;
        win.record(win.observer.takeRecords());
        const at = Date.now();
        for (const track of win.openTracks)
            if (track.readyState !== 'live' && !win.stopped.has(track))
                win.stopped.set(track, at);
        const log = w.__rwtMicAcquisitionLog__;
        win.gesture = { at, runtime: win.runtime.length, model: win.model.length, acquisitions: log ? log.length : null };
        document.removeEventListener('click', onClick, true);
    };
    document.addEventListener('click', onClick, true);
    return true;
}
function closeObservationWindow(arg = {}) {
    const w = window;
    const root = document.documentElement;
    const win = w.__rwtObservationWindow__;
    const streams = w.__rwtMicStreams__ ?? [];
    const liveTracks = streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === 'live').length;
    const recorderVisible = win ? document.querySelector(`[data-testid="${win.recorderTestId}"]`) !== null : false;
    if (!win) {
        return { token: null, boundary: 'none', boundaryUncertain: false, gestureAt: null, runtimeTransitions: [], runtimeNow: root.getAttribute('data-runtime-state'),
            modelTransitions: [], modelNow: root.getAttribute('data-model-status'), micAcquisitionsSinceOpen: null, tracksStoppedSinceOpen: 0, liveTracksAtOpen: 0, liveTracks, recorderVisible };
    }
    win.record(win.observer.takeRecords());
    win.observer.disconnect();
    clearInterval(win.heartbeat);
    const now = Date.now();
    for (const track of win.openTracks)
        if (track.readyState !== 'live' && !win.stopped.has(track))
            win.stopped.set(track, now);
    const log = w.__rwtMicAcquisitionLog__;
    const marks = w.__rwtMicAcquisitions__ ?? null;
    delete w.__rwtObservationWindow__;
    const last = (xs) => (xs.length ? xs[xs.length - 1] : null);
    const unknownCounter = win.acquisitionsAtOpen === null || !log;
    if (win.gesture) {
        const g = win.gesture;
        const runtime = win.runtime.slice(0, g.runtime);
        const model = win.model.slice(0, g.model);
        return {
            token: win.token, boundary: 'gesture', boundaryUncertain: false, gestureAt: g.at, runtimeTransitions: runtime, runtimeNow: last(runtime),
            modelTransitions: model, modelNow: last(model),
            micAcquisitionsSinceOpen: unknownCounter || g.acquisitions === null ? null : g.acquisitions - win.acquisitionsAtOpen,
            tracksStoppedSinceOpen: [...win.stopped.values()].filter((t) => t <= g.at).length, liveTracksAtOpen: win.liveTracksAtOpen, liveTracks, recorderVisible,
        };
    }
    if (arg.until !== undefined) {
        const until = arg.until;
        const margin = arg.marginMs ?? 0;
        // The heartbeat brackets the boundary: entries delivered between the last tick at/before it and the first tick
        // after it may come from a task that straddled it (a delayed delivery) — uncertain, never assigned.
        const lastTickBefore = Math.max(...win.ticks.filter((t) => t <= until - margin), Number.NEGATIVE_INFINITY);
        const afterTicks = win.ticks.filter((t) => t > until + margin);
        const firstTickAfter = afterTicks.length ? Math.min(...afterTicks) : Number.POSITIVE_INFINITY;
        let uncertain = false;
        const side = (t) => {
            if (t <= lastTickBefore)
                return 'before';
            if (t > firstTickAfter)
                return 'after';
            uncertain = true;
            return 'after';
        };
        const runtime = win.runtime.filter((_v, i) => i === 0 || side(win.runtimeAt[i]) === 'before');
        const model = win.model.filter((_v, i) => i === 0 || side(win.modelAt[i]) === 'before');
        const stoppedBefore = [...win.stopped.values()].filter((t) => side(t) === 'before').length;
        // Acquisition times: the counter's own marks since open (no marks = unknown).
        const acquisitions = marks === null ? null : marks.filter((t) => t >= win.openedAt && side(t) === 'before').length;
        return {
            token: win.token, boundary: 'time', boundaryUncertain: uncertain, gestureAt: null, runtimeTransitions: runtime, runtimeNow: last(runtime),
            modelTransitions: model, modelNow: last(model), micAcquisitionsSinceOpen: unknownCounter ? null : acquisitions,
            tracksStoppedSinceOpen: stoppedBefore, liveTracksAtOpen: win.liveTracksAtOpen, liveTracks, recorderVisible,
        };
    }
    return {
        token: win.token, boundary: 'none', boundaryUncertain: false, gestureAt: null, runtimeTransitions: win.runtime.slice(), runtimeNow: root.getAttribute('data-runtime-state'),
        modelTransitions: win.model.slice(), modelNow: root.getAttribute('data-model-status'),
        micAcquisitionsSinceOpen: unknownCounter ? null : log.length - win.acquisitionsAtOpen,
        tracksStoppedSinceOpen: win.stopped.size, liveTracksAtOpen: win.liveTracksAtOpen, liveTracks, recorderVisible,
    };
}
function leaseRefusalWindowVerdict(w) {
    if (!w.observed || w.a.token === null || w.b.token === null || w.a.micAcquisitionsSinceOpen === null || w.b.micAcquisitionsSinceOpen === null
        || w.b.boundary !== 'gesture' || w.a.boundary !== 'time') {
        return { status: 'HOLD', detail: 'the refused window was not observed continuously up to the take-over gesture in the same documents, so no refusal is claimed' };
    }
    if (w.a.boundaryUncertain)
        return { status: 'HOLD', detail: 'the first tab changed at the take-over boundary, so which window it belongs to is unknown' };
    if (!w.refusalCopyShown)
        return { status: 'FAIL', detail: 'the second tab was not told why it could not record' };
    if (modelWorkBeforeRefusal({ cold: w.cold, modelRequests: w.modelRequests, statusHistory: w.b.modelTransitions, statusAtRefusal: w.b.modelNow })) {
        return { status: 'FAIL', detail: 'model preparation happened while the account lease was refusing the device' };
    }
    if (w.b.micAcquisitionsSinceOpen > 0 || w.b.liveTracksAtOpen > 0)
        return { status: 'FAIL', detail: 'the refused device asked for the microphone during the refusal' };
    if (w.b.runtimeTransitions.some((s) => s === 'RECORDING'))
        return { status: 'FAIL', detail: 'the refused tab started recording or opened the microphone' };
    // A re-publishing RECORDING is not an interruption; any other value before the gesture is. The opening value is the
    // first entry, so A must already be RECORDING with a live track when the window opens.
    const interrupted = w.a.runtimeTransitions.some((s) => s !== 'RECORDING') || w.a.tracksStoppedSinceOpen > 0 || w.a.micAcquisitionsSinceOpen > 0;
    if (interrupted || w.a.runtimeTransitions.length === 0 || w.a.liveTracksAtOpen === 0) {
        return { status: 'FAIL', detail: 'the first tab did not record continuously while the second was refused' };
    }
    return { status: 'PASS', detail: 'refused truthfully up to the take-over gesture: no model work, no microphone on the refused device, and the first tab recorded without interruption' };
}
/** The explicit take-over moves the ONE engine: B records, A stops, lets go of its microphone and says why. */
function takeOverVerdict(o) {
    if (!recordingNow(o.tabB) || o.tabB.liveTracks === 0)
        return { status: 'FAIL', detail: 'the take-over did not start recording in the second tab' };
    if (recordingNow(o.tabA))
        return { status: 'FAIL', detail: 'the displaced tab is still recording or holds a live microphone track' };
    if (!o.displacedCopyShown)
        return { status: 'FAIL', detail: 'the displaced tab did not say another device took over' };
    return { status: 'PASS', detail: 'exactly one engine: the second tab records, and the displaced tab stopped and said why' };
}
/** Private never reaches Cloud STT, in any tab, at any step. */
function noCloudVerdict(cloudRequests) {
    return cloudRequests === 0
        ? { status: 'PASS', detail: 'no Cloud STT request was made from any tab' }
        : { status: 'FAIL', detail: `${cloudRequests} Cloud STT request(s) were made during a Private take` };
}
/** After the take-over: the taking-over tab's take is completed, the displaced take was closed (saved), none is active. */
function takeOverRowsVerdict(rows, displacedId, takeOverId) {
    if (takeOverId === null)
        return { status: 'FAIL', detail: 'the taking-over tab bound no saved session' };
    if (displacedId === takeOverId)
        return { status: 'FAIL', detail: 'the displaced and taking-over tabs bound the same saved session instead of distinct takes' };
    const own = rows.find((r) => r.id === takeOverId);
    if (own?.status !== 'completed')
        return { status: 'FAIL', detail: 'the taking-over tab\'s take is not completed' };
    const orphans = rows.filter((r) => r.status === 'active').length;
    if (orphans > 0)
        return { status: 'FAIL', detail: `${orphans} session row(s) are still active after both tabs stopped` };
    if (displacedId === null)
        return { status: 'FAIL', detail: 'the displaced take said it was being saved, but no saved session was bound' };
    if (rows.find((r) => r.id === displacedId)?.status !== 'completed')
        return { status: 'FAIL', detail: 'the displaced take was not saved' };
    return { status: 'PASS', detail: 'both takes are saved and completed, and no take was left active' };
}
