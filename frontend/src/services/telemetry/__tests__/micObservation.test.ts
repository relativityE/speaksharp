import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { summariseMicLevels, emitMicObservability, MIC_NOISE_FLOOR } from '../micObservation';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === 'mic_observability').map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

describe('F02 — was the waveform real?', () => {
    it('A DEAD METER IS NOT SILENCE: samples that never move report PARTIAL', () => {
        // Both render as a flat line, and only one of them is a working microphone. Reporting this as
        // "no speech" would be a guess about the user; `partial` reports what is actually known.
        const s = summariseMicLevels(new Array(500).fill(0));
        expect(s.samples).toBe(500);
        expect(s.waveformObservability).toBe('partial');
        expect(s.signalAvailable).toBe(false);
        expect(s.peakLevelBand).toBe('0');
    });

    it('NO SAMPLES AT ALL is unobservable — absence, not a measurement', () => {
        const s = summariseMicLevels([]);
        expect(s.waveformObservability).toBe('unobservable');
        expect(s.samples).toBe(0);
    });

    it('real signal reports COMPLETE, with a banded ratio and peak', () => {
        // A take where most samples carry signal.
        const levels = [...new Array(80).fill(0.4), ...new Array(20).fill(0.001)];
        const s = summariseMicLevels(levels);
        expect(s.waveformObservability).toBe('complete');
        expect(s.signalAvailable).toBe(true);
        expect(s.aboveFloorRatioBand).toBe('60-90');
        expect(s.peakLevelBand).toBe('medium');
    });

    it('signal that never clears the NOISE FLOOR is still only partial', () => {
        // Non-zero but below the floor: the meter moved a little and proves nothing about speech.
        const s = summariseMicLevels(new Array(100).fill(MIC_NOISE_FLOOR / 2));
        expect(s.waveformObservability).toBe('partial');
        expect(s.signalAvailable).toBe(true);      // it DID produce signal...
        expect(s.peakLevelBand).toBe('below_floor'); // ...but never enough to mean anything
    });

    it('ignores malformed samples rather than letting them skew the summary', () => {
        const s = summariseMicLevels([Number.NaN, -1, 0.5, Number.POSITIVE_INFINITY, 0.5]);
        expect(s.samples).toBe(2);
        expect(s.waveformObservability).toBe('complete');
    });

    it('records whether a Stop affordance was on screen, and emits no frames', () => {
        emitMicObservability([0.4, 0.5, 0.45], true);
        drain();
        const r = rows()[0];
        expect(r.stop_control_rendered).toBe(true);
        expect(r.samples_observed).toBe(3);
        // Bands and counts only — not one level value may travel.
        const serialized = JSON.stringify(r);
        expect(serialized).not.toContain('0.4');
        expect(serialized).not.toContain('0.45');
    });

    it('one row per take, however many samples were held', () => {
        emitMicObservability(new Array(12_000).fill(0.3), true);
        drain();
        expect(rows()).toHaveLength(1);
    });

    it('every field survives the schema; an invented observability does not', () => {
        expect(projectEventProps('mic_observability', {
            samples_observed: 12_000, signal_available: true,
            speech_activity_ratio_band: '60-90', peak_level_band: 'medium',
            waveform_observability: 'partial', stop_control_rendered: true,
        }).dropped).toEqual([]);
        expect(projectEventProps('mic_observability', {
            waveform_observability: 'probably_fine',
        }).dropped).toContain('waveform_observability');
    });
});
