/**
 * AHT-08 report cleanup (board: "report cleanup (S)", same go as AHT-07, one report per run). Before this, the no-session
 * scenario deleted its disposable account and proved the report was RETAINED (`user_issue_reports.user_id` is ON DELETE SET
 * NULL), then left that report behind with no owner. It now runs AHT-07's race-safe steps unchanged (feedbackReportCleanup.ts:
 * capture by uid and key before the deletion, re-capture, delete by id with an exact count, independent zero-residue reads).
 *
 * AHT-08 has no write route or attempt ledger (it never faults a write), so whether a write's server outcome is known comes
 * from the submit's own observation instead. This is that mapping, pure:
 *  - never submitted: no write was made, so nothing is uncertain;
 *  - submitted, and the stored read bound exactly one row to exactly one observed key with every insert attributed: certain;
 *  - anything else after a Submit (no key seen, more than one key, an unattributed insert, no stored row read, or the submit
 *    threw before its read): the one write's outcome is unknown, so `zero residue` HOLDs instead of PASSing on a zero read.
 * Durable pre-send inventory (Sam, #1811 RETURN on d1487bdb item 2; 2026-11-14 bar 1): AHT-08 now records every write to
 * `user_issue_reports` in AHT-07's FeedbackRecoveryInventory (case tag `aht08`) BEFORE it is sent, behind the same
 * verified-store gate, so a lost runner's one report stays locatable by its key and recoverable by `recoverFromInventory`.
 * `noSessionWriteDecision` is the route's pre-send decision: the no-session journey makes ONE insert carrying ONE key (a same-key
 * Retry allowed), so a non-insert, an unkeyed or multi-key body, a second distinct key or a third attempt is aborted, never sent.
 * Whether a store that survives runner loss exists on the executor is a deployment fact; without one the journey HOLDs.
 * Case-only helper: nothing AHT-01 loads imports it.
 */
import type { WriteUncertainty } from './feedbackReportCleanup';
import { classifyInsertBody } from './feedbackDiagnosticRef';

/** What the submit's insert observer saw, snapshotted when the submit ends (also when it throws). */
export interface NoSessionInsertSnapshot { keys: readonly string[]; insertRequests: number; unattributedInserts: number }

export function noSessionWriteUncertainty(input: {
    submitted: boolean;
    inserts: NoSessionInsertSnapshot | null;
    reportId: string | null;
    storedRows: number | null;
}): WriteUncertainty {
    if (!input.submitted) return { pending: 0, uncertain: [] };
    const i = input.inserts;
    const certain = !!i && i.keys.length === 1 && i.unattributedInserts === 0 && i.insertRequests >= 1
        && typeof input.reportId === 'string' && input.reportId.length > 0 && input.storedRows === 1;
    return { pending: 0, uncertain: certain ? [] : [1] };
}

/** AHT-08's pre-send bounds: one insert, one key, at most one same-key Retry. */
export const NO_SESSION_ATTEMPT_CAP = 2;
export const NO_SESSION_KEY_CAP = 1;

/** The route's decision for one write, made at entry before anything is sent. Pure; `keysSeen` is the keys admitted so far. */
export function noSessionWriteDecision(input: { method: string; body: () => unknown; ordinal: number; keysSeen: readonly string[] }):
    { action: 'forward' | 'cap-abort'; keys: string[]; reason: 'not-an-insert' | 'attempt-cap' | 'unattributed-insert' | 'report-cap' | null } {
    if (input.method !== 'POST') return { action: 'cap-abort', keys: [], reason: 'not-an-insert' };
    let body: unknown;
    try { body = input.body(); } catch { body = undefined; }
    const { keys, unattributed } = classifyInsertBody(body);
    if (input.ordinal > NO_SESSION_ATTEMPT_CAP) return { action: 'cap-abort', keys, reason: 'attempt-cap' };
    if (unattributed > 0 || keys.length !== 1) return { action: 'cap-abort', keys, reason: 'unattributed-insert' };
    const distinct = new Set([...input.keysSeen, ...keys]);
    if (distinct.size > NO_SESSION_KEY_CAP) return { action: 'cap-abort', keys, reason: 'report-cap' };
    return { action: 'forward', keys, reason: null };
}
