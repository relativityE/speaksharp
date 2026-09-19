/**
 * S-9 — the waveform's geometry and amplitude rules, as pure functions.
 *
 * This is the element most likely to read as fake, so the spec states the rules exactly and they are kept
 * out of the component to be asserted directly.
 *
 * **Sample count is derived from the track, never hardcoded.** `floor(trackWidth / 4)`: each line is 2px
 * wide and the leftover space becomes the gap, so a fixed count makes the rendered line-to-gap ratio a
 * function of container width — lines tuned in one track come out wider than their gaps in every narrower
 * one, which is the same failure as sizing the lines with `flex: 1`.
 *
 * **Amplitude is the PEAK of each bucket, never the mean.** A mean flattens a speech envelope into
 * mid-height mush. Speech has syllable bursts that rise and fall, near-silent samples at word boundaries,
 * and a few genuine phrase pauses — a track where every line has height reads as static, not speech. The
 * floor is expressed in pixels by the renderer so silence is still visible as a line.
 */

/** Each line is 2px wide; the 4px pitch leaves the remaining 2px as the gap the flex track distributes. */
export const LINE_PITCH_PX = 4;

/**
 * How many lines fit a track of this width. Recomputed on resize by the component; never hardcoded.
 * A track too narrow for a single line yields 0 — the caller renders nothing rather than one stray hairline.
 */
export function sampleCountForWidth(trackWidth: number): number {
    if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
    return Math.max(0, Math.floor(trackWidth / LINE_PITCH_PX));
}

/**
 * Downsample a captured amplitude buffer to `count` buckets, taking each bucket's PEAK.
 *
 * Returns levels in 0..1. An empty or absent buffer yields an empty array — the caller must not invent a
 * shape for audio it does not have.
 */
export function downsamplePeaks(buffer: ArrayLike<number>, count: number): number[] {
    const n = buffer.length;
    if (count <= 0 || n === 0) return [];
    const out: number[] = [];
    for (let i = 0; i < count; i += 1) {
        // Bucket boundaries spread the whole buffer across the requested count; the last bucket ends at n.
        const start = Math.floor((i * n) / count);
        const end = Math.max(start + 1, Math.floor(((i + 1) * n) / count));
        let peak = 0;
        for (let j = start; j < end && j < n; j += 1) {
            const v = Math.abs(buffer[j]);
            if (v > peak) peak = v;
        }
        out.push(Math.min(1, peak));
    }
    return out;
}

/**
 * The bucket that contains `sourceIndex` when `sourceLength` levels are downsampled to `count` buckets —
 * using EXACTLY the partition `downsamplePeaks` uses (bucket b starts at floor(b·n / count)). Anything that
 * marks a line (a filler, the recorded boundary) must land on the line whose peak contains that audio;
 * a separately rounded formula drifts one line early whenever n is not divisible by count.
 */
export function bucketForIndex(sourceIndex: number, sourceLength: number, count: number): number {
    if (count <= 0 || sourceLength <= 0) return 0;
    const start = (b: number) => Math.floor((b * sourceLength) / count);
    let b = Math.min(count - 1, Math.max(0, Math.floor((sourceIndex * count) / sourceLength)));
    while (b + 1 < count && start(b + 1) <= sourceIndex) b += 1;
    while (b > 0 && start(b) > sourceIndex) b -= 1;
    return b;
}
