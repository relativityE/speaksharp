import { describe, it, expect } from 'vitest';
import {
    HERO_WAVEFORM_TRACK_PX,
    HERO_WAVEFORM_TRACK_PX_NARROW,
    heroEnvelope,
    waveformHighlightCount,
    waveformLineCount,
    waveformLineHeights,
    waveformTrackHeight,
} from '../heroWaveform';

// #1475 G12 Rev 2 §4 — the hero waveform is decoration generated from a fixed seed, never a recording.

describe('#1475 hero waveform — deterministic seeded envelope', () => {
    it('the same N and seed always produce the same envelope, with no Math.random involved', () => {
        const random = Math.random;
        Math.random = () => { throw new Error('Math.random must not be used'); };
        try {
            expect(heroEnvelope(280)).toEqual(heroEnvelope(280));
        } finally {
            Math.random = random;
        }
    });

    it('regenerates for a new N instead of resampling, and a resize-then-restore reproduces the original', () => {
        const original = waveformLineHeights(280);
        expect(waveformLineHeights(176)).toHaveLength(176);
        expect(waveformLineHeights(280)).toEqual(original);
    });

    it('amplitudes are clamped to 0..1', () => {
        for (const value of heroEnvelope(1000)) {
            expect(value).toBeGreaterThan(0);
            expect(value).toBeLessThanOrEqual(1);
        }
    });

    it('uses the corrected near-silence band (0.02 .. 0.045) for pauses and word boundaries', () => {
        const quiet = heroEnvelope(1000).filter((v) => v < 0.05);
        expect(quiet.length).toBeGreaterThan(0);
        for (const v of quiet) {
            expect(v).toBeGreaterThanOrEqual(0.02);
            expect(v).toBeLessThanOrEqual(0.045);
        }
    });
});

describe('#1475 hero waveform — geometry', () => {
    it('line count is floor(trackWidth / 4), never negative or fractional', () => {
        expect(waveformLineCount(320)).toBe(80);
        expect(waveformLineCount(323)).toBe(80);
        expect(waveformLineCount(0)).toBe(0);
        expect(waveformLineCount(-10)).toBe(0);
        expect(waveformLineCount(Number.NaN)).toBe(0);
    });

    it('the track is 84px, and 56px below 768px', () => {
        expect(waveformTrackHeight(1280)).toBe(HERO_WAVEFORM_TRACK_PX);
        expect(waveformTrackHeight(768)).toBe(HERO_WAVEFORM_TRACK_PX);
        expect(waveformTrackHeight(767)).toBe(HERO_WAVEFORM_TRACK_PX_NARROW);
        expect(HERO_WAVEFORM_TRACK_PX).toBe(84);
        expect(HERO_WAVEFORM_TRACK_PX_NARROW).toBe(56);
    });

    it.each([
        ['320px viewport', 320, 56],
        ['375px viewport', 375, 56],
        ['414px viewport', 414, 56],
        ['768px viewport', 768, 84],
        ['1024px viewport', 1024, 84],
        ['1280px viewport', 1280, 84],
        ['1440px viewport', 1440, 84],
        ['1920px viewport', 1920, 84],
    ])('%s: exact line count, heights within the track with a 2px floor, and at least 25%% genuine silence', (_label, width, track) => {
        const lines = waveformLineCount(width);
        const heights = waveformLineHeights(lines, track);
        expect(heights).toHaveLength(Math.floor(width / 4));
        expect(Math.min(...heights)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...heights)).toBeLessThanOrEqual(track);
        expect(heights.filter((h) => h <= 4).length / heights.length).toBeGreaterThanOrEqual(0.25);
    });

    it('the first 62% of lines are highlighted', () => {
        expect(waveformHighlightCount(100)).toBe(62);
        expect(waveformHighlightCount(80)).toBe(Math.floor(80 * 0.62));
        expect(waveformHighlightCount(0)).toBe(0);
    });
});
