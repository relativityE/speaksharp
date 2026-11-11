import type { StructuredTarget } from '@/services/progress/progressPresentation';

/**
 * Outcome 4: the stored-repeat copy `RepeatOriginSection` shows on the repeat's own page, word for word the copy
 * `ProgressPanel` shows on the original session (#1548), so both pages describe one stored result the same way.
 *
 * AHT-01 hold: `ProgressPanel.tsx` is pinned by git blob in AHT-01's numeric check, which also extracts its
 * `TARGET_METRIC_LABELS` / `formatRepeatValues` from that file, so it stays byte-identical until that run is done.
 * These are therefore copies, not a move; `RepeatOriginSection.test.tsx` renders `ProgressPanel` and this block over the
 * same stored values and fails on any drift. Making `ProgressPanel` import from here is the follow-up after AHT-01.
 */
export const TARGET_METRIC_LABELS: Record<StructuredTarget['metric'], string> = {
    filler_rate: 'Filler rate', pace: 'Pace', clear_delivery: 'Clear delivery',
};

export type StoredOutcome = 'moved' | 'did_not_move' | 'not_comparable' | 'not_completed' | null | undefined;

/**
 * #1548 A2: when the saved review owns the next action, the person practised the AI tip, but the stored attempt measured
 * the recommendation's delivery metric. This copy names that metric and compares it with the original session in the
 * server's own terms (`20260731130000` derivation: decrease = strictly lower, increase = strictly higher, maintain =
 * same or higher). It never speaks of the practised direction, improvement or reaching a target.
 */
export function reviewOwnedOutcome(target: StructuredTarget, lifecycle: string, outcome: StoredOutcome): string {
    const metric = TARGET_METRIC_LABELS[target.metric];
    if (lifecycle === 'pending') return 'Your linked repeat is pending.';
    if (outcome === 'not_comparable') return `${metric} could not be compared for this repeat.`;
    if (outcome !== 'moved' && outcome !== 'did_not_move') return 'The stored repeat was not completed.';
    const moved = outcome === 'moved';
    if (target.direction === 'maintain') return moved
        ? `${metric} stayed the same or increased compared with the original session.`
        : `${metric} decreased compared with the original session.`;
    const comparative = target.direction === 'decrease' ? 'lower' : 'higher';
    return `${metric} was ${moved ? '' : 'not '}${comparative} on the repeat than in the original session.`;
}

/** Most decimals shown; a smaller stored difference is stated as below displayed precision instead. */
const MAX_REPEAT_VALUE_DIGITS = 6;

/**
 * #1548: the linked repeat's same-target values, original session → repeat, in the stored target units. Filler rate
 * starts at one decimal and pace/points at whole numbers; precision grows only until two different stored values no
 * longer print alike (Sam 1793055143.755569: 3/1000 vs 3/1001 of words). If they still print alike at the cap,
 * `belowPrecision` says so — the values are never rounded into a manufactured change or an implied "no change".
 * It states the values, never that the target was reached.
 */
export function formatRepeatValues(metric: StructuredTarget['metric'], before: number, after: number): { before: string; after: string; belowPrecision: boolean } {
    for (let digits = metric === 'filler_rate' ? 1 : 0; digits <= MAX_REPEAT_VALUE_DIGITS; digits += 1) {
        const pair = { before: before.toFixed(digits), after: after.toFixed(digits) };
        if (pair.before !== pair.after || before === after) return { ...pair, belowPrecision: false };
    }
    return { before: before.toFixed(MAX_REPEAT_VALUE_DIGITS), after: after.toFixed(MAX_REPEAT_VALUE_DIGITS), belowPrecision: true };
}

/** Outcome 4 (new, not from ProgressPanel): the original session's stored date and time, in the viewer's time zone ("17 Jan, 14:00"); null when unusable. */
export function formatOriginalSessionLabel(createdAt: string | null): string | null {
    if (!createdAt) return null;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return null;
    return created.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
