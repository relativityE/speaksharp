import { describe, it, expect } from 'vitest';
import { fillerPrf, punctuationPlacementPrf, FILLER_METRIC_VERSION, PUNCTUATION_METRIC_VERSION } from '../qualityMetrics';

describe('#1037 qualityMetrics — filler recognition (filler_v1)', () => {
    it('scores perfect recognition of both fillers', () => {
        const r = fillerPrf('so um I think uh yes', 'so um I think uh yes');
        expect(r.version).toBe(FILLER_METRIC_VERSION);
        expect(r.referenceCount).toBe(2);
        expect(r.recall).toBe(1);
        expect(r.precision).toBe(1);
        expect(r.f1).toBe(1);
    });

    it('honestly reports low recall when the recognizer DROPS fillers', () => {
        const r = fillerPrf('so um I think uh yes', 'so I think yes'); // both fillers dropped
        expect(r.recall).toBe(0);
        expect(r.precision).toBeNull();   // no predicted fillers → precision undefined, never faked
        expect(r.f1).toBeNull();
    });

    it('recall is null (unmeasurable) when the reference has no fillers — never a fake 1.0', () => {
        const r = fillerPrf('the quick brown fox', 'the quick brown fox');
        expect(r.recall).toBeNull();
        expect(r.referenceCount).toBe(0);
    });

    it('counts a false positive when the recognizer invents a filler', () => {
        const r = fillerPrf('the plan', 'the um plan');
        expect(r.falsePositives).toBe(1);
        expect(r.precision).toBe(0);
    });
});

describe('#1037 qualityMetrics — punctuation placement (punct_v1)', () => {
    it('scores correct sentence-final placement', () => {
        const r = punctuationPlacementPrf('Hello there. How are you?', 'hello there. how are you?');
        expect(r.version).toBe(PUNCTUATION_METRIC_VERSION);
        expect(r.referenceCount).toBe(2);   // boundaries after "there" and "you"
        expect(r.recall).toBe(1);
        expect(r.f1).toBe(1);
    });

    it('penalizes a missing sentence boundary (recall < 1)', () => {
        const r = punctuationPlacementPrf('Stop here. Go there.', 'stop here go there.');
        expect(r.referenceCount).toBe(2);
        expect(r.recall).toBeCloseTo(0.5, 10); // only the final boundary survived
    });

    it('recall is null when the reference has no sentence terminators', () => {
        const r = punctuationPlacementPrf('no terminator here', 'no terminator here');
        expect(r.recall).toBeNull();
    });
});
