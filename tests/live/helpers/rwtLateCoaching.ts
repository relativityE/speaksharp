/**
 * AHT-01 Option 1 (PO decision, 2026-11-10, item 2) — LATE COACHING IS NEVER LOST.
 *
 * The interrupted take's coaching may still be in flight when the next take starts recording; the review then unmounts
 * without aborting it, and the server saves the answer to the interrupted take's own session. This row proves that end to
 * end: the session row holds a complete coaching pair within a bounded wait, AND that take's saved review (its own Analytics
 * detail, opened in a separate page) shows exactly that pair. Never inferred from a missing read: an unreadable row HOLDs;
 * an absent pair after the bound, a malformed pair, a review that does not show it, or a different pair FAIL.
 *
 * The receipt carries closed codes and timings only; the coaching text is compared in memory and forbidden in the receipt.
 */
import { classifySavedCoaching } from './coachingExternal';

export const LATE_COACHING_ROW = 'interrupted take coaching saved and shown in its saved review';

export interface LateCoachingSink {
    row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>): void;
    forbid(...values: string[]): void;
}

export interface LateCoachingDeps {
    /** The interrupted take's own `sessions.ai_suggestions` (owner- and id-scoped read). `ok: false` = the read failed. */
    readSaved: () => Promise<{ ok: true; value: unknown } | { ok: false }>;
    /** The pair that take's saved review renders, read in a separate page; null when it shows no complete pair. */
    openSavedReview: () => Promise<{ what_worked: string; what_to_try_next: string } | null>;
    same: (a: string, b: string) => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/** Provider budget (45 s) plus transport; the take's request started before the next take recorded. */
export const LATE_COACHING_WAIT_MS = 75_000;

export async function lateCoachingSavedRow(
    sink: LateCoachingSink,
    sessionKnown: boolean,
    deps: LateCoachingDeps,
    o: { waitMs?: number; pollMs?: number } = {},
): Promise<void> {
    if (!sessionKnown) {
        sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take has no saved session to check', { reason: 'no-session' });
        return;
    }
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const waitMs = o.waitMs ?? LATE_COACHING_WAIT_MS;
    const pollMs = o.pollMs ?? 2_000;
    const startedAt = now();
    let saved: { well: string; next: string } | null = null;
    for (;;) {
        const read = await deps.readSaved().catch(() => ({ ok: false as const }));
        if (!read.ok) {
            sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take\'s saved coaching could not be read', { reason: 'read-failed' });
            return;
        }
        const state = classifySavedCoaching(read.value);
        if (state.state === 'malformed') {
            sink.row(LATE_COACHING_ROW, 'FAIL', 'the interrupted take\'s session holds a malformed coaching value', { reason: 'malformed' });
            return;
        }
        if (state.state === 'pair') { saved = { well: state.well, next: state.next }; break; }
        if (now() - startedAt >= waitMs) {
            sink.row(LATE_COACHING_ROW, 'FAIL', `the interrupted take's coaching was not saved to its session within ${Math.round(waitMs / 1000)} s`,
                { reason: 'not-saved', waitedMs: now() - startedAt });
            return;
        }
        await sleep(pollMs);
    }
    sink.forbid(saved.well, saved.next);
    const savedAfterMs = now() - startedAt;
    let shown: { what_worked: string; what_to_try_next: string } | null;
    try {
        shown = await deps.openSavedReview();
    } catch {
        sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take\'s saved review could not be opened', { reason: 'review-unopened', savedAfterMs });
        return;
    }
    if (shown) sink.forbid(shown.what_worked, shown.what_to_try_next);
    if (!shown) {
        sink.row(LATE_COACHING_ROW, 'FAIL', 'the interrupted take\'s saved review does not show its saved coaching', { reason: 'not-shown', savedAfterMs });
        return;
    }
    const equal = deps.same(shown.what_worked, saved.well) && deps.same(shown.what_to_try_next, saved.next);
    sink.row(LATE_COACHING_ROW, equal ? 'PASS' : 'FAIL',
        equal ? 'the interrupted take\'s coaching is saved to its own session and its saved review shows exactly that pair'
            : 'the interrupted take\'s saved review shows coaching that differs from its saved pair',
        { reason: equal ? 'saved-and-shown' : 'shown-differs', savedAfterMs });
}
