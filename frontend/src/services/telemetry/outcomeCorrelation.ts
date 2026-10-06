/**
 * #1258 (#1563) — ONE pairing rule for outcome telemetry, used by BOTH the RWT receipt (events the page sent) and the
 * deployed readback (events PostHog received), so the two can never disagree about what correlates.
 *
 * A Practice-again press is paired with its arrival (or its linked attempt's terminal outcome), and a Share Feedback
 * attempt with its storage outcome, by: the SAME boot (a client-side navigation or a dialog never crosses a reload),
 * the SAME sequence number, and ORDER (the outcome comes after the item). Sequences are component- or dialog-local and
 * restart on remount, so an item's window ENDS at the next item in the same boot that reuses its number, and each
 * outcome is CONSUMED by at most one item (Codex r4196394199): one later outcome can never resolve two attempts.
 *
 * Inputs are closed enums and bounded integers only. An observed failure (wrong route, failed linked attempt,
 * `storage_failed`) is reported as such; a missing outcome is missing evidence — the callers map that to HOLD, never PASS.
 */
export interface CorrelationEvent {
    event: string;
    bootId?: string | null;
    props: Readonly<Record<string, unknown>>;
}

const NAVIGATING = new Set(['open_session', 'open_focus_setup', 'open_practice', 'accept_linked']);

/** Items of `kind` in order, each with the index range [start, end) in which its outcome may appear. */
function windows(events: readonly CorrelationEvent[], isItem: (e: CorrelationEvent) => boolean, seqKey: string) {
    const items = events.map((e, i) => ({ e, i })).filter(({ e }) => isItem(e));
    return items.map(({ e, i }, n) => {
        const next = items.slice(n + 1).find((x) => x.e.bootId === e.bootId && x.e.props[seqKey] === e.props[seqKey]);
        return { e, start: i + 1, end: next ? next.i : events.length };
    });
}

function takeFirst(events: readonly CorrelationEvent[], used: Set<number>, start: number, end: number,
    match: (x: CorrelationEvent) => boolean): CorrelationEvent | null {
    for (let k = start; k < end; k += 1) {
        if (!used.has(k) && match(events[k])) { used.add(k); return events[k]; }
    }
    return null;
}

export interface PracticeCorrelation {
    presses: number; arrived: number; mismatched: number; missing: number; linkedFailed: number; first: string;
}

export function correlatePracticePresses(events: readonly CorrelationEvent[]): PracticeCorrelation {
    const used = new Set<number>();
    const out: PracticeCorrelation = { presses: 0, arrived: 0, mismatched: 0, missing: 0, linkedFailed: 0, first: 'none' };
    const problem = (s: string) => { if (out.first === 'none') out.first = s; };
    const isPress = (e: CorrelationEvent) => e.event === 'saved_review_practice_action' && NAVIGATING.has(String(e.props.action));
    for (const { e, start, end } of windows(events, isPress, 'action_seq')) {
        out.presses += 1;
        const seq = e.props.action_seq;
        const same = (name: string) => (x: CorrelationEvent) => x.event === name && x.bootId === e.bootId && x.props.action_seq === seq;
        const arrival = takeFirst(events, used, start, end, same('saved_review_practice_arrived'));
        const attempt = takeFirst(events, used, start, end, same('saved_review_linked_attempt'));
        if (arrival) {
            if (arrival.props.route_class === e.props.intended_route) out.arrived += 1;
            else { out.mismatched += 1; problem(`seq ${String(seq)}: intended ${String(e.props.intended_route)}, arrived ${String(arrival.props.route_class)}`); }
        } else if (attempt && attempt.props.outcome !== 'ok') {
            out.linkedFailed += 1; problem(`seq ${String(seq)}: linked attempt ${String(attempt.props.outcome)}`);
        } else {
            out.missing += 1; problem(`seq ${String(seq)}: ${String(e.props.action)} (${String(e.props.link_state)}) never arrived`);
        }
    }
    return out;
}

export interface FeedbackCorrelation {
    attempts: number; stored: number; failed: number; unresolved: number; errorCategory: string; first: string;
}

export function correlateFeedbackAttempts(events: readonly CorrelationEvent[]): FeedbackCorrelation {
    const used = new Set<number>();
    const out: FeedbackCorrelation = { attempts: 0, stored: 0, failed: 0, unresolved: 0, errorCategory: 'none', first: 'none' };
    const isAttempt = (e: CorrelationEvent) => e.event === 'feedback_submit' && e.props.outcome === 'attempted';
    for (const { e, start, end } of windows(events, isAttempt, 'submit_seq')) {
        out.attempts += 1;
        const outcome = takeFirst(events, used, start, end, (x) => x.event === 'feedback_submit' && x.bootId === e.bootId
            && x.props.submit_seq === e.props.submit_seq && (x.props.outcome === 'storage_ok' || x.props.outcome === 'storage_failed'));
        if (!outcome) {
            out.unresolved += 1; if (out.first === 'none') out.first = `submit_seq ${String(e.props.submit_seq)}: no outcome`;
        } else if (outcome.props.outcome === 'storage_ok') {
            out.stored += 1;
        } else {
            out.failed += 1;
            if (out.errorCategory === 'none') out.errorCategory = String(outcome.props.error_category ?? 'unknown');
            if (out.first === 'none') out.first = `submit_seq ${String(e.props.submit_seq)}: storage_failed`;
        }
    }
    return out;
}
