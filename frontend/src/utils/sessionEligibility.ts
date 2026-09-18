/**
 * Session eligibility — whether a saved session may *influence* coaching or the next action.
 *
 * **This module reads the AUTHORITATIVE PERSISTED VERDICT. It does not re-derive the rules.**
 *
 * `product_release/PROGRESS_AND_NEXT_ACTION.md` §4 is the contract, and `record_progress_evaluation` is the
 * guarded writer that applies it, recording `eligible` plus `exclusion_reasons` on
 * `session_progress_evaluations` — status, spoken duration, word count, transcript presence, the
 * server-owned attribution authority, clarity evidence and complete engine/version/model identity, all
 * judged together at evaluation time.
 *
 * **Why this reads the verdict instead of listing the gates.** Earlier revisions of this file enumerated
 * the conditions by hand, and every review pass found another one missing: first the attribution source
 * (it used the client-writable advisory column instead of the `attrib_v1` authority), then
 * `no_clarity_evidence` and `engine_not_comparable`. A hand-maintained copy of a product rule drifts from
 * the rule by construction, and each drift is a session the product marks ineligible while Home quotes its
 * cached coaching back to the user as a lesson. One verdict, one source.
 *
 * **Fail closed.** No evaluation row means the session has not been judged — not that it passed. An
 * unreadable row is the same. Both yield no lesson, and the consumer falls back to the run's own facts.
 */

/** The row `record_progress_evaluation` writes per session, as this reader needs it. */
export interface PersistedEvaluationVerdict {
    /** The authoritative §4 decision. */
    eligible?: boolean | null;
    /** Why it was excluded, in the canonical vocabulary (`too_short`, `no_clarity_evidence`, …). */
    exclusion_reasons?: string[] | null;
}

/** Recorded when there is no evaluation row at all — unproven, never a pass. */
export const NOT_EVALUATED = 'not_evaluated';

/**
 * Why this session may not influence coaching, or `null` when the persisted verdict says it may.
 *
 * Returns the reason rather than a boolean, because both consumers — the Home resume band and the review
 * card's verdict guard — need it to word their own fallback.
 */
export function coachingIneligibilityReason(
    verdict: PersistedEvaluationVerdict | null | undefined,
): string | null {
    // Never judged, or unreadable ⇒ unproven ⇒ no lesson. Absence is not a pass.
    if (!verdict || typeof verdict.eligible !== 'boolean') return NOT_EVALUATED;
    if (verdict.eligible) return null;
    const reasons = Array.isArray(verdict.exclusion_reasons)
        ? verdict.exclusion_reasons.filter((r): r is string => typeof r === 'string' && r.trim() !== '')
        : [];
    // An excluded session with no recorded reason is still excluded.
    return reasons[0] ?? 'ineligible';
}

/** Convenience predicate over `coachingIneligibilityReason`. */
export function isEligibleForCoaching(verdict: PersistedEvaluationVerdict | null | undefined): boolean {
    return coachingIneligibilityReason(verdict) === null;
}
