// @vitest-environment node
/** #1258: saved Focus point identity is proved by point id/order/label/verdict and visible Analytics ordinal. */
import { describe, expect, it } from 'vitest';
import {
    parseVisibleFocusEvidence,
    savedFocusIdentityVerdict,
    type SavedFocusIdentityObservation,
} from '../live/helpers/rwtSavedFocusIdentity';

const full: SavedFocusIdentityObservation = {
    expectedBriefId: 'brief-a',
    savedBriefId: 'brief-a',
    expected: [
        { label: 'Name the value', railStatus: 'covered' },
        { label: 'Explain the proof', railStatus: 'covered' },
        { label: 'Ask for the next step', railStatus: 'covered' },
    ],
    savedPoints: [
        { id: 'p1', brief_id: 'brief-a', sort_order: 0, label: 'Name the value' },
        { id: 'p2', brief_id: 'brief-a', sort_order: 1, label: 'Explain the proof' },
        { id: 'p3', brief_id: 'brief-a', sort_order: 2, label: 'Ask for the next step' },
    ],
    evidence: [
        { brief_point_id: 'p1', verdict: 'detected' },
        { brief_point_id: 'p2', verdict: 'detected' },
        { brief_point_id: 'p3', verdict: 'detected' },
    ],
    visibleEvidence: ['From this session', 'Detected: point 1 at 0:21, point 2 at 1:04, point 3 at 2:16.', 'Recorded for 3:24.'],
};
const evaluate = (change: Partial<SavedFocusIdentityObservation> = {}) => savedFocusIdentityVerdict({ ...full, ...change });

describe('saved Focus point identity and visible ordinal proof (#1258)', () => {
    it('PASS controls: full coverage and partial/missing coverage bind every point by identity', () => {
        expect(evaluate().verdict).toBe('PASS');
        const partial: SavedFocusIdentityObservation = {
            ...full,
            expected: [
                { label: 'Name the value', railStatus: 'partial' },
                { label: 'Explain the proof', railStatus: 'covered' },
                { label: 'Ask for the next step', railStatus: 'missing' },
            ],
            evidence: [
                { brief_point_id: 'p1', verdict: 'detected' },
                { brief_point_id: 'p2', verdict: 'detected' },
                { brief_point_id: 'p3', verdict: 'not_detected' },
            ],
            visibleEvidence: ['Detected: point 1 at 0:21, point 2 at 1:04.', 'Not detected: point 3.', 'Recorded for 3:24.'],
        };
        expect(savedFocusIdentityVerdict(partial).verdict).toBe('PASS');
    });

    it('CASUALTY: equal-count swapped saved verdicts fail by point identity', () => {
        const swapped = evaluate({
            expected: [
                { label: 'Name the value', railStatus: 'covered' },
                { label: 'Explain the proof', railStatus: 'missing' },
                { label: 'Ask for the next step', railStatus: 'covered' },
            ],
            evidence: [
                { brief_point_id: 'p1', verdict: 'detected' },
                { brief_point_id: 'p2', verdict: 'detected' },
                { brief_point_id: 'p3', verdict: 'not_detected' },
            ],
            visibleEvidence: ['Detected: point 1 at 0:21, point 2 at 1:04.', 'Not detected: point 3.'],
        });
        expect(swapped.verdict).toBe('FAIL');
        expect(swapped.mismatchedOrdinals).toEqual([2, 3]);
    });

    it('CASUALTY: wrong saved labels or order do not pass', () => {
        expect(evaluate({ savedPoints: [
            { ...full.savedPoints[1], sort_order: 0 },
            { ...full.savedPoints[0], sort_order: 1 },
            full.savedPoints[2],
        ] }).verdict).toBe('FAIL');
        expect(evaluate({ savedPoints: [
            { ...full.savedPoints[0], label: 'Different point' }, full.savedPoints[1], full.savedPoints[2],
        ] }).verdict).toBe('FAIL');
        expect(evaluate({ savedBriefId: 'another-brief' }).verdict).toBe('FAIL');
    });

    it('CASUALTY: missing, duplicate, out-of-brief, and zero evidence rows fail', () => {
        expect(evaluate({ evidence: full.evidence.slice(0, 2) }).verdict).toBe('FAIL');
        expect(evaluate({ evidence: [...full.evidence, full.evidence[0]] }).verdict).toBe('FAIL');
        expect(evaluate({ evidence: [...full.evidence, { brief_point_id: 'outside', verdict: 'detected' }] }).verdict).toBe('FAIL');
        expect(evaluate({ evidence: [] }).verdict).toBe('FAIL');
    });

    it('CASUALTY: pending and unavailable rail/evidence states fail closed', () => {
        for (const railStatus of ['pending', 'unavailable', null] as const) {
            expect(evaluate({ expected: [{ ...full.expected[0], railStatus }, ...full.expected.slice(1)] }).verdict).toBe('FAIL');
        }
        expect(evaluate({ evidence: [
            { brief_point_id: 'p1', verdict: 'unavailable' }, ...full.evidence.slice(1),
        ] }).verdict).toBe('FAIL');
    });

    it('CASUALTY: missing, extra, duplicate, and malformed visible ordinals fail', () => {
        for (const visibleEvidence of [
            ['Detected: point 1 at 0:21, point 3 at 2:16.'],
            ['Detected: point 1 at 0:21, point 2 at 1:04, point 3 at 2:16, point 4.'],
            ['Detected: point 1 at 0:21, point 1 at 1:04, point 3 at 2:16.'],
            ['Detected: point one, point 2, point 3.'],
            ['Detected: point 1 at 0:99, point 2, point 3.'],
            ['Detected: point 1, point 2, point 3.', 'Not detected: point 2.'],
            [''],
        ]) expect(evaluate({ visibleEvidence }).verdict).toBe('FAIL');
    });

    it('parser rejects unknown text and keeps ordinal statuses instead of collapsing counts', () => {
        const parsed = parseVisibleFocusEvidence(['Detected: point 1 at 0:21.', 'Not detected: point 2.', 'Not checked: point 3.']);
        expect([...parsed.points.entries()]).toEqual([[1, 'detected'], [2, 'not_detected'], [3, 'unavailable']]);
        expect(parseVisibleFocusEvidence(['Coverage: 2/3']).errors).not.toHaveLength(0);
    });
});
