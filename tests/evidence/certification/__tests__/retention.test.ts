import { describe, it, expect } from 'vitest';
import { resolveRetention, type RetentionRequest } from '../retention';

const req = (o: Partial<RetentionRequest> = {}): RetentionRequest => ({
    explicitOut: '', noRetain: false, subsetRun: false,
    setName: 'preflight', evidenceClass: 'preflight', sha: 'abc12345', ...o,
});

describe('#1304 retention — a measuring run cannot silently keep nothing', () => {
    it('retains to a derived path when --out is omitted', () => {
        // THE REGRESSION. Previously this produced no artifact at all and exited 0, which is how the
        // 459-word preflight was lost.
        expect(resolveRetention(req())).toEqual({
            kind: 'retain', path: 'evidence-runs/preflight-abc12345.json', derived: true,
        });
    });

    it('honours an explicit --out unchanged', () => {
        expect(resolveRetention(req({ explicitOut: 'evidence-runs/custom.json' })))
            .toEqual({ kind: 'retain', path: 'evidence-runs/custom.json', derived: false });
    });

    it('discards only when discarding was explicitly requested', () => {
        expect(resolveRetention(req({ noRetain: true }))).toEqual({ kind: 'discard', reason: 'no-retain' });
    });

    it('REFUSES to discard a selection run, even when asked', () => {
        const d = resolveRetention(req({ noRetain: true, evidenceClass: 'selection', setName: 'corpus' }));
        expect(d.kind).toBe('refuse');
        expect(d).toHaveProperty('reason', expect.stringContaining('down-select'));
    });

    it('an explicit --out still wins on a selection run', () => {
        expect(resolveRetention(req({
            explicitOut: 'evidence-runs/frozen-600.json', evidenceClass: 'selection', setName: 'corpus',
        }))).toEqual({ kind: 'retain', path: 'evidence-runs/frozen-600.json', derived: false });
    });

    it('does not pretend a --only subset is a retainable matrix run', () => {
        expect(resolveRetention(req({ subsetRun: true }))).toEqual({ kind: 'discard', reason: 'subset' });
    });

    it('derives a distinct path per set so one set cannot overwrite another', () => {
        const a = resolveRetention(req({ setName: 'harvard' }));
        const b = resolveRetention(req({ setName: 'preflight' }));
        expect(a).not.toEqual(b);
    });
});
