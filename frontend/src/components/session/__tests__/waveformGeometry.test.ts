/**
 * S-9 — the two rules that decide whether the waveform reads as speech or as a fake.
 *
 * Both were violated by the previous implementation, and both fail the same way: the rendered line-to-gap
 * ratio becomes a function of container width, so a value tuned in one track produces lines wider than
 * their gaps in every narrower one.
 */
import { describe, it, expect } from 'vitest';
import { sampleCountForWidth, downsamplePeaks, LINE_PITCH_PX } from '../waveformGeometry';

describe('sampleCountForWidth — density is derived from the track, never hardcoded', () => {
    it('is floor(trackWidth / 4)', () => {
        expect(LINE_PITCH_PX).toBe(4);
        expect(sampleCountForWidth(720)).toBe(180);
        expect(sampleCountForWidth(640)).toBe(160);
        expect(sampleCountForWidth(321)).toBe(80);
    });

    it('CASUALTY: a narrower track gets FEWER lines, so the 2px line keeps its ~2px gap', () => {
        // The defect this prevents: a fixed count spread over a narrow track leaves no room for the gaps.
        const wide = sampleCountForWidth(1200);
        const narrow = sampleCountForWidth(300);
        expect(narrow).toBeLessThan(wide);
        // At every width the lines occupy half the track (2px of each 4px pitch), leaving the rest as gap.
        for (const width of [300, 480, 720, 1200]) {
            const lines = sampleCountForWidth(width);
            expect(lines * 2).toBeLessThanOrEqual(width);
        }
    });

    it('a track too narrow for one line renders nothing rather than a stray hairline', () => {
        expect(sampleCountForWidth(3)).toBe(0);
        expect(sampleCountForWidth(0)).toBe(0);
        expect(sampleCountForWidth(-40)).toBe(0);
        expect(sampleCountForWidth(Number.NaN)).toBe(0);
    });
});

describe('downsamplePeaks — the PEAK of each bucket, never the mean', () => {
    it('keeps a syllable burst at full height instead of averaging it away', () => {
        // One loud sample among quiet ones: the mean would render ~0.2, the peak renders 1.
        const bucket = [0.05, 0.05, 1, 0.05, 0.05, 0.05, 0.05, 0.05];
        expect(downsamplePeaks(bucket, 1)).toEqual([1]);
    });

    it('CASUALTY: silence survives as silence — not every line has height', () => {
        // A phrase pause must stay low, or the track reads as uniform static rather than speech.
        const buffer = [1, 0.9, 0.8, 0.02, 0.01, 0.0, 0.7, 0.95];
        const levels = downsamplePeaks(buffer, 4);
        expect(levels).toHaveLength(4);
        expect(Math.min(...levels)).toBeLessThan(0.1);
        expect(Math.max(...levels)).toBeGreaterThan(0.9);
    });

    it('takes the magnitude, so a negative half-cycle is not read as silence', () => {
        // Audio oscillates either side of zero; the envelope is |sample|.
        expect(downsamplePeaks([-1, -0.9], 1)).toEqual([1]);
    });

    it('spreads the whole buffer across the requested count and clamps to 0..1', () => {
        const levels = downsamplePeaks([0.1, 0.2, 0.3, 0.4, 2, 0.6], 3);
        expect(levels).toHaveLength(3);
        expect(levels[0]).toBeCloseTo(0.2, 5);
        expect(levels[2]).toBe(1);            // clamped from the out-of-range 2
        expect(levels.every((l) => l >= 0 && l <= 1)).toBe(true);
    });

    it('invents nothing: no buffer or no room yields no levels', () => {
        expect(downsamplePeaks([], 40)).toEqual([]);
        expect(downsamplePeaks([0.4, 0.5], 0)).toEqual([]);
    });
});
