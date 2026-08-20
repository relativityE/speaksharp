import { describe, it, expect } from 'vitest';
import { computeObjectiveCoverage } from '../objectiveCoverage';

describe('#1046 objectiveCoverage.computeObjectiveCoverage', () => {
    it('maps a covered point to a detected signal (clamped offset) and a missing point to null', () => {
        const { coverage, signals } = computeObjectiveCoverage(
            [
                { id: 'p1', label: 'pricing cost' },
                { id: 'p2', label: 'guarantee refund' },
            ],
            [{ text: 'we cover pricing and cost clearly', startSec: 8.6 }],
            60,
        );

        expect(coverage[0]).toMatchObject({ briefPointId: 'p1', status: 'covered', point: 'pricing cost' });
        expect(coverage[1]).toMatchObject({ briefPointId: 'p2', status: 'missing' });
        // 8.6 → rounded 9; missing → null.
        expect(signals).toEqual([
            { brief_point_id: 'p1', detected_at_seconds: 9 },
            { brief_point_id: 'p2', detected_at_seconds: null },
        ]);
    });

    it('clamps a detection offset to [0, floor(duration)] so finalize never rejects the payload', () => {
        const { signals } = computeObjectiveCoverage(
            [{ id: 'p1', label: 'pricing cost' }],
            [{ text: 'pricing cost', startSec: 999 }],
            30,
        );
        expect(signals[0]).toEqual({ brief_point_id: 'p1', detected_at_seconds: 30 });
    });

    it('matches a point via its cue, not just its label', () => {
        const { coverage, signals } = computeObjectiveCoverage(
            [{ id: 'p1', label: 'Opener', cue: 'greet the panel warmly' }],
            [{ text: 'greet the panel warmly everyone', startSec: 2 }],
            60,
        );
        expect(coverage[0].status).toBe('covered');
        expect(signals[0].detected_at_seconds).toBe(2);
        // The rail label stays the point's label, not the label+cue matching phrase.
        expect(coverage[0].point).toBe('Opener');
    });

    it('preserves point order and carries each brief_point_id', () => {
        const { coverage, signals } = computeObjectiveCoverage(
            [
                { id: 'a', label: 'Alpha' },
                { id: 'b', label: 'Bravo' },
                { id: 'c', label: 'Charlie' },
            ],
            [],
            10,
        );
        expect(coverage.map((c) => c.briefPointId)).toEqual(['a', 'b', 'c']);
        expect(signals.map((s) => s.brief_point_id)).toEqual(['a', 'b', 'c']);
        // No transcript → everything missing → every offset null.
        expect(signals.every((s) => s.detected_at_seconds === null)).toBe(true);
    });
});
