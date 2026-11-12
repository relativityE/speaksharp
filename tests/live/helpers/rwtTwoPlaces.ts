/**
 * AHT-11 (one account, two places) — the two case-only verdicts the fifteen-case front-run review (2026-11-10, F3/F4) found
 * PARTIAL in `rwt-abandon-and-two-tabs`. Free of Playwright so each rule is unit-tested with its failing controls; inputs are
 * content-free (booleans, closed enums, and the one row the service role read).
 *
 *  - same-browser-refused (F3): the second tab of the SAME browser must be refused by this browser's own tab lock, before any
 *    server lease is involved. Only the product's local wording counts; the account lease's copy on that tab is a FAIL.
 *  - takeover-fences-old-owner (F4): after the explicit take-over, the displaced take's own session row must carry the server's
 *    permanent fence: `recording_fenced_at` set and `recording_fenced_reason = 'displaced'` (#1476,
 *    backend/supabase/migrations/20260923120000_one_active_engine_per_account_1476.sql, `acquire_recording_lease`).
 *
 * Every row fails closed: an observation or read that could not be made is HOLD (or FAIL), never PASS.
 */
import { secondTabBlockedVerdict, type TabState, type Verdict } from './rwtAbandonTakeover';

/**
 * The product's own same-browser tab-lock wordings, exactly as the status line shows them (StatusNotificationBar strips the
 * leading emoji): the start hook's (useSessionLifecycle.ts, `isLockHeldByOther`) and the runtime controller's own
 * (SpeechRuntimeController.ts, lock not acquired). Never the #1476 account-lease copy (recordingLeasePolicy.ts).
 */
export const LOCAL_TAB_LOCK_WORDINGS = [
    'Active session in another tab. Switch to that tab to continue.',
    'Active session in another tab.',
] as const;
/** Whole-text match of either local wording: an element whose text is anything more or less is not this copy. */
export const LOCAL_TAB_LOCK_COPY = /^Active session in another tab\.(?: Switch to that tab to continue\.)?$/;

/** `true`/`false` when the copy was looked for; `null` when the look itself failed (a closed page, a lost document). */
export type CopySeen = boolean | null;

/** AHT-11 same-browser-refused: refused by THIS browser's tab lock (not the account lease), no engine, and tab A keeps recording. */
export function sameBrowserRefusedVerdict(o: { localCopyShown: CopySeen; leaseCopyShown: CopySeen; tabB: TabState; tabA: TabState }): Verdict {
    if (o.localCopyShown === null || o.leaseCopyShown === null) {
        return { status: 'HOLD', detail: 'the same-browser tab\'s refusal copy could not be read, so which lock refused it is unknown' };
    }
    if (o.leaseCopyShown) {
        return { status: 'FAIL', detail: 'the same-browser tab was refused by the server\'s account lease, not by this browser\'s own tab lock' };
    }
    if (!o.localCopyShown) return { status: 'FAIL', detail: 'the same-browser tab was not told the session is open in another tab' };
    const blocked = secondTabBlockedVerdict({ refusalCopyShown: true, tabB: o.tabB, tabA: o.tabA });
    return blocked.status === 'PASS'
        ? { status: 'PASS', detail: 'the same-browser tab was refused by this browser\'s own tab lock with no engine or microphone, and the first tab kept recording' }
        : blocked;
}

/** The displaced take's fence, as the service role reads it from `public.sessions` (the harness reads the same columns). */
export const DISPLACED_FENCE_COLUMNS = 'id,user_id,recording_fenced_at,recording_fenced_reason';
export type FenceRowRead = { state: 'observed'; rows: readonly unknown[] } | { state: 'unreadable'; reason: string };
/** The closed reasons the schema allows (`sessions_recording_fenced_reason_1476`); anything else is reported as `other`. */
export type FenceReasonSeen = 'displaced' | 'save_only' | 'other' | null;

export type FenceVerdict = Verdict & { evidence: { fenceRead: 'observed' | 'unreadable' | 'not-bound'; fencedAtSet: boolean | null; fencedReason: FenceReasonSeen } };

const fenceReason = (v: unknown): FenceReasonSeen => (v === null ? null : v === 'displaced' || v === 'save_only' ? v : 'other');

/**
 * AHT-11 takeover-fences-old-owner: the displaced take's OWN row on this account carries a real `recording_fenced_at`
 * timestamp and `recording_fenced_reason = 'displaced'`. Nothing in the schema ever clears the stamp (the fence trigger refuses
 * any change to it), so the read after both takes saved is valid. No bound displaced take, or no read: HOLD.
 */
export function displacedFenceVerdict(o: { read: FenceRowRead; displacedId: string | null; takeOverId: string | null; ownerId: string }): FenceVerdict {
    const ev = (fenceRead: FenceVerdict['evidence']['fenceRead'], fencedAtSet: boolean | null = null, fencedReason: FenceReasonSeen = null) =>
        ({ fenceRead, fencedAtSet, fencedReason });
    if (o.displacedId === null) {
        return { status: 'HOLD', detail: 'the displaced tab bound no saved session, so its server fence could not be read', evidence: ev('not-bound') };
    }
    if (o.displacedId === o.takeOverId) {
        return { status: 'FAIL', detail: 'the displaced and taking-over tabs bound the same session, so the old owner\'s row is not distinct', evidence: ev('not-bound') };
    }
    if (!o.ownerId) return { status: 'HOLD', detail: 'the run-owned account is unknown, so the fence row\'s owner cannot be checked', evidence: ev('not-bound') };
    if (o.read.state !== 'observed') {
        return { status: 'HOLD', detail: `the displaced take's server fence could not be read (${o.read.reason})`, evidence: ev('unreadable') };
    }
    if (o.read.rows.length === 0) {
        return { status: 'FAIL', detail: 'the displaced take\'s saved session has no row on the server', evidence: ev('observed') };
    }
    if (o.read.rows.length > 1) return { status: 'HOLD', detail: 'the fence read returned more than one row for one session id', evidence: ev('observed') };
    const row = o.read.rows[0];
    if (!row || typeof row !== 'object') return { status: 'HOLD', detail: 'the fence row could not be read as a row', evidence: ev('observed') };
    const r = row as Record<string, unknown>;
    if (r.id !== o.displacedId) return { status: 'HOLD', detail: 'the fence read did not return the displaced take\'s own row', evidence: ev('observed') };
    if (r.user_id !== o.ownerId) return { status: 'FAIL', detail: 'the displaced take\'s row does not belong to the run-owned account', evidence: ev('observed') };
    const at = r.recording_fenced_at;
    const reason = fenceReason(r.recording_fenced_reason);
    if (at === null || at === undefined) {
        if (!('recording_fenced_at' in r)) return { status: 'HOLD', detail: 'the fence row carried no recording_fenced_at column', evidence: ev('observed', null, reason) };
        return { status: 'FAIL', detail: 'the displaced take was never fenced on the server, so it could record again', evidence: ev('observed', false, reason) };
    }
    if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) {
        return { status: 'HOLD', detail: 'the fence stamp could not be read as a timestamp', evidence: ev('observed', null, reason) };
    }
    if (reason !== 'displaced') {
        return { status: 'FAIL', detail: `the displaced take is fenced, but not as displaced (${reason ?? 'no reason'})`, evidence: ev('observed', true, reason) };
    }
    return { status: 'PASS', detail: 'the displaced take\'s own row is permanently fenced on the server as displaced', evidence: ev('observed', true, reason) };
}
