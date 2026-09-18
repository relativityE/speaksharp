/**
 * #1475 G12 Rev 2 §4 — the hero waveform is DECORATION, not data: no recording sits behind it. It is generated from
 * a fixed seed so the same shape renders on every load, for every visitor, on server and client.
 *
 * - `N = floor(trackWidth / 4)`, recomputed on resize; the envelope is REGENERATED for the new N with the same seed,
 *   never resampled or interpolated (interpolation smooths away the silences that make it read as speech).
 * - Syllable bursts rise and fall over 5–13 samples; 2–4 sample word boundaries and three phrase pauses stay
 *   near-silent. PM corrections: amplitude is clamped to 1, and silence/gap samples are `0.02 + rnd() * 0.025`.
 * - Line height is `max(2, round(amplitude * trackHeight))`; the first 62% of lines take the signature colour.
 */

export const HERO_WAVEFORM_SEED = 9;
export const HERO_WAVEFORM_TRACK_PX = 84;
export const HERO_WAVEFORM_TRACK_PX_NARROW = 56;
export const HERO_WAVEFORM_NARROW_BELOW_PX = 768;
export const HERO_WAVEFORM_LINE_PITCH_PX = 4;
export const HERO_WAVEFORM_HIGHLIGHT_FRACTION = 0.62;

const silence = (rnd: () => number): number => 0.02 + rnd() * 0.025;

/** Rev 2 §4.3 seeded speech envelope (LCG — no Math.random), with the PM clamp and silence corrections. */
export function heroEnvelope(n: number, seed: number = HERO_WAVEFORM_SEED): number[] {
    const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const values: number[] = [];
    const pauseWidth = Math.max(2, Math.round(count * 0.03));
    const pauses = [0.30, 0.55, 0.78].map((p) => Math.floor(count * p)); // phrase breaks
    while (values.length < count) {
        if (pauses.some((p) => Math.abs(values.length - p) < pauseWidth)) {
            values.push(silence(rnd)); // near-silence
            continue;
        }
        const length = 5 + Math.floor(rnd() * 9); // one syllable
        const peak = 0.30 + rnd() * 0.70;
        for (let k = 0; k < length && values.length < count; k += 1) {
            const burst = peak * Math.sin(((k + 0.5) / length) * Math.PI) * (0.7 + rnd() * 0.45);
            values.push(Math.min(1, Math.max(0.05, burst)));
        }
        const gap = 2 + Math.floor(rnd() * 3); // word boundary
        for (let k = 0; k < gap && values.length < count; k += 1) values.push(silence(rnd));
    }
    return values.slice(0, count);
}

/** Lines that fit a track of this width on a 4px pitch. Invalid or non-positive widths render none. */
export function waveformLineCount(trackWidth: number): number {
    if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
    return Math.floor(trackWidth / HERO_WAVEFORM_LINE_PITCH_PX);
}

/** Track height for the viewport: 84px, reduced to 56px below 768px. */
export function waveformTrackHeight(viewportWidth: number): number {
    return viewportWidth < HERO_WAVEFORM_NARROW_BELOW_PX ? HERO_WAVEFORM_TRACK_PX_NARROW : HERO_WAVEFORM_TRACK_PX;
}

/** Pixel heights for `lineCount` lines on a track of `trackHeight`: floor 2px, never taller than the track. */
export function waveformLineHeights(lineCount: number, trackHeight: number = HERO_WAVEFORM_TRACK_PX): number[] {
    return heroEnvelope(lineCount).map((amplitude) =>
        Math.max(2, Math.round(Math.min(1, Math.max(0, amplitude)) * trackHeight)));
}

/** How many leading lines take the signature colour. */
export function waveformHighlightCount(lineCount: number): number {
    if (!Number.isFinite(lineCount) || lineCount <= 0) return 0;
    return Math.floor(lineCount * HERO_WAVEFORM_HIGHLIGHT_FRACTION);
}
