import { describe, it, expect } from 'vitest';
import { projectEventProps, isValidForEventField } from '../telemetryAllowlist';

// #1472 — `session_saved` carried `filler_count: 0` with nothing to say whether that zero was measured. The
// Production biopsy read exactly that event as "no fillers" after the model had stripped them. The saved receipt
// must carry the same closed completeness state the product persists, so a reader can tell a verified zero from an
// unobservable one without joining another event.

describe('#1472 — session_saved carries the closed filler completeness state', () => {
    it.each(['complete', 'unobservable', 'no_speech'])('keeps filler_completeness=%s beside filler_count', (state) => {
        const input = { mode: 'private', filler_count: 0, filler_completeness: state };
        const { props, dropped } = projectEventProps('session_saved', input);
        expect(props).toEqual(input);
        expect(dropped).toEqual([]);
    });

    it.each(['clean', 'zero', 'unknown', 'COMPLETE', ''])('rejects an out-of-vocabulary completeness value %j', (value) => {
        expect(isValidForEventField('session_saved', 'filler_completeness', value)).toBe(false);
        const { props, dropped } = projectEventProps('session_saved', { mode: 'private', filler_completeness: value });
        expect(props).not.toHaveProperty('filler_completeness');
        expect(dropped).toContain('filler_completeness');
    });

    it('CONTROL: filler_count alone is still accepted (older producers), so the field is additive', () => {
        const { props, dropped } = projectEventProps('session_saved', { mode: 'private', filler_count: 3 });
        expect(props).toEqual({ mode: 'private', filler_count: 3 });
        expect(dropped).toEqual([]);
    });
});
