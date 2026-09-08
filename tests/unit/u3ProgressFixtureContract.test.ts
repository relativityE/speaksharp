// @vitest-environment node
/**
 * #1427 — the U3 eligible fixture must satisfy the PRODUCTION completeness gate.
 *
 * The U3 evidence matrix was red because `hasCompleteEligibleProgressEvidence` requires an integer
 * `errorMarkerCount >= 0` and the fixture had no `error_marker_count`. `toEvaluation()` produced
 * `undefined`, the gate refused the row, and the journey resolved `unavailable` long before reaching
 * the progress-direction and next-action assertions it exists to make.
 *
 * The E2E shard could only report that the journey ended `unavailable`; it could not say why, and it
 * cost a full CI cycle to find out. This runs the real predicate over the real fixture in
 * milliseconds, so the next time the gate gains a required field the fixture fails here first.
 */
import { describe, it, expect } from 'vitest';
import { hasCompleteEligibleProgressEvidence } from '@/services/progress/buildProgressEvaluation';
import { eligibleProgressTruth } from '../e2e/helpers/progressFixtures';

/** Mirrors `toEvaluation()` in loadSessionProgress.ts — the readback mapping the gate is applied to. */
const toEvaluation = (row: {
    eligible: boolean; word_count: number; clarity_raw: number;
    filler_count: number; error_marker_count?: number; wpm: number;
}) => ({
    eligible: row.eligible,
    wordCount: row.word_count,
    clarityRaw: row.clarity_raw,
    fillerCount: row.filler_count,
    errorMarkerCount: row.error_marker_count,
    wpm: row.wpm,
});

const FIXTURE = eligibleProgressTruth('session-4', 'session-3');

describe('#1427 — the U3 eligible progress fixture passes the production completeness gate', () => {
    it('every evaluation row in the fixture is accepted', () => {
        expect(FIXTURE.evaluations.length).toBeGreaterThan(1);
        for (const row of FIXTURE.evaluations) {
            expect(hasCompleteEligibleProgressEvidence(toEvaluation(row)), `row ${row.session_id} rejected`).toBe(true);
        }
    });

    it('CASUALTY: dropping error_marker_count is exactly what made the journey unavailable', () => {
        for (const row of FIXTURE.evaluations) {
            const withoutField: Record<string, unknown> = { ...row };
            delete withoutField.error_marker_count;
            expect(
                hasCompleteEligibleProgressEvidence(toEvaluation(withoutField as unknown as typeof row)),
                `row ${row.session_id} must be REFUSED without error-marker evidence`,
            ).toBe(false);
        }
    });

    it.each([
        ['null', null],
        ['a non-integer', 1.5],
        ['a negative count', -1],
        ['a string', '0'],
    ])('CASUALTY: %s error-marker value is refused, not coerced', (_label, value) => {
        const row = { ...FIXTURE.evaluations[0], error_marker_count: value as unknown as number };
        expect(hasCompleteEligibleProgressEvidence(toEvaluation(row))).toBe(false);
    });

    it('the fixture declares the field literally, so the E2E payload really carries it', () => {
        // The gate could be satisfied by a default applied in the mapper rather than by the fixture.
        // Asserting the literal presence keeps the E2E payload honest about what the server returned.
        for (const row of FIXTURE.evaluations) {
            expect(Object.prototype.hasOwnProperty.call(row, 'error_marker_count')).toBe(true);
            expect(Number.isInteger(row.error_marker_count)).toBe(true);
        }
    });
});
