/**
 * #1258 PR 4 (Browser PM 6050746477) — which saved row the restored session view may show.
 *
 * The id alone is not ownership: a row can sit in the query cache from an earlier account. RLS protects a fresh read,
 * not a cached one, so the row is shown only when it is the requested id AND belongs to the signed-in user. An unknown
 * owner (auth not settled) shows nothing yet.
 */
import type { PracticeSession } from '@/types/session';

export function restorableSession(
    row: PracticeSession | null | undefined,
    restoreId: string | null,
    ownerId: string | null | undefined,
): PracticeSession | null {
    if (!row || !restoreId || !ownerId) return null;
    return row.id === restoreId && row.user_id === ownerId ? row : null;
}

/** The row is settled and cannot be shown to this owner — missing, someone else's, or a different id. */
export function restoreRefused(
    row: PracticeSession | null | undefined,
    restoreId: string,
    ownerId: string | null | undefined,
): boolean {
    if (!ownerId) return false; // not settled yet: wait, never decide
    return !row || row.id !== restoreId || row.user_id !== ownerId;
}
