// @vitest-environment jsdom
/**
 * #1882 / #1835 (Sam, Nov 18): on a saving-OFF run the switch take's two transcript-dependent assertions (the Open Mic
 * digest and marker support) are REPLACED by explicit metrics-only checks, never skipped. A clean saving-off observation
 * failed before (the metrics-only row read as "contradictory transcript state"); it passes now only when both reads of the
 * Open Mic row are completed, have a positive duration and carry no transcript, for the same session and product.
 */
import { describe, expect, it } from 'vitest';
import { completingPageMarkersInPage, labelHeardIn, switchIsolationVerdict, switchSaveOffVerdicts, switchSourceState, type SwitchIsolationObservation, type SwitchSourceSnapshot } from '../live/helpers/rwtOracles';

const metricsRow = { transcript: null, transcript_state: 'not_captured', status: 'completed', duration: 6 };
const source = (over: Partial<SwitchSourceSnapshot> = {}): SwitchSourceSnapshot => ({
    product: 'open_mic', digest: null, state: switchSourceState(metricsRow), sessionId: 'om', userId: 'owner', ...over,
});
const saveOff: SwitchIsolationObservation = {
    railPendingBefore: true, openMicId: 'om', focusId: 'fp', savedProduct: 'focus_points', railRowCount: 4,
    finalStatuses: ['covered', 'missing', 'missing', 'missing'], staleCoachingBeforeStart: false,
    // #1897 review 5: read from the Open Mic take's bound completing page (three content-free booleans), not a saved transcript.
    markerSupport: [true, true, true],
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
    it('PASS: markers heard on the bound completing page, point 1 only, saved as Focus, the Open Mic row metrics only', () => {
        const r = v({});
        expect(r.verdict).toBe('PASS');
        expect(r.detail).toMatch(/saving off: .*every marker point on its own completing page.*metrics-only row with no saved transcript/);
    });
    it('#1897 review 5: all three markers false (or absent, or short) is HOLD for isolation, never a PASS', () => {
        expect(v({ markerSupport: [false, false, false] }).verdict).toBe('HOLD');
        expect(v({ markerSupport: [true, false, true] }).verdict).toBe('HOLD');
        expect(v({ markerSupport: [] })).toMatchObject({ verdict: 'HOLD', detail: expect.stringMatching(/carry-over was not tested/) });
        expect(v({ markerSupport: [true, true] }).verdict).toBe('HOLD');
    });
    it('#1897 review 5: "stayed metrics-only" and "carry-over tested" are separate verdicts', () => {
        const clean = switchSaveOffVerdicts(saveOff);
        expect(clean.metricsOnly.verdict).toBe('PASS');
        expect(clean.carryOverTested.verdict).toBe('PASS');
        // Metrics-only holds while carry-over is untested: one PASS, one HOLD, and the combined row HOLDs.
        const untested = switchSaveOffVerdicts({ ...saveOff, markerSupport: [false, false, false] });
        expect(untested.metricsOnly.verdict).toBe('PASS');
        expect(untested.carryOverTested.verdict).toBe('HOLD');
        // A transcript saved while off fails metrics-only on its own, whatever the markers say.
        const saved = switchSaveOffVerdicts({ ...saveOff, openMicAfter: source({ digest: 'd1', state: 'available' }) });
        expect(saved.metricsOnly).toMatchObject({ verdict: 'FAIL', detail: 'saving off: the Open Mic take saved a transcript' });
        expect(saved.carryOverTested.verdict).toBe('PASS');
        expect(switchSaveOffVerdicts({ ...saveOff, openMicBefore: source({ product: 'focus_points' }) }).metricsOnly.verdict).toBe('FAIL');
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

describe('#1897 review 5 — the markers come from the bound completing page, as booleans only', () => {
    const LABELS = ['budget for next quarter', 'hiring plan', 'launch risks'];
    const TEXT = 'Welcome. First the budget for next quarter, then our hiring plan, and the launch risks.';
    const page = (opts: { id?: string | null; persisted?: string; text?: string | null; notice?: boolean } = {}) => {
        document.documentElement.setAttribute('data-session-persisted', opts.persisted ?? 'true');
        if (opts.id === null) document.documentElement.removeAttribute('data-session-persisted-id');
        else document.documentElement.setAttribute('data-session-persisted-id', opts.id ?? 'om');
        document.body.innerHTML = opts.text === null ? '<div data-testid="review-transcript-notice"><p>No speech</p></div>'
            : `<div data-testid="local-review-transcript">${opts.notice === false ? '' : '<p>This transcript isn’t saved. You can read it until you leave.</p>'}<p>${opts.text ?? TEXT}</p></div>`;
    };

    it('reads three booleans that agree with labelHeardIn, and nothing else', () => {
        page();
        const got = completingPageMarkersInPage({ sessionId: 'om', labels: LABELS });
        expect(got).toEqual([true, true, true]);
        expect(got).toEqual(LABELS.map((l) => labelHeardIn(l, TEXT)));
        page({ text: 'Welcome. First the budget for next quarter, then the launch risks.' });
        expect(completingPageMarkersInPage({ sessionId: 'om', labels: LABELS })).toEqual([true, false, true]);
    });

    it('null (so isolation HOLDs) unless it is this take\'s bound completing page with local text', () => {
        page({ id: 'other' });
        expect(completingPageMarkersInPage({ sessionId: 'om', labels: LABELS })).toBeNull();
        page({ id: null });
        expect(completingPageMarkersInPage({ sessionId: 'om', labels: LABELS })).toBeNull();
        page({ persisted: 'false' });
        expect(completingPageMarkersInPage({ sessionId: 'om', labels: LABELS })).toBeNull();
        page({ text: null });
        expect(completingPageMarkersInPage({ sessionId: 'om', labels: LABELS })).toBeNull();
        page({ text: '   ' });
        expect(completingPageMarkersInPage({ sessionId: 'om', labels: LABELS })).toBeNull();
        page({ notice: false });
        expect(completingPageMarkersInPage({ sessionId: 'om', labels: LABELS })).toBeNull();
    });
});
