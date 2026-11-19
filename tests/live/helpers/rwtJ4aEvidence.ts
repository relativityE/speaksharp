/**
 * J4.a (AHT-05, save request lost) — the evidence check Sam asked for on Nov 18 ahead of the J4.a pilot:
 *  1. the first save request never reached the server: it was stopped in the browser with no server answer, and the take's
 *     own row is still the active Start session, untouched by any completion (`j4aRequestNeverReachedVerdict`);
 *  2. Retry Save then produced exactly one saved take, for the run-owned account and no other (`j4aOneSaveForAccountVerdict`).
 *
 * J4.b (AHT-06, response lost) is a different fault: there the server DID save and only the answer was lost. These verdicts
 * judge J4.a only and never pass J4.b evidence, so the two legs keep separate verdicts. Pure, content-free: ids, states and
 * counts only; rows stay in memory, and no value reaches a receipt.
 */
import { isDeepStrictEqual } from 'node:util';
import type { SavedRow } from './rwtSaveRetryAttempts';
import { CONSENT_MODES, SAVE_RETRY_CONSENT_MODE, privacyChoiceVerdict, type ChoiceRead, type ConsentMode, type PrivacyBuild } from './rwtPracticeConsent';

export type J4aVerdict = { status: 'PASS' | 'FAIL' | 'HOLD'; reason: string; detail: string };

/**
 * Columns only `complete_session_v2` writes. `duration` is left out on purpose: `heartbeat_session` advances it while the
 * take is active, so a changed duration says nothing about the completion.
 */
export const COMPLETION_WRITTEN_COLUMNS = [
    'user_id', 'status', 'idempotency_key', 'lease_id', 'status_reason', 'total_words', 'clarity_score', 'wpm', 'filler_counts',
    'pause_metrics', 'next_action_signal', 'transcript', 'transcript_state',
] as const;

export interface J4aFaultObservation {
    /** The route stopped exactly one completion request. */
    dropped: boolean;
    /** The route forwarded the stopped request to the server (`route.fetch`). Never true for J4.a; true is J4.b's fault. */
    forwarded: boolean;
    /** The HTTP status the server gave the stopped request, if it was forwarded. */
    droppedStatus: number | null;
    /** `p_session_id` of the stopped request. */
    droppedSessionId: string | null;
    /** The take's own row, read while it was still active (the Start session). */
    startRow: SavedRow | null;
    /** Every session row of the run-owned account, read after the fault and before Retry Save. */
    rowsBeforeRetry: readonly SavedRow[] | null;
}

/** Pure. PASS only when the stopped request left the server's copy of the take exactly as Start made it. */
export function j4aRequestNeverReachedVerdict(o: J4aFaultObservation): J4aVerdict {
    const hold = (reason: string, detail: string): J4aVerdict => ({ status: 'HOLD', reason, detail });
    const fail = (reason: string, detail: string): J4aVerdict => ({ status: 'FAIL', reason, detail });
    if (!o.dropped) return hold('fault_not_exercised', 'no save request was stopped, so the lost-request case did not happen');
    if (o.forwarded || o.droppedStatus !== null) {
        return fail('request_reached_server', 'the stopped save request was sent to the server, so this is the lost-response case (J4.b), not J4.a');
    }
    if (!o.startRow) return hold('start_row_unread', 'the take\'s row was not read while it was active, so the server\'s copy cannot be compared');
    if (o.droppedSessionId === null || o.droppedSessionId !== o.startRow.id) {
        return fail('fault_on_another_session', 'the stopped save request did not name the take\'s own session');
    }
    if (o.rowsBeforeRetry === null) return hold('rows_unread', 'the account\'s rows could not be read after the fault');
    if (o.rowsBeforeRetry.some((r) => r.status === 'completed')) {
        return fail('saved_before_retry', 'a take was saved although its save request was stopped in the browser');
    }
    if (o.rowsBeforeRetry.length !== 1) return fail('unexpected_rows', `${o.rowsBeforeRetry.length} session rows exist for one unsaved take`);
    const row = o.rowsBeforeRetry[0];
    if (row.id !== o.startRow.id || row.status !== 'active') return fail('take_not_active', 'the take\'s row is no longer the active Start session');
    const changed = COMPLETION_WRITTEN_COLUMNS.filter((c) => !isDeepStrictEqual(row[c], o.startRow![c]));
    if (changed.length > 0) return fail('row_changed_before_retry', `the server changed ${changed.join(', ')} although the save request never left the browser`);
    return { status: 'PASS', reason: 'never_reached', detail: 'the save request was stopped in the browser with no server answer, and the take stayed the active Start session, unchanged' };
}

/** A session id is a UUID; anything else cannot correlate the take across reads. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columns the owner read and both cross-account reads must agree on for the one saved row (Sam, Nov 18). */
export const SAVED_ROW_AGREEMENT_COLUMNS = ['id', ...COMPLETION_WRITTEN_COLUMNS, 'duration'] as const;

export interface J4aSaveObservation {
    /** The run-owned account the journey created. */
    ownerId: string | null;
    /** The take's session (the one the stopped request named). */
    takeSessionId: string | null;
    /** The idempotency key the take's Start row carried. Missing or malformed correlation HOLDs (Sam, Nov 18). */
    startIdempotencyKey: unknown;
    /** The session the page bound after Retry Save (`data-session-persisted-id`). */
    savedId: string | null;
    /** Every session row of the run-owned account after Retry Save. */
    ownerRows: readonly SavedRow[] | null;
    /** Every session row in ANY account with the take's id (admin read, no user filter). */
    anyAccountById: readonly SavedRow[] | null;
    /** Every session row in ANY account with the Start row's idempotency key (admin read, no user filter). */
    anyAccountByKey: readonly SavedRow[] | null;
}

/**
 * Pure. PASS only when exactly one saved take exists, it is this account's take, no other account holds it, and the owner
 * read, the read by id and the read by idempotency key all return that same row, column for column. A missing or malformed
 * session id or Start key HOLDs: a read by id alone cannot see a duplicate saved under another id or account.
 */
export function j4aOneSaveForAccountVerdict(o: J4aSaveObservation): J4aVerdict {
    const hold = (reason: string, detail: string): J4aVerdict => ({ status: 'HOLD', reason, detail });
    const fail = (reason: string, detail: string): J4aVerdict => ({ status: 'FAIL', reason, detail });
    if (!o.ownerId) return hold('owner_unknown', 'the run-owned account is unknown, so the save cannot be bound to it');
    if (!o.takeSessionId) return hold('take_unknown', 'the take\'s session is unknown');
    if (!SESSION_ID.test(o.takeSessionId) || typeof o.startIdempotencyKey !== 'string' || o.startIdempotencyKey.trim() === '') {
        return hold('correlation_missing', 'the take\'s session id or its Start idempotency key is missing or malformed, so a duplicate under another id or account cannot be ruled out');
    }
    if (o.ownerRows === null || o.anyAccountById === null || o.anyAccountByKey === null) return hold('rows_unread', 'the saved rows could not be read');
    const anyAccount = [...new Map([...o.anyAccountById, ...o.anyAccountByKey].map((r) => [String(r.id), r])).values()];
    if (anyAccount.some((r) => r.user_id !== o.ownerId)) return fail('wrong_account', 'the take was saved under another account');
    if (o.ownerRows.some((r) => r.user_id !== o.ownerId)) return fail('wrong_account', 'a row read for this account belongs to another account');
    const saved = o.ownerRows.filter((r) => r.status === 'completed');
    if (saved.length === 0) return fail('zero_saves', 'Retry Save left no saved take for this account');
    if (saved.length > 1 || o.ownerRows.length > 1 || anyAccount.length > 1 || o.anyAccountById.length > 1 || o.anyAccountByKey.length > 1) {
        return fail('duplicate_saves', `${saved.length} saved and ${o.ownerRows.length} total rows for one take; exactly one is allowed`);
    }
    if (saved[0].id !== o.takeSessionId) return fail('another_session_saved', 'the saved take is not the session whose save was lost');
    if (o.savedId !== o.takeSessionId) return fail('page_bound_other', 'the page bound a different session than the one that was saved');
    if (o.anyAccountById.length !== 1 || o.anyAccountById[0].id !== o.takeSessionId
        || o.anyAccountByKey.length !== 1 || o.anyAccountByKey[0].id !== o.takeSessionId) {
        return fail('cross_account_read_mismatch', 'the reads across all accounts, by id and by the Start key, did not each find exactly this take');
    }
    const differs = SAVED_ROW_AGREEMENT_COLUMNS.filter((c) => !isDeepStrictEqual(o.anyAccountById![0][c], saved[0][c])
        || !isDeepStrictEqual(o.anyAccountByKey![0][c], saved[0][c]));
    if (differs.length > 0) return fail('readbacks_disagree', `the owner and cross-account reads disagree on ${differs.join(', ')}`);
    return { status: 'PASS', reason: 'one_save_this_account', detail: 'Retry Save left exactly one saved take, the lost one, under this account and no other; the owner read and both cross-account reads agree on it' };
}

/**
 * J4.a's required `practice privacy choice` row (Sam, Nov 19: one take, coaching off, on the post-#1835 build only). PASS only
 * on a post-#1835 build, for the fixed Save: Yes / Coaching: No mode, with the owner's own server row read back right before
 * Start as exactly that choice. A pre-#1835 build has no privacy prompt, so J4.a cannot run there: the row FAILs and the run
 * stops before any take. An unknown build or an unreadable readback HOLDs; any other mismatch FAILs. Never PASS without the
 * exact readback.
 */
export function saveRetryPrivacyVerdict(o: { build: PrivacyBuild; mode: ConsentMode | null; readback: ChoiceRead | null; ownerId: string | null }): J4aVerdict {
    if (o.build === 'predates_1835') return { status: 'FAIL', reason: 'legacy_build', detail: 'the build predates #1835 and shows no privacy prompt; J4.a runs only on the post-#1835 build' };
    if (o.build !== 'includes_1835') return { status: 'HOLD', reason: 'build_unknown', detail: 'the build\'s #1835 state is unknown, so the owner consent cannot be proven' };
    if (o.mode !== SAVE_RETRY_CONSENT_MODE) return { status: 'FAIL', reason: 'wrong_mode', detail: 'the run did not choose Save: Yes, Coaching: No' };
    if (!o.ownerId || o.readback === null) return { status: 'HOLD', reason: 'readback_missing', detail: 'the owner\'s consent was not read back before Start' };
    const v = privacyChoiceVerdict(o.readback, o.ownerId, CONSENT_MODES[SAVE_RETRY_CONSENT_MODE]);
    if (v.verdict === 'PASS') return { status: 'PASS', reason: 'save_yes_coaching_no', detail: 'this run\'s own account chose Save: Yes, Coaching: No in the Practice prompt, read back from the server right before Start' };
    if (v.reason === 'unreadable') return { status: 'HOLD', reason: 'readback_unreadable', detail: 'the owner\'s consent row could not be read before Start' };
    return { status: 'FAIL', reason: `readback_${v.reason}`, detail: `the owner's consent row read back before Start is ${v.reason}` };
}

/**
 * J4.a's bounds (Sam, Nov 19; PO's approved run: one take, coaching off). The journey records ONE take: the faulted one, started
 * by exactly one Start press (`mic-download` on a cold model, else `mic-start`), and stops right after the Retry Save readback,
 * so `verdict-practice-again` is never pressed. Coaching is off, so zero coaching requests are allowed. J4.b keeps its own
 * two-take budget and is not bounded here.
 */
export const J4A_START_PRESS_BUDGET: Readonly<{ total: number; perControl: Readonly<Record<string, number>> }> = Object.freeze({
    total: 1, perControl: Object.freeze({ 'mic-download': 1, 'mic-start': 1 }),
});
export const J4A_COACHING_MAXIMUM = 0;

/**
 * Pure. J4.a stops after the Retry readback, so at the final boundary (every owned page closed) the account holds exactly the
 * one saved take and no completion request was ever sent for any other session. A second take, started or saved, FAILs.
 */
export function j4aNoSecondTakeVerdict(o: {
    takeSessionId: string | null; ownerRows: readonly SavedRow[] | null; attemptSessionIds: readonly (string | null)[];
}): J4aVerdict {
    if (!o.takeSessionId) return { status: 'HOLD', reason: 'take_unknown', detail: 'the take\'s session is unknown' };
    if (o.ownerRows === null) return { status: 'HOLD', reason: 'rows_unread', detail: 'the account\'s rows could not be read at the final boundary' };
    const others = o.ownerRows.filter((r) => r.id !== o.takeSessionId);
    if (others.length > 0) return { status: 'FAIL', reason: 'second_take', detail: `${others.length} more session row(s) exist beside the one take` };
    if (o.ownerRows.length !== 1 || o.ownerRows[0].status !== 'completed') {
        return { status: 'FAIL', reason: 'take_not_saved', detail: 'the one take is not saved at the final boundary' };
    }
    if (o.attemptSessionIds.some((id) => id !== o.takeSessionId)) {
        return { status: 'FAIL', reason: 'second_take_save', detail: 'a save request was sent for a session other than the one take' };
    }
    return { status: 'PASS', reason: 'one_take', detail: 'the journey stopped after the Retry readback: one saved take and no other session' };
}

/**
 * Pure. After the run-owned account is deleted, the owner's own `practice_privacy_choices` row must be gone too (Sam, Nov 19).
 * PASS only on a COUNTED zero for the exact owner id, after a verified deletion of an owner whose choice was verified. A row
 * left behind FAILs; an unread, uncounted or unbound read HOLDs.
 */
export function j4aPrivacyCleanupVerdict(o: { ownerId: string | null; choiceVerified: boolean; accountDeleted: boolean; count: unknown; readError: boolean }): J4aVerdict {
    if (!o.ownerId || !o.choiceVerified) return { status: 'HOLD', reason: 'choice_unverified', detail: 'no verified privacy choice for this owner, so its cleanup cannot be proven' };
    if (!o.accountDeleted) return { status: 'HOLD', reason: 'account_not_deleted', detail: 'the run-owned account was not deleted, so the privacy row was not checked' };
    if (o.readError) return { status: 'HOLD', reason: 'residue_unread', detail: 'the privacy choice residue read failed' };
    if (!Number.isSafeInteger(o.count) || (o.count as number) < 0) return { status: 'HOLD', reason: 'residue_uncounted', detail: 'the privacy choice residue read returned no counted integer' };
    if (o.count !== 0) return { status: 'FAIL', reason: 'privacy_row_left', detail: 'the owner\'s privacy choice row survived the account deletion' };
    return { status: 'PASS', reason: 'privacy_row_gone', detail: 'the owner\'s privacy choice row is gone after the account deletion (counted zero)' };
}

/**
 * J4.a coaching block (Sam, Nov 19, on c558f4c): counting coaching requests is not enough, because a counted request has
 * already reached the provider. J4.a routes the coaching endpoint for its WHOLE browser context (every tab) before the first
 * navigation and aborts every request there, so an unexpected call never leaves the browser and the run fails on it.
 */
export const J4A_COACHING_ROUTE = '**/functions/v1/get-ai-suggestions**';

/** The smallest part of a Playwright route the guard uses: it only ever aborts. */
export interface AbortableRoute { abort(errorCode?: string): Promise<void> }

export interface J4aCoachingGuard {
    /** Set once the route is registered on the context; a guard that never armed proves nothing. */
    armed: boolean;
    /** Requests stopped in the browser. Each one is an unexpected coaching call that did NOT reach the provider. */
    blocked: number;
    handler(route: AbortableRoute): Promise<void>;
}

export function j4aCoachingGuard(): J4aCoachingGuard {
    const guard: J4aCoachingGuard = {
        armed: false,
        blocked: 0,
        async handler(route) {
            guard.blocked += 1;
            await route.abort('blockedbyclient');
        },
    };
    return guard;
}

/**
 * Pure. Judged only at the final boundary (Sam, Nov 19 on 2b57bd47): the block count is read AFTER every owned page is proven
 * closed (`HarnessParityTap.ownedPagesClosedAt`), so a coaching attempt made between the in-journey checks and the page close
 * is still counted, never missed. Any blocked attempt FAILs, closed or not (it is proof the page asked for coaching with
 * coaching off). With none counted, an unproven closure HOLDs: a page still open could yet ask, so zero is not yet proof.
 */
export function j4aCoachingBlockedVerdict(o: { armed: boolean; blocked: number; pagesClosedAt: number | null }): J4aVerdict {
    if (!o.armed) return { status: 'HOLD', reason: 'block_not_armed', detail: 'the coaching block was not in place before the first page, so nothing is proved' };
    if (!Number.isSafeInteger(o.blocked) || o.blocked < 0) return { status: 'HOLD', reason: 'block_uncounted', detail: 'the coaching block returned no counted integer' };
    if (o.blocked > 0) return { status: 'FAIL', reason: 'coaching_requested', detail: 'the page asked for coaching with coaching off; the block stopped it in the browser, so it never reached the provider' };
    if (o.pagesClosedAt === null || !Number.isFinite(o.pagesClosedAt)) {
        return { status: 'HOLD', reason: 'closure_unproved', detail: 'the journey\'s pages were not proven closed, so a later coaching request cannot be ruled out' };
    }
    return { status: 'PASS', reason: 'none_requested', detail: 'the coaching block was in place for the whole run, every page was proven closed, and the page asked for no coaching' };
}

/** The receipt surface the J4.a row needs (an `RwtReceipt`, or a step's `aliveReceipt`). */
export interface J4aRowSink { row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>): void }
export const J4A_COACHING_BLOCKED_ROW = 'J4.a: no coaching request left the browser';

/**
 * The spec's one writer of the required J4.a coaching row, called at the final boundary right after `owned pages closed`.
 * `pagesClosedAt` is `HarnessParityTap.ownedPagesClosedAt`, read at that moment. Shared with the real-browser control
 * (tests/e2e/rwt-j4a-coaching-close.e2e.spec.ts), so the control exercises exactly what the journey writes.
 */
export function j4aCoachingBlockedRow(sink: J4aRowSink, step: typeof J4A_COACHING_BLOCKED_ROW, guard: Pick<J4aCoachingGuard, 'armed' | 'blocked'>, pagesClosedAt: number | null): J4aVerdict {
    // The spec names the row literally so the save-retry row-coverage guard sees it written; any other name fails closed.
    if (step !== J4A_COACHING_BLOCKED_ROW) throw new Error(`J4.a coaching row must be named '${J4A_COACHING_BLOCKED_ROW}' (fail closed)`);
    const v = j4aCoachingBlockedVerdict({ armed: guard.armed, blocked: guard.blocked, pagesClosedAt });
    sink.row(J4A_COACHING_BLOCKED_ROW, v.status, v.detail,
        { reason: v.reason, armed: guard.armed, blocked: guard.blocked, pagesClosedProved: pagesClosedAt !== null });
    return v;
}
