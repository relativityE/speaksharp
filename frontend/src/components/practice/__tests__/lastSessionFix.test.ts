/**
 * Brief H-4 — the resume band quotes the user's own lesson, so the parser must fail closed.
 *
 * A value that does not match the review contract is not a review: quoting half a row, a legacy free-form
 * payload or an unparseable blob back to the user as their lesson is worse than falling back to the run's
 * facts. These pin the exact key set, both non-empty halves, and every rejection path.
 */
import { describe, it, expect } from 'vitest';
import { readLastSessionFix } from '../lastSessionFix';

const VALID = {
    version: 'gemini_coaching_v1',
    what_worked: 'Your opening was clear and direct.',
    what_to_try_next: "Pause instead of filling the gap. You used 'um' 11 times.",
};

describe('readLastSessionFix', () => {
    it('returns the fix verbatim from a contract-valid review object', () => {
        expect(readLastSessionFix(VALID)).toBe("Pause instead of filling the gap. You used 'um' 11 times.");
    });

    it('accepts the same payload as a JSON string (legacy text column or a double-encoded write)', () => {
        expect(readLastSessionFix(JSON.stringify(VALID))).toBe(VALID.what_to_try_next);
    });

    it('trims surrounding whitespace but preserves the sentence', () => {
        expect(readLastSessionFix({ ...VALID, what_to_try_next: '  Slow down.  ' })).toBe('Slow down.');
    });

    it('CASUALTY: a partial write is not a review — one blank half yields null', () => {
        expect(readLastSessionFix({ ...VALID, what_to_try_next: '   ' })).toBeNull();
        expect(readLastSessionFix({ ...VALID, what_worked: '' })).toBeNull();
    });

    it('CASUALTY: an unknown contract version is rejected — same literal the Edge parser requires', () => {
        // A legacy, corrupted or future-version row can carry the same three keys with different
        // semantics; presenting its text as trusted coaching is the defect (Codex P2 on #1494).
        for (const version of ['v1', 'gemini_coaching_v2', '', null, 1]) {
            expect(readLastSessionFix({ ...VALID, version })).toBeNull();
        }
    });

    it('CASUALTY: an unexpected key set is rejected, so a legacy or extended payload cannot leak through', () => {
        expect(readLastSessionFix({ version: 'gemini_coaching_v1', what_to_try_next: 'x', what_worked: 'y', extra: 1 })).toBeNull();
        expect(readLastSessionFix({ what_to_try_next: 'x', what_worked: 'y' })).toBeNull();
        expect(readLastSessionFix({ suggestions: 'Try pausing more' })).toBeNull();
    });

    it('CASUALTY: non-string halves are rejected rather than stringified into a lesson', () => {
        expect(readLastSessionFix({ version: 'gemini_coaching_v1', what_worked: 'y', what_to_try_next: { text: 'x' } })).toBeNull();
        expect(readLastSessionFix({ version: 'gemini_coaching_v1', what_worked: 'y', what_to_try_next: 42 })).toBeNull();
    });

    it('CASUALTY: nothing, an array, or unparseable text yields null — never "undefined" as copy', () => {
        for (const raw of [null, undefined, '', 'not json', '{"broken":', [VALID], 7, true]) {
            expect(readLastSessionFix(raw)).toBeNull();
        }
    });
});
