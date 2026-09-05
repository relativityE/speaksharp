/**
 * #1259 F02 — was the waveform showing real microphone data, or something plausible?
 *
 * The directive is explicit that a waveform must never be generated or plausible-looking, and that
 * per-frame waveform telemetry must never be emitted. Both constraints point the same way: summarise,
 * never stream.
 *
 * No per-frame hook is needed, because the session view already keeps the whole recording envelope in
 * order to draw the after-state waveform. That array IS the observation — it is summarised once, when
 * the session settles, from data the product was already holding.
 *
 * THE STATE THAT MATTERS IS `partial`. A microphone that produced samples which never moved off zero
 * is indistinguishable, from the user's side, from a meter that was never connected — and both render
 * as a flat line. Reporting that as "no speech" would be a guess; reporting it as `partial` says what
 * is actually known: samples arrived, and not one of them carried signal.
 *
 * No frames, no levels, no audio. Counts, bands, and a three-valued observability.
 */
import { safeEmit } from './safeEmit';

/**
 * Below this a sample is indistinguishable from a silent room on a scalar level meter. It is a NOISE
 * FLOOR, not a speech detector: the engine exposes one scalar and no spectrum, so this can say "the
 * signal moved" and must never claim "a person was speaking".
 */
export const MIC_NOISE_FLOOR = 0.02;

export type WaveformObservability = 'complete' | 'partial' | 'unobservable';

export interface MicSummary {
    samples: number;
    signalAvailable: boolean;
    aboveFloorRatioBand: string;
    peakLevelBand: string;
    waveformObservability: WaveformObservability;
}

function ratioBand(ratio: number): string {
    if (ratio <= 0) return '0';
    if (ratio < 0.1) return '0-10';
    if (ratio < 0.3) return '10-30';
    if (ratio < 0.6) return '30-60';
    if (ratio < 0.9) return '60-90';
    return '90-100';
}

function levelBand(peak: number): string {
    if (peak <= 0) return '0';
    if (peak < MIC_NOISE_FLOOR) return 'below_floor';
    if (peak < 0.25) return 'low';
    if (peak < 0.6) return 'medium';
    return 'high';
}

export function summariseMicLevels(levels: readonly number[]): MicSummary {
    const usable = levels.filter((l) => Number.isFinite(l) && l >= 0);
    const samples = usable.length;
    if (samples === 0) {
        // Nothing was observed. Not "silence" — silence is a measurement, and this is its absence.
        return {
            samples: 0, signalAvailable: false, aboveFloorRatioBand: '0',
            peakLevelBand: '0', waveformObservability: 'unobservable',
        };
    }
    const peak = usable.reduce((m, l) => (l > m ? l : m), 0);
    const aboveFloor = usable.filter((l) => l > MIC_NOISE_FLOOR).length;
    return {
        samples,
        signalAvailable: peak > 0,
        aboveFloorRatioBand: ratioBand(aboveFloor / samples),
        peakLevelBand: levelBand(peak),
        // Samples that never rose above the floor cannot distinguish a quiet room from a dead meter.
        waveformObservability: peak > MIC_NOISE_FLOOR ? 'complete' : 'partial',
    };
}

export function emitMicObservability(
    levels: readonly number[],
    stopControlRendered: boolean,
): void {
    const s = summariseMicLevels(levels);
    safeEmit('mic_observability', {
        samples_observed: s.samples,
        signal_available: s.signalAvailable,
        speech_activity_ratio_band: s.aboveFloorRatioBand,
        peak_level_band: s.peakLevelBand,
        waveform_observability: s.waveformObservability,
        stop_control_rendered: stopControlRendered,
    }, 'HIGH');
}
