/**
 * #1437 — THE PRACTICE LOOP JOURNEY VERDICT, AS A PURE FUNCTION.
 *
 * The live spec drives canonical Production and collects evidence; this decides whether that evidence
 * shows the journey PO's procedure requires. Splitting them is deliberate and load-bearing:
 *
 *   - a Production run proves the journey happened, but it cannot prove the CHECK would have caught a
 *     failure, because you cannot make Production fail on demand;
 *   - a pure verdict over a described journey can be driven through every failure shape in ordinary CI.
 *
 * #1424 taught this the hard way: eleven Codex findings against source-reading proofs, ended only by
 * observing the real request and making the judgement separately testable. Same shape here.
 *
 * EVIDENCE IS CONTENT-FREE BY CONSTRUCTION. The types below admit event names, closed enums, counts,
 * booleans and identifiers — there is no field for a transcript, a coaching phrase, a credential or a
 * provider body, so a spec cannot accidentally place one in an artifact.
 */

/** A terminal outcome for one review attempt. Exactly one is allowed per completed session. */
export type ReviewTerminalOutcome = 'rendered_success' | 'failed_safe' | 'refused_safe';

/** Telemetry the journey must show, by name only. */
export interface JourneyTelemetry {
    /** Ordered event names observed for THIS journey, deduplicated by occurrence, not by name. */
    readonly events: readonly string[];
    /** Completion stages the run reported as reached. */
    readonly stagesReached: readonly string[];
    /*
     * IDENTITY IS READ OUT OF THE OBSERVED ENVELOPES, never assigned from what the test expected
     * (Codex `3996845167`). Assigning the saved row's values made the comparisons tautologies.
     *
     * There is deliberately NO `boundSessionId`. No Practice Loop event carries a session id — the
     * allowlist keeps these events content-free, and a session id is user data. An earlier version of
     * this verdict demanded one, which could only ever be satisfied by copying the value in, which is
     * the tautology itself. The correlation spine the product actually publishes is
     * journey_id + attempt_id + candidate_id, so that is what is checked.
     */
    /** `candidate_id` from the envelope: the v2/v4/Moonshine identity, not the `private` facade. */
    readonly boundCandidateId: string | null;
    /** Distinct `attempt_id` values seen on this journey's review events. */
    readonly attemptIds: readonly string[];
    /** Distinct `journey_id` values seen on this journey's review events. */
    readonly journeyIds: readonly string[];
}

export interface PracticeLoopJourneyEvidence {
    /** The saved session's id, from the persistence boundary. */
    readonly savedSessionId: string | null;
    /** Whether the save reached a completed, persisted state. */
    readonly sessionSaved: boolean;
    /**
     * Coaching requests made STRICTLY AFTER persistence (Codex `3996845181`). A request that fired
     * before the save is not the automatic post-save behaviour, even when a review later renders, so it
     * is counted separately and refused rather than folded into the total.
     */
    readonly suggestionRequests: number;
    /** Coaching requests observed at or before persistence. Any is a defect. */
    readonly suggestionRequestsBeforeSave: number;
    /** True only if a human-equivalent action (button, retry, refresh) triggered generation. */
    readonly manualGenerationTriggered: boolean;
    /** The review surface's terminal state, as rendered. */
    readonly renderedPhraseCounts: { readonly whatWentWell: number; readonly whatToImprove: number };
    /** Terminal outcomes observed for this session's review. */
    readonly terminalOutcomes: readonly ReviewTerminalOutcome[];
    /**
     * CANDIDATE identity at the three boundaries the down-selection depends on (Codex `3996845174`).
     * `private` is a product facade shared by every candidate — v2, v4 and Moonshine all report it, and
     * so does `sessions.engine`. Comparing facades lets three different models agree, which is the one
     * thing #1432's attribution cannot survive. These must be candidate ids.
     */
    readonly modelIdentity: { readonly requested: string | null; readonly observed: string | null; readonly persisted: string | null };
    readonly telemetry: JourneyTelemetry;
}

/**
 * The documented journey, in order, for a rendered success (Codex `3996845178`).
 *
 * The first version required only requested → rendered, so a run that lost `session_saved`,
 * `_completed` or `_persisted` still passed while claiming the journey was reconstructable. It was not:
 * a funnel missing its middle cannot tell a delivered review from a lucky render.
 */
const REQUIRED_SUCCESS_SEQUENCE = [
    'session_saved',
    'practice_loop_review_requested',
    'practice_loop_review_completed',
    'practice_loop_review_persisted',
    'practice_loop_review_rendered',
] as const;

const STAGES_THAT_REQUIRE_A_RENDERED_REVIEW = ['practice_loop_ready', 'review_rendered'] as const;

/**
 * Every way the journey can fail PO's procedure, as a list. Empty means the journey is proven.
 *
 * Each check states the user-visible fact it protects, because a proof nobody can read is a proof
 * nobody maintains.
 */
export function practiceLoopJourneyFailures(evidence: PracticeLoopJourneyEvidence): string[] {
    const failures: string[] = [];

    // 1. A fresh authenticated session starts, completes and saves.
    if (!evidence.sessionSaved) failures.push('the session did not reach a saved state');
    if (!evidence.savedSessionId) failures.push('the saved session has no id, so nothing downstream can be bound to it');

    // 2. Suggestions start AUTOMATICALLY — no click, no retry, no refresh, and exactly one request.
    if (evidence.manualGenerationTriggered) {
        failures.push('generation was triggered manually; the contract is automatic on save');
    }
    if (evidence.suggestionRequestsBeforeSave > 0) {
        failures.push(`${evidence.suggestionRequestsBeforeSave} coaching request(s) fired at or before persistence; the contract is automatic AFTER a successful save`);
    }
    if (evidence.suggestionRequests === 0) {
        failures.push('no automatic suggestion request was made after the save');
    } else if (evidence.suggestionRequests > 1) {
        failures.push(`${evidence.suggestionRequests} suggestion requests were made; exactly one is allowed per uncached session`);
    }

    // 3. Exactly one valid 1+1 review becomes visible.
    const { whatWentWell, whatToImprove } = evidence.renderedPhraseCounts;
    if (whatWentWell !== 1 || whatToImprove !== 1) {
        failures.push(`the review rendered ${whatWentWell} strength(s) and ${whatToImprove} improvement(s); the contract is exactly one of each`);
    }

    // 4. Exactly one terminal outcome, and it must be a real one.
    if (evidence.terminalOutcomes.length === 0) {
        failures.push('the review reached no terminal outcome');
    } else if (evidence.terminalOutcomes.length > 1) {
        failures.push(`${evidence.terminalOutcomes.length} terminal outcomes were recorded; exactly one is allowed (${evidence.terminalOutcomes.join(', ')})`);
    }
    const [outcome] = evidence.terminalOutcomes;

    // 5. Telemetry correlates the journey, in order, and is bound to THIS session, attempt and candidate.
    const { events, stagesReached, boundCandidateId, attemptIds, journeyIds } = evidence.telemetry;
    if (outcome === 'rendered_success') {
        let cursor = -1;
        for (const required of REQUIRED_SUCCESS_SEQUENCE) {
            const at = events.indexOf(required, cursor + 1);
            if (at === -1) {
                failures.push(`telemetry is missing ${required} after the preceding step, so the journey cannot be reconstructed`);
                break;
            }
            cursor = at;
        }
        // A rendered review MUST claim both links. Requiring them only in the negative let a success
        // pass with neither, which is the other half of #1422's rule.
        for (const stage of STAGES_THAT_REQUIRE_A_RENDERED_REVIEW) {
            if (!stagesReached.includes(stage)) {
                failures.push(`${stage} was not marked despite a rendered review`);
            }
        }
    }

    /*
     * ONE attempt and ONE journey, read from the envelopes. Cross-take contamination is the failure
     * #1432's attribution cannot survive: two attempts inside one settled take means a row cannot be
     * ascribed to a candidate, however green the rest looks.
     */
    if (attemptIds.length > 1) {
        failures.push(`${attemptIds.length} distinct attempt ids appear on this journey's review events; a settled take has exactly one`);
    }
    if (journeyIds.length > 1) {
        failures.push(`${journeyIds.length} distinct journey ids appear on this journey's review events; a settled take has exactly one`);
    }
    if (outcome && attemptIds.length === 0) {
        failures.push('no attempt id is present on the review events, so the take cannot be attributed');
    }

    // 6. A review that did NOT render must not claim the completion stages.
    if (outcome !== 'rendered_success') {
        for (const stage of STAGES_THAT_REQUIRE_A_RENDERED_REVIEW) {
            if (stagesReached.includes(stage)) {
                failures.push(`${stage} was marked without a rendered review (outcome: ${outcome ?? 'none'})`);
            }
        }
    }

    // 7. Requested, observed and persisted model identity agree — the down-selection's whole basis.
    const { requested, observed, persisted } = evidence.modelIdentity;
    if (!requested || !observed || !persisted) {
        failures.push('model identity is incomplete at one of requested/observed/persisted');
    } else if (!(requested === observed && observed === persisted)) {
        failures.push(`model identity diverges: requested=${requested} observed=${observed} persisted=${persisted}`);
    }
    if (boundCandidateId && persisted && boundCandidateId !== persisted) {
        failures.push('telemetry is bound to a different candidate than the one persisted');
    }
    // The facade is not an identity. `private` agreeing with `private` proves nothing about which of
    // v2, v4 or Moonshine ran, and a down-selection built on that is unattributable.
    for (const [label, value] of [['requested', requested], ['observed', observed], ['persisted', persisted]] as const) {
        if (value && /^(private|browser|cloud|native)$/i.test(value)) {
            failures.push(`${label} model identity is the product facade "${value}", not a candidate id`);
        }
    }

    return failures;
}

/**
 * Guard against a proof that quietly carries content. Applied to anything the spec is about to write to
 * an artifact — a journey proof must be reconstructable without ever holding a transcript or a phrase.
 */
export function contentLeaks(serialized: string, forbidden: readonly string[]): string[] {
    return forbidden
        .map((value) => value.trim())
        .filter((value) => value.length >= 8 && serialized.includes(value));
}
