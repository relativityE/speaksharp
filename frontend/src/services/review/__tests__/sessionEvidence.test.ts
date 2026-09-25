import { describe, it, expect } from 'vitest';
import { focusPointsEvidence, openMicEvidence } from '../sessionEvidence';

const signal = (over: Record<string, unknown> = {}) => ({
    reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 6.24, comparator: 'above_target', templateVersion: 'rec_v1', ...over,
});

describe('openMicEvidence — the stored measured signal, and nothing invented (#1258 G20)', () => {
    it('fillers per minute, against the target', () => {
        expect(openMicEvidence(signal())).toEqual(['6.2 filler words a minute, above your target.']);
    });
    it('pace, against the target', () => {
        expect(openMicEvidence(signal({ reasonCode: 'PACE_TOO_FAST', actionCode: 'SLOW_DOWN', metric: 'wpm', value: 181.6 }))).toEqual(['182 words a minute, above your target.']);
    });
    it('a measurement with no comparison states the number only', () => {
        expect(openMicEvidence(signal({ comparator: 'no_baseline' }))).toEqual(['6.2 filler words a minute.']);
    });
    it('CASUALTY: no metric, or an invalid signal, yields no line rather than an invented one', () => {
        expect(openMicEvidence(signal({ reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target' }))).toEqual([]);
        expect(openMicEvidence(signal({ metric: 'made_up' }))).toEqual([]);
        expect(openMicEvidence({ ...signal(), prose: 'x' })).toEqual([]);
        expect(openMicEvidence(null)).toEqual([]);
    });
});

describe('focusPointsEvidence — saved point results and recorded length (#1258 G20)', () => {
    const points = [
        { label: 'a', status: 'detected' as const, detectedAtSeconds: 21 },
        { label: 'b', status: 'detected' as const, detectedAtSeconds: 64 },
        { label: 'c', status: 'not_detected' as const, detectedAtSeconds: null },
        { label: 'd', status: 'unavailable' as const, detectedAtSeconds: null },
    ];
    it('names detected points with times, not-detected points, unchecked points, and the recorded length', () => {
        expect(focusPointsEvidence(points, 204)).toEqual([
            'Detected: point 1 at 0:21, point 2 at 1:04.',
            'Not detected: point 3.',
            'Not checked: point 4.',
            'Recorded for 3:24.',
        ]);
    });
    it('never compares against a pace guide (the guide is not saved)', () => {
        expect(focusPointsEvidence(points, 204).join(' ')).not.toMatch(/guide/i);
    });
    it('4/4 detected names no missing point; no results means no line at all', () => {
        const all = points.map((p, i) => ({ ...p, status: 'detected' as const, detectedAtSeconds: (i + 1) * 10 }));
        expect(focusPointsEvidence(all, 60).some((l) => /Not detected|Not checked/.test(l))).toBe(false);
        expect(focusPointsEvidence([], 60)).toEqual([]);
    });
});
