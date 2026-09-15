/**
 * #1475 — the G12 hero waveform is DECORATIVE and DETERMINISTIC. It is never a recording, never live, and never
 * randomized per render or hydration: the envelope below is generated once, from a fixed seed, at module load, so
 * every visitor and every render sees the same shape.
 *
 * Geometry contract:
 * - an 84px track; 2px bars on a 4px pitch, so the bar count is `floor(trackWidth / 4)`;
 * - the envelope is downsampled by the PEAK of each bucket (a mean would flatten syllables into mush);
 * - genuine phrase pauses are kept: silence samples are `0.02 + rnd() * 0.025`, which render at or below 4px;
 * - the first 62% of bars are highlighted.
 */

export const HERO_WAVEFORM_TRACK_PX = 84;
export const HERO_WAVEFORM_BAR_PITCH_PX = 4;
export const HERO_WAVEFORM_HIGHLIGHT_FRACTION = 0.62;

const ENVELOPE_SAMPLES = 1200;
const ENVELOPE_SEED = 0x5eed1475;

/** Small seeded PRNG (mulberry32): the same seed always yields the same sequence. */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildEnvelope(): readonly number[] {
    const rnd = seededRandom(ENVELOPE_SEED);
    const samples: number[] = [];
    while (samples.length < ENVELOPE_SAMPLES) {
        // A spoken phrase: syllable pulses under a rise-and-fall contour.
        const phraseLength = 40 + Math.floor(rnd() * 60);
        const phrasePeak = 0.45 + rnd() * 0.5;
        for (let k = 0; k < phraseLength && samples.length < ENVELOPE_SAMPLES; k += 1) {
            const contour = Math.sin((Math.PI * (k + 0.5)) / phraseLength);
            const syllable = 0.35 + 0.65 * Math.abs(Math.sin(k * 0.9 + rnd() * 0.6));
            samples.push(Math.min(1, phrasePeak * contour * syllable + rnd() * 0.06));
        }
        // A genuine pause between phrases.
        const pauseLength = 35 + Math.floor(rnd() * 50);
        for (let k = 0; k < pauseLength && samples.length < ENVELOPE_SAMPLES; k += 1) {
            samples.push(0.02 + rnd() * 0.025);
        }
    }
    return Object.freeze(samples);
}

/** The committed, normalized (0..1) envelope every hero render draws from. */
export const HERO_WAVEFORM_ENVELOPE: readonly number[] = buildEnvelope();

/** Bars that fit a track of this width on a 4px pitch. Invalid or non-positive widths render none. */
export function waveformBarCount(trackWidth: number): number {
    if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
    return Math.floor(trackWidth / HERO_WAVEFORM_BAR_PITCH_PX);
}

/** Pixel heights for `barCount` bars: peak per bucket, amplitude clamped to 0..1, at least 1px so every bar shows. */
export function buildWaveformBars(envelope: readonly number[], barCount: number): number[] {
    if (!Number.isFinite(barCount) || barCount <= 0 || envelope.length === 0) return [];
    const count = Math.floor(barCount);
    const bars: number[] = [];
    for (let bar = 0; bar < count; bar += 1) {
        const start = Math.floor((bar * envelope.length) / count);
        const end = Math.max(start + 1, Math.floor(((bar + 1) * envelope.length) / count));
        let peak = 0;
        for (let i = start; i < end && i < envelope.length; i += 1) {
            const amplitude = Math.min(1, Math.max(0, envelope[i]));
            if (amplitude > peak) peak = amplitude;
        }
        bars.push(Math.max(1, Math.round(peak * HERO_WAVEFORM_TRACK_PX)));
    }
    return bars;
}

/** How many leading bars take the highlight colour. */
export function waveformHighlightCount(barCount: number): number {
    if (!Number.isFinite(barCount) || barCount <= 0) return 0;
    return Math.floor(barCount * HERO_WAVEFORM_HIGHLIGHT_FRACTION);
}
