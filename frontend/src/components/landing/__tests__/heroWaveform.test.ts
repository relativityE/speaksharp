import { describe, it, expect } from 'vitest';
import {
    HERO_WAVEFORM_ENVELOPE,
    HERO_WAVEFORM_TRACK_PX,
    waveformBarCount,
    buildWaveformBars,
    waveformHighlightCount,
} from '../heroWaveform';

// #1475 — the G12 hero waveform is decorative and deterministic, never a fake live recording.

describe('#1475 hero waveform — deterministic source', () => {
    it('the committed envelope is normalized, non-empty and identical on every read', () => {
        expect(HERO_WAVEFORM_ENVELOPE.length).toBeGreaterThan(200);
        for (const v of HERO_WAVEFORM_ENVELOPE) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
        expect(buildWaveformBars(HERO_WAVEFORM_ENVELOPE, 120)).toEqual(buildWaveformBars(HERO_WAVEFORM_ENVELOPE, 120));
    });
});

describe('#1475 hero waveform — bar geometry', () => {
    it('bar count is floor(trackWidth / 4), and never negative or fractional', () => {
        expect(waveformBarCount(320)).toBe(80);
        expect(waveformBarCount(323)).toBe(80);
        expect(waveformBarCount(0)).toBe(0);
        expect(waveformBarCount(-10)).toBe(0);
        expect(waveformBarCount(Number.NaN)).toBe(0);
    });

    it('downsamples by PEAK per bucket, not the mean', () => {
        // Two buckets: [0.1, 0.9] and [0.2, 0.3]. Peak keeps 0.9 and 0.3; a mean would give 0.5 and 0.25.
        const bars = buildWaveformBars([0.1, 0.9, 0.2, 0.3], 2);
        expect(bars).toEqual([Math.round(0.9 * HERO_WAVEFORM_TRACK_PX), Math.round(0.3 * HERO_WAVEFORM_TRACK_PX)]);
    });

    it('clamps amplitude so no bar exceeds the 84px track', () => {
        expect(HERO_WAVEFORM_TRACK_PX).toBe(84);
        expect(buildWaveformBars([2, 5, 0.5], 3)).toEqual([84, 84, 42]);
        expect(Math.max(...buildWaveformBars(HERO_WAVEFORM_ENVELOPE, 300))).toBeLessThanOrEqual(84);
    });

    it.each([
        ['mobile 320px viewport', 288],
        ['tablet 768px viewport', 704],
        ['desktop hero track', 1120],
    ])('%s: at least 25%% of rendered bars are at or below 4px (genuine silence retained)', (_label, trackWidth) => {
        const bars = buildWaveformBars(HERO_WAVEFORM_ENVELOPE, waveformBarCount(trackWidth));
        expect(bars.length).toBe(Math.floor(trackWidth / 4));
        const quiet = bars.filter((h) => h <= 4).length;
        expect(quiet / bars.length).toBeGreaterThanOrEqual(0.25);
        expect(bars.every((h) => h >= 1)).toBe(true); // every bar is visible
    });

    it('the first 62% of bars are highlighted', () => {
        expect(waveformHighlightCount(100)).toBe(62);
        expect(waveformHighlightCount(80)).toBe(Math.floor(80 * 0.62));
        expect(waveformHighlightCount(0)).toBe(0);
    });
});
