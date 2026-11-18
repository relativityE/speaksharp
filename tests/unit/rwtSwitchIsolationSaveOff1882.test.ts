// @vitest-environment node
/**
 * #1882 / #1835 (Sam, Nov 18): on a saving-OFF run the switch take's two transcript-dependent assertions (the Open Mic
 * digest and marker support) are REPLACED by explicit metrics-only checks, never skipped. A clean saving-off observation
 * failed before (the metrics-only row read as "contradictory transcript state"); it passes now only when both reads of the
 * Open Mic row are completed, have a positive duration and carry no transcript, for the same session and product.
 */
import { describe, expect, it } from 'vitest';
import { switchIsolationVerdict, switchSourceState, type SwitchIsolationObservation, type SwitchSourceSnapshot } from '../live/helpers/rwtOracles';

const metricsRow = { transcript: null, transcript_state: 'not_captured', status: 'completed', duration: 6 };
const source = (over: Partial<SwitchSourceSnapshot> = {}): SwitchSourceSnapshot => ({
    product: 'open_mic', digest: null, state: switchSourceState(metricsRow), sessionId: 'om', userId: 'owner', ...over,
});
const saveOff: SwitchIsolationObservation = {
    railPendingBefore: true, openMicId: 'om', focusId: 'fp', savedProduct: 'focus_points', railRowCount: 4,
    finalStatuses: ['covered', 'missing', 'missing', 'missing'], staleCoachingBeforeStart: false,
    // No transcript exists, so nothing was heard in it: marker support reads all false and must not decide the verdict.
    markerSupport: [false, false, false],
    openMicBefore: source(), openMicAfter: source(), ownerId: 'owner', transcriptSaving: 'off',
};
const v = (o: Partial<SwitchIsolationObservation>) => switchIsolationVerdict({ ...saveOff, ...o });

describe('#1882 saving off — the Open Mic row is read as metrics only, fail closed', () => {
    it('metrics_only needs no transcript, state not_captured, completed and a positive duration', () => {
        expect(switchSourceState(metricsRow)).toBe('metrics_only');
        for (const bad of [
            { ...metricsRow, transcript: '' }, { ...metricsRow, transcript: 'words' }, { ...metricsRow, transcript_state: 'available' },
            { ...metricsRow, transcript_state: null }, { ...metricsRow, status: 'recording' }, { ...metricsRow, duration: 0 },
            { ...metricsRow, duration: null }, { ...metricsRow, duration: Number.NaN },
        ]) expect(switchSourceState(bad)).toBe('malformed');
        expect(switchSourceState({ transcript: 'hi there', transcript_state: 'available' })).toBe('available');
        expect(switchSourceState({ transcript: null, transcript_state: 'expired' })).toBe('expired');
    });
});

describe('#1882 saving off — the switch verdict replaces the transcript assertions with metrics-only checks', () => {
    it('PASS: point 1 only, saved as Focus, the Open Mic take a metrics-only row with no transcript before and after', () => {
        const r = v({});
        expect(r.verdict).toBe('PASS');
        expect(r.detail).toMatch(/saving off: .*metrics-only row with no saved transcript/);
    });
    it('FAIL: a transcript saved while saving is off (before or after)', () => {
        const saved = source({ digest: 'd1', state: 'available' });
        expect(v({ openMicBefore: saved })).toMatchObject({ verdict: 'FAIL', detail: 'saving off: the Open Mic take saved a transcript' });
        expect(v({ openMicAfter: saved })).toMatchObject({ verdict: 'FAIL', detail: 'saving off: the Open Mic take saved a transcript' });
    });
    it('FAIL: no metrics (not completed or no duration) reads malformed and fails', () => {
        const noMetrics = source({ state: switchSourceState({ ...metricsRow, duration: 0 }) });
        expect(v({ openMicBefore: noMetrics }).verdict).toBe('FAIL');
        expect(v({ openMicAfter: source({ state: 'expired' }) })).toMatchObject({ verdict: 'FAIL', detail: 'saving off: the Open Mic take is not a completed metrics-only row' });
    });
    it('FAIL / HOLD: the Open Mic session changed or could not be read; carry-over still FAILs', () => {
        expect(v({ openMicAfter: source({ sessionId: 'other' }) }).verdict).toBe('FAIL');
        expect(v({ openMicAfter: source({ product: 'focus_points' }) }).verdict).toBe('FAIL');
        expect(v({ openMicAfter: { product: null, digest: null, state: 'query_error' } }).verdict).toBe('HOLD');
        expect(v({ finalStatuses: ['covered', 'covered', 'missing', 'missing'] }).verdict).toBe('FAIL');
        expect(v({ railRowCount: 0 }).verdict).toBe('FAIL');
    });
    it('saving ON (or unset) keeps every transcript assertion: a metrics-only Open Mic row FAILs there', () => {
        expect(v({ transcriptSaving: 'on' })).toMatchObject({ verdict: 'FAIL', detail: 'saving on: the Open Mic take saved no transcript' });
        expect(v({ transcriptSaving: undefined }).verdict).toBe('FAIL');
        const on = { ...saveOff, transcriptSaving: 'on' as const, markerSupport: [true, true, true],
            openMicBefore: source({ state: 'available', digest: 'd1' }), openMicAfter: source({ state: 'available', digest: 'd1' }) };
        expect(switchIsolationVerdict(on).verdict).toBe('PASS');
        expect(switchIsolationVerdict({ ...on, markerSupport: [true, false, true] }).verdict).toBe('HOLD');
    });
});
