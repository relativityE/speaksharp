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
    /** The session id the telemetry was bound to, as observed. */
    readonly boundSessionId: string | null;
    /** The model identity the telemetry was bound to, as observed. */
    readonly boundModel: string | null;
}

export interface PracticeLoopJourneyEvidence {
    /** The saved session's id, from the persistence boundary. */
    readonly savedSessionId: string | null;
    /** Whether the save reached a completed, persisted state. */
    readonly sessionSaved: boolean;
    /** Requests to the coaching endpoint, counted — not their bodies. */
    readonly suggestionRequests: number;
    /** True only if a human-equivalent action (button, retry, refresh) triggered generation. */
    readonly manualGenerationTriggered: boolean;
    /** The review surface's terminal state, as rendered. */
    readonly renderedPhraseCounts: { readonly whatWentWell: number; readonly whatToImprove: number };
    /** Terminal outcomes observed for this session's review. */
    readonly terminalOutcomes: readonly ReviewTerminalOutcome[];
    /** Model identity at the three boundaries the down-selection depends on. */
    readonly modelIdentity: { readonly requested: string | null; readonly observed: string | null; readonly persisted: string | null };
    readonly telemetry: JourneyTelemetry;
}

/** Events the journey must show, in this order, for a rendered success. */
const REQUIRED_SUCCESS_SEQUENCE = [
    'practice_loop_review_requested',
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

    // 5. Telemetry correlates the journey, in order, and is bound to THIS session and model.
    const { events, stagesReached, boundSessionId, boundModel } = evidence.telemetry;
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
    }
    if (evidence.savedSessionId && boundSessionId && boundSessionId !== evidence.savedSessionId) {
        failures.push('telemetry is bound to a different session than the one saved');
    }
    if (!boundSessionId) failures.push('telemetry is not bound to any session');

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
    if (boundModel && persisted && boundModel !== persisted) {
        failures.push('telemetry is bound to a different model than the one persisted');
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
