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

/** A recovery notice, when shown, must match its state; an interrupted take never claims a saved transcript. */
export function recoveryNoticeVerdict(o: { shown: boolean; state: string | null; claimsSavedTranscript: boolean }): Verdict {
    if (!o.shown) return { status: 'PASS', detail: 'no recovery notice was shown, so nothing is claimed about the abandoned take' };
    if (o.state !== 'active_interrupted' && o.state !== 'finalized_pending_save') {
        return { status: 'FAIL', detail: `the recovery notice names an unknown state (${o.state ?? 'none'})` };
    }
    if (o.claimsSavedTranscript) return { status: 'FAIL', detail: 'the recovery notice claims a transcript was saved' };
    return { status: 'PASS', detail: 'the recovery notice matches the abandoned take and claims no saved transcript' };
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
