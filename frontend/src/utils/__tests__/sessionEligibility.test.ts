/**
 * PROGRESS_AND_NEXT_ACTION §4 — a session may influence coaching or the next action only when EVERY gate
 * holds. Codex P1 on #1494: the resume band promoted a cached review from the newest row without checking
 * any of them, so a four-second accidental take could have supplied the user's "lesson".
 *
 * Each gate gets its own casualty, because a single combined assertion would pass with four of the five
 * checks deleted.
 */
import { describe, it, expect } from 'vitest';
import { coachingIneligibilityReason, isEligibleForCoaching, MIN_ELIGIBLE_WORDS } from '../sessionEligibility';
import { MIN_COMPARABLE_SECONDS } from '../aggregateProgress';

const ELIGIBLE = {
    status: 'completed',
    durationSeconds: 95,
    totalWords: 180,
    transcriptState: 'available',
    attributionStatus: 'verified',
};

describe('coachingIneligibilityReason', () => {
    it('a session that clears every gate is eligible', () => {
        expect(coachingIneligibilityReason(ELIGIBLE)).toBeNull();
        expect(isEligibleForCoaching(ELIGIBLE)).toBe(true);
    });

    it('uses the §4 thresholds, not the persistence floor or the scoring minimum', () => {
        expect(MIN_COMPARABLE_SECONDS).toBe(30);
        expect(MIN_ELIGIBLE_WORDS).toBe(75);
        // Exactly at both thresholds is eligible; one below either is not.
        expect(coachingIneligibilityReason({ ...ELIGIBLE, durationSeconds: 30, totalWords: 75 })).toBeNull();
        expect(coachingIneligibilityReason({ ...ELIGIBLE, durationSeconds: 29.9 })).toBe('too_short');
        expect(coachingIneligibilityReason({ ...ELIGIBLE, totalWords: 74 })).toBe('too_few_words');
    });

    it('CASUALTY: a legacy null status is not completed', () => {
        expect(coachingIneligibilityReason({ ...ELIGIBLE, status: null })).toBe('not_completed');
        expect(coachingIneligibilityReason({ ...ELIGIBLE, status: 'active' })).toBe('not_completed');
        expect(coachingIneligibilityReason({ ...ELIGIBLE, status: 'failed' })).toBe('not_completed');
    });

    it('CASUALTY: a four-second accidental take lends no lesson', () => {
        expect(coachingIneligibilityReason({ ...ELIGIBLE, durationSeconds: 4 })).toBe('too_short');
    });

    it('CASUALTY: no readable transcript — expired or never captured — means no coaching beside it', () => {
        for (const transcriptState of ['expired', 'not_captured', null, undefined, '']) {
            expect(coachingIneligibilityReason({ ...ELIGIBLE, transcriptState })).toBe('no_transcript');
        }
    });

    it('CASUALTY: unverified, pending and legacy_unknown attribution are all excluded', () => {
        for (const attributionStatus of ['unverified', 'pending', 'legacy_unknown', null]) {
            expect(coachingIneligibilityReason({ ...ELIGIBLE, attributionStatus })).toBe('unverified_attribution');
        }
    });

    it('fails closed on missing or unparseable numbers rather than reading them as a pass', () => {
        expect(coachingIneligibilityReason({ ...ELIGIBLE, durationSeconds: null })).toBe('too_short');
        expect(coachingIneligibilityReason({ ...ELIGIBLE, durationSeconds: Number.NaN })).toBe('too_short');
        expect(coachingIneligibilityReason({ ...ELIGIBLE, totalWords: undefined })).toBe('too_few_words');
        expect(coachingIneligibilityReason({})).toBe('not_completed');
    });
});
