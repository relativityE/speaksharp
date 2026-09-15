// #1472 — the one filler-evidence truth. Pure contract tests: every surface consumes these outcomes.
import { describe, it, expect } from 'vitest';
import {
    evidenceKindFromSnapshot, measuredFillerTotal, readFillerCompleteness, resolveFillerEvidence, sessionFillerEvidence,
} from '../fillerEvidence';

describe('#1472 — evidenceKindFromSnapshot (the in-memory review snapshot)', () => {
    it('agrees with the persisted rule for every combination', () => {
        expect(evidenceKindFromSnapshot({ available: true, total: 0 }, null)).toBe('unobservable');
        expect(evidenceKindFromSnapshot({ available: true, total: 0 }, 'unobservable')).toBe('unobservable');
        expect(evidenceKindFromSnapshot({ available: true, total: 0 }, 'complete')).toBe('verified_zero');
        expect(evidenceKindFromSnapshot({ available: true, total: 2 }, null)).toBe('observed');
        expect(evidenceKindFromSnapshot({ available: true, total: 2 }, 'unobservable')).toBe('observed');
        expect(evidenceKindFromSnapshot({ available: false, total: 0 }, 'complete')).toBe('unavailable');
        expect(evidenceKindFromSnapshot({ available: true, total: 0 }, 'no_speech')).toBe('no_speech');
        expect(evidenceKindFromSnapshot({ available: true, total: 0 }, 'clean')).toBe('unobservable');
    });
});

describe('#1472 — resolveFillerEvidence', () => {
    it('an empty map with NO completeness state is unobservable, never a clean zero', () => {
        expect(resolveFillerEvidence({}, null)).toEqual({ kind: 'unobservable' });
        expect(resolveFillerEvidence({}, undefined)).toEqual({ kind: 'unobservable' });
    });

    it('an empty or all-zero map stated unobservable stays unobservable', () => {
        expect(resolveFillerEvidence({}, 'unobservable')).toEqual({ kind: 'unobservable' });
        expect(resolveFillerEvidence({ um: 0 }, 'unobservable')).toEqual({ kind: 'unobservable' });
    });

    it('a zero is a verified zero ONLY with the complete state', () => {
        expect(resolveFillerEvidence({}, 'complete')).toEqual({ kind: 'verified_zero', counts: {} });
        expect(measuredFillerTotal(resolveFillerEvidence({}, 'complete'))).toBe(0);
    });

    it('observed nonzero counts stay truthful whatever completeness says (a live filler the final decode omitted)', () => {
        for (const state of [null, 'unobservable', 'complete']) {
            expect(resolveFillerEvidence({ um: 1 }, state)).toEqual({ kind: 'observed', total: 1, counts: { um: 1 } });
        }
    });

    it('no_speech is distinct from unobservable and contributes no filler total', () => {
        expect(resolveFillerEvidence({}, 'no_speech')).toEqual({ kind: 'no_speech' });
        expect(measuredFillerTotal({ kind: 'no_speech' })).toBeNull();
    });

    it('a missing or invalid map is unavailable, never zero', () => {
        expect(resolveFillerEvidence(null, 'complete')).toEqual({ kind: 'unavailable' });
        expect(resolveFillerEvidence({ 'a phrase': 2 }, 'complete')).toEqual({ kind: 'unavailable' });
        expect(resolveFillerEvidence({ um: -1 }, null)).toEqual({ kind: 'unavailable' });
    });

    it('an unknown completeness value is treated as absent (fail closed)', () => {
        expect(readFillerCompleteness('verified')).toBeNull();
        expect(resolveFillerEvidence({}, 'verified')).toEqual({ kind: 'unobservable' });
    });

    it('unobservable, no-speech and unavailable evidence never produce a metric value', () => {
        expect(measuredFillerTotal({ kind: 'unobservable' })).toBeNull();
        expect(measuredFillerTotal({ kind: 'unavailable' })).toBeNull();
        expect(measuredFillerTotal(resolveFillerEvidence({ uh: 3 }, null))).toBe(3);
    });

    it('a legacy persisted row (no completeness column) with `{}` is unobservable', () => {
        expect(sessionFillerEvidence({ filler_counts: {} })).toEqual({ kind: 'unobservable' });
        expect(sessionFillerEvidence({ filler_counts: { like: 2 } })).toMatchObject({ kind: 'observed', total: 2 });
    });
});
