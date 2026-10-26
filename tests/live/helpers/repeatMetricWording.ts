/**
 * G03 (#1548 A2, APP-G4; #1716 = #1697 leaf a4f7b939): on the saved review's own page, the repeat result names the
 * MEASURED delivery metric, never whether the coaching tip was followed.
 *
 * The expected copy is written here from the accepted product contract (#1697) and the server's derivation
 * (`advance_recommendation_attempt`, migration 20260731130000), not imported from `ProgressPanel`. Rows carry closed
 * codes and booleans only: no session or recommendation id, no shown text.
 *
 * Contract (Sam 1793009891.923779, Elon 1793010094.153359 + 1793010122.691439):
 * - the recommendation is bound by source session, formula version and account; the attempt by that recommendation and
 *   `practice_session_id` = this journey's saved repeat take, and it must be the newest (the panel renders the newest);
 * - without those bindings nothing is navigated (`loadSessionProgress` can reconcile) and the row is HOLD;
 * - "ran unlinked" needs this journey's one proceeding press to be an unlinked `direct` press; anything else is
 *   "linkage unverified";
 * - a missing or wrong line is FAIL only on the exact route with the panel settled in its eligible state.
 */

export const REPEAT_METRIC_ROW = 'repeat result names the measured metric';
/** `PROGRESS_FORMULA_VERSION` (buildProgressEvaluation.ts) that the recommendation must be bound to. */
export const PROGRESS_FORMULA = 'clarity_v1';

type Metric = 'filler_rate' | 'pace' | 'clear_delivery';
type Direction = 'decrease' | 'increase' | 'maintain';
const METRIC_LABEL: Readonly<Record<Metric, string>> = { filler_rate: 'Filler rate', pace: 'Pace', clear_delivery: 'Clear delivery' };
const DIRECTION_LABEL: Readonly<Record<Direction, string>> = { decrease: 'decrease toward', increase: 'increase toward', maintain: 'maintain at' };
export const SCOPE_LINE = 'This comparison measures delivery, not whether the coaching tip was followed.';
/** The pre-#1697 verdict on the tip. Its presence is a FAIL in the review-owned path. */
export const LEGACY_PHRASE = 'practiced direction';

const isMetric = (value: unknown): value is Metric => value === 'filler_rate' || value === 'pace' || value === 'clear_delivery';
const isDirection = (value: unknown): value is Direction => value === 'decrease' || value === 'increase' || value === 'maintain';
export const normalizeLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export interface RecommendationRow { targetMetric: unknown; targetDirection: unknown; targetValue: unknown; targetUnits: unknown }
export interface ValidRecommendation { metric: Metric; direction: Direction; value: number; units: string }

export function validRecommendation(row: RecommendationRow): ValidRecommendation | null {
    const { targetMetric, targetDirection, targetValue, targetUnits } = row;
    if (!isMetric(targetMetric) || !isDirection(targetDirection)) return null;
    if (typeof targetValue !== 'number' || !Number.isFinite(targetValue)) return null;
    if (typeof targetUnits !== 'string' || targetUnits.trim().length === 0) return null;
    return { metric: targetMetric, direction: targetDirection, value: targetValue, units: targetUnits };
}

/** The full target sentence; clear delivery shows its saved value rounded, the other metrics as stored. */
export function expectedTargetLine(rec: ValidRecommendation): string {
    const value = rec.metric === 'clear_delivery' ? Math.round(rec.value) : rec.value;
    return normalizeLine(`Separate delivery comparison: ${METRIC_LABEL[rec.metric]} (saved target: ${DIRECTION_LABEL[rec.direction]} ${value} ${rec.units}).`);
}

/**
 * The outcome sentence for a stored attempt. `moved` follows the server: decrease strictly lower, increase strictly
 * higher, maintain the same or higher.
 */
export function expectedOutcomeLine(rec: ValidRecommendation, attempt: { lifecycle: string; outcome: string | null }): string {
    const metric = METRIC_LABEL[rec.metric];
    if (attempt.lifecycle === 'pending') return 'Your linked repeat is pending.';
    if (attempt.outcome === 'not_comparable') return `${metric} could not be compared for this repeat.`;
    if (attempt.outcome !== 'moved' && attempt.outcome !== 'did_not_move') return 'The stored repeat was not completed.';
    const moved = attempt.outcome === 'moved';
    if (rec.direction === 'maintain') {
        return moved ? `${metric} stayed the same or increased compared with the original session.`
            : `${metric} decreased compared with the original session.`;
    }
    const comparative = rec.direction === 'decrease' ? 'lower' : 'higher';
    return moved ? `${metric} was ${comparative} on the repeat than in the original session.`
        : `${metric} was not ${comparative} on the repeat than in the original session.`;
}

/** A tapped event as the journey keeps it: the name and its closed outcome fields only. */
export interface PressEvent { event: string; fields?: Readonly<Record<string, string | number | boolean>> }
export type Linkage =
    | { kind: 'linked'; linkedAttempt: 'ok' | 'unobserved' }
    | { kind: 'unlinked' }
    /** `contradictory` is telemetry that disagrees with itself; missing telemetry is not. */
    | { kind: 'unverified'; reason: string; contradictory: boolean };

const PROCEEDING = new Set(['accept_linked', 'open_session', 'open_focus_setup', 'open_practice']);

/**
 * This journey's practice press, from the events inside its repeat window. The press handler sets `link_state` and
 * `action` together with `linked_repeat`, and `action_seq` binds the linked attempt to that press.
 */
export function pressLinkage(events: readonly PressEvent[]): Linkage {
    const presses = events.filter((e) => e.event === 'saved_review_practice_action' && PROCEEDING.has(String(e.fields?.action)));
    if (presses.length === 0) return { kind: 'unverified', reason: 'no_proceeding_press', contradictory: false };
    if (presses.length > 1) return { kind: 'unverified', reason: 'multiple_proceeding_presses', contradictory: true };
    const { action, link_state: linkState, action_seq: seq } = presses[0].fields ?? {};
    if (action === 'accept_linked' && linkState === 'linked') {
        const attempts = events.filter((e) => e.event === 'saved_review_linked_attempt' && e.fields?.action_seq === seq);
        if (attempts.length > 1) return { kind: 'unverified', reason: 'multiple_linked_attempts', contradictory: true };
        if (attempts.length === 1 && attempts[0].fields?.outcome !== 'ok') return { kind: 'unverified', reason: 'linked_attempt_not_ok', contradictory: true };
        return { kind: 'linked', linkedAttempt: attempts.length === 1 ? 'ok' : 'unobserved' };
    }
    if (action !== 'accept_linked' && linkState === 'direct') return { kind: 'unlinked' };
    return { kind: 'unverified', reason: 'press_state_inconsistent', contradictory: true };
}

/** One attempt row as read: its stored state, `accepted_at` (ordering only) and whether it is bound to this repeat. */
export interface ServerAttempt { lifecycle: unknown; outcome: unknown; acceptedAt: unknown; isThisRepeat: boolean }

/**
 * The resolved lifecycle → outcome pairs `advance_recommendation_attempt` writes (migration 20260731130000). Each
 * value is checked as a PAIR: an incoherent combination such as abandoned + moved is not judged.
 */
const RESOLVED_PAIRS: Readonly<Record<string, readonly string[]>> = {
    completed: ['moved', 'did_not_move'],
    not_comparable: ['not_comparable'],
    abandoned: ['not_completed'],
};

/**
 * The server rows, from two separate reads: `newest` is the recommendation's newest two attempts by accepted_at
 * (ordering and ties), and `boundCount` is how many attempts carry `practice_session_id` = this journey's saved
 * repeat take (read with limit 2, so 2 means "more than one"). No schema constraint makes that binding unique.
 */
export type ServerEvidence =
    | { kind: 'read'; recommendation: RecommendationRow | null; newest: readonly ServerAttempt[]; boundCount: number }
    | { kind: 'read_failed' };

export interface ExpectedLines { metric: Metric; direction: Direction; target: string; outcome: string }
export type Prerequisite = { observe: true; expected: ExpectedLines } | { observe: false; reason: string; detail: string };

const hold = (reason: string, detail: string): Prerequisite => ({ observe: false, reason, detail });

/** Whether the page may be opened at all. Every `observe: false` is a HOLD written without navigating. */
export function repeatMetricPrerequisites(server: ServerEvidence, linkage: Linkage): Prerequisite {
    if (server.kind === 'read_failed') return hold('server_read_failed', 'the recommendation or attempt could not be read');
    if (server.boundCount > 1) return hold('multiple_bound_attempts', 'more than one attempt is bound to this repeat take');
    if (server.boundCount < 1) {
        if (linkage.kind === 'unlinked') return hold('ran_unlinked', 'the repeat ran unlinked, so the review-owned comparison is not reachable');
        if (linkage.kind === 'unverified') return hold('linkage_unverified', `linkage unverified (${linkage.reason}) and no attempt is bound to this repeat`);
        return hold('repeat_unbound', 'no resolved attempt is bound to this journey\'s repeat take');
    }
    // A server row bound to this repeat take proves the link. Missing telemetry does not weaken it; telemetry that
    // contradicts itself, or an unlinked press, does.
    if (linkage.kind === 'unlinked') return hold('linkage_contradiction', 'the press ran unlinked but an attempt is bound to its repeat');
    if (linkage.kind === 'unverified' && linkage.contradictory) {
        return hold('linkage_contradiction', `the press telemetry is contradictory (${linkage.reason}) although an attempt is bound to its repeat`);
    }
    if (!server.recommendation) return hold('no_recommendation', 'no recommendation is bound to the first session');
    const rec = validRecommendation(server.recommendation);
    if (!rec) return hold('recommendation_invalid', 'the bound recommendation has no valid structured target');
    const [attempt, next] = server.newest;
    if (!attempt?.isThisRepeat) return hold('not_newest_attempt', 'another attempt is newer than this repeat\'s, so the panel would not show it');
    // The panel reads the newest by accepted_at with no tie-break: a tie leaves which row it shows undetermined.
    const acceptedAt = (a: ServerAttempt) => (typeof a.acceptedAt === 'string' ? Date.parse(a.acceptedAt) : Number.NaN);
    if (!Number.isFinite(acceptedAt(attempt))) return hold('attempt_order_unknown', 'the bound attempt has no readable accepted_at');
    if (next && !(acceptedAt(next) < acceptedAt(attempt))) {
        return hold('newest_attempt_ambiguous', 'another attempt ties with or is not older than this repeat\'s, so the panel\'s row is undetermined');
    }
    if (attempt.lifecycle === 'pending') return hold('repeat_unresolved', 'the bound attempt is still pending');
    const outcomes = typeof attempt.lifecycle === 'string' && Object.prototype.hasOwnProperty.call(RESOLVED_PAIRS, attempt.lifecycle)
        ? RESOLVED_PAIRS[attempt.lifecycle] : [];
    if (typeof attempt.lifecycle !== 'string' || typeof attempt.outcome !== 'string' || !outcomes.includes(attempt.outcome)) {
        return hold('attempt_state_unknown', 'the bound attempt has an unknown or incoherent lifecycle/outcome pair, so no copy is expected');
    }
    const resolved = { lifecycle: attempt.lifecycle, outcome: attempt.outcome };
    return { observe: true, expected: { metric: rec.metric, direction: rec.direction, target: expectedTargetLine(rec), outcome: expectedOutcomeLine(rec, resolved) } };
}

/**
 * What the page showed. `state` is `eligible` only on the exact route with the panel settled in its eligible branch;
 * the lines are the three attempt lines' text, or null when absent.
 */
export interface PanelObservation {
    state: 'eligible' | 'wrong_route' | 'not_settled' | 'error' | 'insufficient' | 'ineligible' | 'closed' | 'unreadable';
    target: string | null; outcome: string | null; scope: string | null; legacyPhrase: boolean;
    /**
     * Whether the page stayed open, on the route and settled eligible through every text read, and every read either
     * returned text or found the element absent. A read that failed, or a page that changed during the reads, is not
     * evidence that a line is missing.
     */
    readsStable: boolean;
}

export function repeatMetricWordingVerdict(expected: ExpectedLines, page: PanelObservation): {
    verdict: 'PASS' | 'FAIL' | 'HOLD'; detail: string; evidence: Record<string, string | boolean | null>;
} {
    const base = { metric: expected.metric, direction: expected.direction, panelState: page.state };
    if (page.state === 'eligible' && !page.readsStable) {
        return { verdict: 'HOLD', detail: 'the panel closed, moved or became unreadable while its lines were read', evidence: { ...base, panelState: 'unreadable' } };
    }
    if (page.state !== 'eligible') {
        return { verdict: 'HOLD', detail: `the review-owned comparison was not observed in its eligible state (${page.state})`, evidence: base };
    }
    const same = (shown: string | null, wanted: string) => shown !== null && normalizeLine(shown) === wanted;
    const evidence = {
        ...base,
        targetShown: page.target !== null, targetMatches: same(page.target, expected.target),
        outcomeShown: page.outcome !== null, outcomeMatches: same(page.outcome, expected.outcome),
        scopeShown: page.scope !== null, scopeMatches: same(page.scope, SCOPE_LINE),
        legacyPhrase: page.legacyPhrase,
    };
    if (evidence.targetMatches && evidence.outcomeMatches && evidence.scopeMatches && !page.legacyPhrase) {
        return { verdict: 'PASS', detail: 'the repeat result names the measured delivery metric, its saved target and the stored outcome', evidence };
    }
    return { verdict: 'FAIL', detail: 'a verified, settled comparison does not name the measured metric exactly as the contract requires', evidence };
}
