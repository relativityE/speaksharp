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
 * Case-only helper: nothing AHT-01 loads imports it.
 */
import type { WriteUncertainty } from './feedbackReportCleanup';

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
