/**
 * Eligibility reads the AUTHORITATIVE PERSISTED VERDICT (`session_progress_evaluations.eligible`) written
 * by `record_progress_evaluation`. It does not re-derive PROGRESS_AND_NEXT_ACTION §4.
 *
 * Why that matters, and what these pin: three successive reviews found a different gate missing from a
 * hand-written copy of the rule — the attribution source, then `no_clarity_evidence`, then
 * `engine_not_comparable`. Each drift is a session the product marks ineligible whose cached coaching Home
 * would still quote back to the user as their lesson. So the casualties here are about **absence being
 * fail-closed** and about **never second-guessing the verdict**, not about any particular threshold.
 */
import { describe, it, expect } from 'vitest';
import { coachingIneligibilityReason, isEligibleForCoaching, NOT_EVALUATED } from '../sessionEligibility';

describe('coachingIneligibilityReason — the persisted verdict decides', () => {
    it('an eligible verdict qualifies the session', () => {
        expect(coachingIneligibilityReason({ eligible: true, exclusion_reasons: [] })).toBeNull();
        expect(isEligibleForCoaching({ eligible: true, exclusion_reasons: [] })).toBe(true);
    });

    it('CASUALTY: no evaluation row means UNPROVEN, never a pass', () => {
        // The session has not been judged yet. Absence of a verdict is not permission.
        for (const verdict of [null, undefined, {}, { exclusion_reasons: [] }]) {
            expect(coachingIneligibilityReason(verdict)).toBe(NOT_EVALUATED);
        }
        expect(isEligibleForCoaching(null)).toBe(false);
    });

    it('CASUALTY: a non-boolean `eligible` is not truthy-coerced', () => {
        // A malformed row must fail closed rather than pass on a truthy string.
        for (const eligible of ['true', 1, {}, []] as unknown[]) {
            expect(coachingIneligibilityReason({ eligible } as { eligible?: boolean | null })).toBe(NOT_EVALUATED);
        }
    });

    it('reports the recorded exclusion reason, so each consumer can word its own fallback', () => {
        expect(coachingIneligibilityReason({ eligible: false, exclusion_reasons: ['too_short'] })).toBe('too_short');
        // The two gates a hand-written copy kept missing are just reasons here — nothing to re-implement.
        expect(coachingIneligibilityReason({ eligible: false, exclusion_reasons: ['no_clarity_evidence'] }))
            .toBe('no_clarity_evidence');
        expect(coachingIneligibilityReason({ eligible: false, exclusion_reasons: ['engine_not_comparable'] }))
            .toBe('engine_not_comparable');
        expect(coachingIneligibilityReason({ eligible: false, exclusion_reasons: ['unverified_attribution'] }))
            .toBe('unverified_attribution');
    });

    it('CASUALTY: an excluded session with no recorded reason is still excluded', () => {
        expect(coachingIneligibilityReason({ eligible: false, exclusion_reasons: [] })).toBe('ineligible');
        expect(coachingIneligibilityReason({ eligible: false, exclusion_reasons: null })).toBe('ineligible');
        expect(coachingIneligibilityReason({ eligible: false, exclusion_reasons: ['  '] })).toBe('ineligible');
        expect(isEligibleForCoaching({ eligible: false, exclusion_reasons: [] })).toBe(false);
    });
});
