import { describe, it, expect } from 'vitest';
import { tokensFromTranscript, waveformFromLevels } from '../transcriptTokens';

// #1222 S11 — transcript → shell tokens, and mic levels → a track-filling waveform.
describe('tokensFromTranscript (#1222 S11)', () => {
    it('marks known fillers and leaves other words plain', () => {
        const tokens = tokensFromTranscript('So um today we like it');
        const fillers = tokens.filter((t) => t.filler).map((t) => t.text.toLowerCase().trim());
        expect(fillers).toContain('um');
        expect(fillers).toContain('like');
        expect(tokens.some((t) => !t.filler && t.text.includes('today'))).toBe(true);
    });

    it('empty transcript → no tokens', () => {
        expect(tokensFromTranscript('')).toEqual([]);
    });
});

describe('waveformFromLevels (#1222 S11)', () => {
    it('always returns the fixed bar count so the track fills', () => {
        const { amplitudes } = waveformFromLevels([0.2, 0.8], 72);
        expect(amplitudes).toHaveLength(72);
        expect(amplitudes.every((a) => a >= 0 && a <= 1)).toBe(true);
    });

    it('recordedCount grows with the buffer but never exceeds the bar count', () => {
        expect(waveformFromLevels([0.5, 0.5, 0.5], 72).recordedCount).toBe(3);
        expect(waveformFromLevels(new Array(100).fill(0.5), 72).recordedCount).toBe(72);
    });

    it('leading-fills when there are fewer samples than bars (grows left→right)', () => {
        const { amplitudes } = waveformFromLevels([0.9], 4); // one sample → FIRST bar populated, rest tail
        expect(amplitudes[0]).toBeCloseTo(0.9, 5);
        expect(amplitudes[3]).toBe(0);
    });

    it('peak-downsamples the full buffer (not mean) when samples exceed bars', () => {
        // 8 samples → 4 buckets of 2; each bucket takes the PEAK, so a transient survives.
        const { amplitudes, recordedCount } = waveformFromLevels([0.1, 0.9, 0.2, 0.2, 0.3, 0.1, 1.0, 0.0], 4);
        expect(amplitudes[0]).toBeCloseTo(0.9, 5); // peak of [0.1, 0.9]
        expect(amplitudes[3]).toBeCloseTo(1.0, 5); // peak of [1.0, 0.0] — a mean would have flattened it to 0.5
        expect(recordedCount).toBe(4);
    });
});
