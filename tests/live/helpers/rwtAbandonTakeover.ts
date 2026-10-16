/**
 * RWT R2 (row 16) — the pure verdicts behind `rwt-abandon-and-two-tabs`: leaving a recording mid-take (in-app
 * navigation, or closing the tab), returning, and the same account's two-tab take-over (#1476). Free of Playwright so
 * every rule is unit-tested with its failing controls. Inputs are content-free: states, counts and booleans.
 */
export const ABANDON_SUITE = 'abandon-and-two-tabs';
export const ABANDON_VARIANTS = ['navigate-away', 'close-tab'] as const;
export type AbandonVariant = (typeof ABANDON_VARIANTS)[number];
export const TWO_TAB_SUITE = `${ABANDON_SUITE}-take-over`;

/** The product's own refusal copy (#1476 account lease; the pre-#1476 same-browser tab lock may answer first). */
export const BLOCKED_COPY = /A recording is active on .+\. Stop it there, or press Start again to take over here/;
/** Both wordings the product shows: the hook's longer line, and the controller's own status line. */
export const SAME_BROWSER_TAB_COPY = /Active session in another tab\./;
export const DISPLACED_COPY = 'This recording stopped because another device took over. What was recorded here is being saved.';
/**
 * #1258 (round 2, run 38876623812) — the product's in-app leave guard (App.tsx): while a take records on /session, a
 * same-origin link off /session is held and the person is asked this. OK stops and saves the take, then goes; Cancel stays.
 */
export const LEAVE_PROMPT_COPY = 'A recording is still active. Stop and save this session before leaving?';
/** The guard's own alert when Leave could not stop and save the take (App.tsx). */
export const STOP_FAILED_ALERT_COPY = 'We could not stop and save the recording yet. Please stop the session before leaving.';
/** The browser-side Cloud STT surfaces: its token function and its provider. Private must never reach either. */
export const CLOUD_STT_REQUEST = /assemblyai/i;

export type Verdict = { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string };
export type TabState = { runtimeState: string | null; recorderVisible: boolean; liveTracks: number };
export type RowFacts = { id: string; status: string | null };

const recordingNow = (t: TabState) => t.runtimeState === 'RECORDING' || t.recorderVisible || t.liveTracks > 0;

/** After leaving: nothing records, no recorder shows, and every microphone track has ended. */
export function releasedVerdict(t: TabState, where: string): Verdict {
    if (t.liveTracks > 0) return { status: 'FAIL', detail: `${where}: a microphone track is still live` };
    if (t.recorderVisible || t.runtimeState === 'RECORDING') return { status: 'FAIL', detail: `${where}: the page still shows or holds a recording` };
    return { status: 'PASS', detail: `${where}: nothing records and every microphone track has ended` };
}

/** The dialogs one navigate-away press met, counted (never their text). */
export type LeaveDialogs = { prompts: number; unexpectedDialogs: number; stopFailedAlerts: number };
export const newLeaveDialogs = (): LeaveDialogs => ({ prompts: 0, unexpectedDialogs: 0, stopFailedAlerts: 0 });

/**
 * #1258 (Sam 6218709582) — the ONE dialog the journey may accept: the first `confirm` carrying the product's exact leave
 * copy. Every other dialog — another copy, a repeat, a `prompt`, a `beforeunload`, any alert — is dismissed and counted,
 * so a wrong dialog can never be answered Leave. The guard's stop-failure alert is counted on its own.
 */
export function answerLeaveDialog(seen: LeaveDialogs, d: { type: string; message: string }): 'accept' | 'dismiss' {
    if (d.type === 'confirm' && d.message === LEAVE_PROMPT_COPY && seen.prompts === 0) {
        seen.prompts += 1;
        return 'accept';
    }
    if (d.type === 'alert' && d.message === STOP_FAILED_ALERT_COPY) seen.stopFailedAlerts += 1;
    else seen.unexpectedDialogs += 1;
    return 'dismiss';
}

/**
 * Navigate away: the product asks once before leaving a live recording, in its own words; the person answers Leave; no
 * other dialog appears; the guard reports no stop failure; and the page reaches where they chose. An unanswered prompt
 * is the person choosing Cancel, which keeps them on the recording, so the journey must answer it. Arrival is NOT
 * persistence evidence: whether the left take saved is read from the server (`priorTakeSaved`).
 */
export function leavePromptVerdict(o: LeaveDialogs & { arrived: boolean }): Verdict {
    if (o.unexpectedDialogs > 0) return { status: 'FAIL', detail: 'an unexpected dialog appeared (other copy, a repeat, or another kind); it was dismissed, never accepted' };
    if (o.prompts === 0) return { status: 'FAIL', detail: 'the product did not ask before leaving a live recording' };
    if (o.stopFailedAlerts > 0) return { status: 'FAIL', detail: 'answering Leave could not stop and save the recording' };
    if (!o.arrived) return { status: 'FAIL', detail: 'answering Leave did not reach the chosen page' };
    return { status: 'PASS', detail: 'the product asked once before leaving the live recording; Leave reached the chosen page' };
}

/**
 * Returning: the first Start either records, or refuses with the product's truthful copy and records on the person's
 * explicit second press. A refusal without that copy, or a take-over that never records, is a FAIL.
 */
export function returnStartVerdict(o: {
    firstPressRecorded: boolean; refusalCopyShown: boolean; secondPressRecorded: boolean | null;
}): Verdict {
    if (o.firstPressRecorded) return { status: 'PASS', detail: 'Start recorded on the first press after returning' };
    if (!o.refusalCopyShown) return { status: 'FAIL', detail: 'Start did not record and gave no truthful reason' };
    if (o.secondPressRecorded !== true) return { status: 'FAIL', detail: 'Start was refused truthfully, but the explicit second press did not record' };
    return { status: 'PASS', detail: 'Start was refused with the truthful reason, and the explicit second press recorded' };
}

/**
 * #1258 (Sam 6218709582 / 6219021013) — the recovery notice's own wordings (SessionPage `session-recovery-message`). Every
 * one of them says the take was NOT saved, in two different phrasings, so the unsaved claim is read from all of them.
 */
export const RECOVERY_NOTICE_COPY = Object.freeze({
    finalized_pending_save: 'Your last session finished but was not saved. Its measurements were kept on this device; no transcript was stored.',
    interrupted_partial: 'Your last session was interrupted before it was saved. No transcript was saved, and only partial measurements were captured.',
    interrupted: 'Your last session was interrupted before it was saved. No transcript was saved.',
});
const UNSAVED_MARKERS = ['No transcript was saved', 'was not saved', 'no transcript was stored'] as const;

/** What a recovery notice CLAIMS about the left take's transcript, from its text (classified, never stored). */
export function classifyRecoveryClaim(text: string): { claimsSavedTranscript: boolean; claimsUnsavedTranscript: boolean } {
    const claimsUnsavedTranscript = UNSAVED_MARKERS.some((m) => text.includes(m));
    return { claimsSavedTranscript: !claimsUnsavedTranscript && /transcript was saved/i.test(text), claimsUnsavedTranscript };
}

/**
 * Whether the take the person left was saved, as the SERVER holds it: a completed row that was not there before the
 * first Start. Observed, never inferred from arrival or the absence of an alert.
 */
export function priorTakeSaved(baseline: readonly RowFacts[], atReturn: readonly RowFacts[]): boolean {
    const before = new Set(baseline.map((r) => r.id));
    return atReturn.some((r) => !before.has(r.id) && r.status === 'completed');
}

/**
 * #1258 Codex P1 r4296551953 (Sam 6219377681) — navigate away's Leave is "Stop and save": the take the person left must
 * hold a completed row on the server, judged against the pre-first-Start baseline. Arrival, the absence of an alert and
 * the absence of a notice prove nothing about persistence, so this row FAILs on its own whenever the row is absent.
 */
export function leftTakeSavedVerdict(saved: boolean): Verdict {
    return saved
        ? { status: 'PASS', detail: 'the take the person left holds a completed row on the server' }
        : { status: 'FAIL', detail: 'Leave was answered, but the take the person left holds no completed row on the server' };
}

/**
 * A recovery notice, when shown, must name a known state and tell the truth about the left take (#1258 Sam 6218709582):
 * it may say a transcript was saved only when one was, and may say none was only when none was. Both variants pass the
 * OBSERVED persistence (Codex P1 r4296551963, Sam 6219377681 option a): server truth is authoritative, and a close-tab
 * take that did persist is not itself a defect.
 */
export function recoveryNoticeVerdict(o: {
    shown: boolean; state: string | null; claimsSavedTranscript: boolean; claimsUnsavedTranscript: boolean; priorTakeSaved: boolean;
}): Verdict {
    if (!o.shown) return { status: 'PASS', detail: 'no recovery notice was shown, so nothing is claimed about the left take' };
    if (o.state !== 'active_interrupted' && o.state !== 'finalized_pending_save') {
        return { status: 'FAIL', detail: `the recovery notice names an unknown state (${o.state ?? 'none'})` };
    }
    if (o.claimsSavedTranscript && !o.priorTakeSaved) return { status: 'FAIL', detail: 'the recovery notice claims a transcript was saved, but the left take was not' };
    if (o.claimsUnsavedTranscript && o.priorTakeSaved) return { status: 'FAIL', detail: 'the recovery notice says no transcript was saved, but the left take was saved' };
    return { status: 'PASS', detail: 'the recovery notice matches what the server holds for the left take' };
}

/**
 * The next take saves only itself: exactly one new row, completed, the one the page bound; and no row of the account is
 * left `active` (the abandoned take is closed, not orphaned).
 */
export function nextTakeOnlyItselfVerdict(before: readonly RowFacts[], after: readonly RowFacts[], nextId: string | null): Verdict {
    if (nextId === null) return { status: 'FAIL', detail: 'the next take bound no saved session' };
    const known = new Set(before.map((r) => r.id));
    const created = after.filter((r) => !known.has(r.id));
    if (created.length !== 1) return { status: 'FAIL', detail: `the next take created ${created.length} session rows` };
    if (created[0].id !== nextId) return { status: 'FAIL', detail: 'the new row is not the session the page bound' };
    if (created[0].status !== 'completed') return { status: 'FAIL', detail: `the next take is ${created[0].status ?? 'unreadable'}, not completed` };
    const orphans = after.filter((r) => r.status === 'active').length;
    if (orphans > 0) return { status: 'FAIL', detail: `${orphans} session row(s) are still active after the next take saved` };
    return { status: 'PASS', detail: 'the next take saved one new completed session and no take was left active' };
}

/** Two tabs: the second tab is refused truthfully, starts no engine, and the first tab keeps recording. */
export function secondTabBlockedVerdict(o: { refusalCopyShown: boolean; tabB: TabState; tabA: TabState }): Verdict {
    if (!o.refusalCopyShown) return { status: 'FAIL', detail: 'the second tab was not told why it could not record' };
    if (recordingNow(o.tabB)) return { status: 'FAIL', detail: 'the refused tab started recording or opened the microphone' };
    if (!recordingNow(o.tabA) || o.tabA.liveTracks === 0) return { status: 'FAIL', detail: 'the first tab stopped recording when the second was refused' };
    return { status: 'PASS', detail: 'the second tab was refused truthfully with no engine or microphone, and the first kept recording' };
}

/** The explicit take-over moves the ONE engine: B records, A stops, lets go of its microphone and says why. */
export function takeOverVerdict(o: { tabA: TabState; tabB: TabState; displacedCopyShown: boolean }): Verdict {
    if (!recordingNow(o.tabB) || o.tabB.liveTracks === 0) return { status: 'FAIL', detail: 'the take-over did not start recording in the second tab' };
    if (recordingNow(o.tabA)) return { status: 'FAIL', detail: 'the displaced tab is still recording or holds a live microphone track' };
    if (!o.displacedCopyShown) return { status: 'FAIL', detail: 'the displaced tab did not say another device took over' };
    return { status: 'PASS', detail: 'exactly one engine: the second tab records, and the displaced tab stopped and said why' };
}

/** Private never reaches Cloud STT, in any tab, at any step. */
export function noCloudVerdict(cloudRequests: number): Verdict {
    return cloudRequests === 0
        ? { status: 'PASS', detail: 'no Cloud STT request was made from any tab' }
        : { status: 'FAIL', detail: `${cloudRequests} Cloud STT request(s) were made during a Private take` };
}

/** After the take-over: the taking-over tab's take is completed, the displaced take was closed (saved), none is active. */
export function takeOverRowsVerdict(rows: readonly RowFacts[], displacedId: string | null, takeOverId: string | null): Verdict {
    if (takeOverId === null) return { status: 'FAIL', detail: 'the taking-over tab bound no saved session' };
    const own = rows.find((r) => r.id === takeOverId);
    if (own?.status !== 'completed') return { status: 'FAIL', detail: 'the taking-over tab\'s take is not completed' };
    const orphans = rows.filter((r) => r.status === 'active').length;
    if (orphans > 0) return { status: 'FAIL', detail: `${orphans} session row(s) are still active after both tabs stopped` };
    if (displacedId === null) return { status: 'FAIL', detail: 'the displaced take said it was being saved, but no saved session was bound' };
    if (rows.find((r) => r.id === displacedId)?.status !== 'completed') return { status: 'FAIL', detail: 'the displaced take was not saved' };
    return { status: 'PASS', detail: 'both takes are saved and completed, and no take was left active' };
}
