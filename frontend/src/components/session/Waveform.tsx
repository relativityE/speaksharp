import React from 'react';
import { sampleCountForWidth, downsamplePeaks, bucketForIndex } from './waveformGeometry';

/**
 * S-9 — the waveform, shared by the `during` recorder bar and the static shape kept in `after`.
 *
 * **Hairlines, not bars.** Each line is `width: 2px; flex-shrink: 0`, and the track is
 * `justify-content: space-between` so the leftover space becomes the gap. The previous rule was
 * `flex: 1; min-width: 2px`, which is wrong: `min-width` is a floor, not a width, so the lines grow to fill
 * and render as ~5px blocks with 2px gaps — lines wider than their gaps, which is the "looks fake" render.
 *
 * **Density carries the fineness.** The count is `floor(trackWidth / 4)` measured from this element and
 * recomputed on resize, never hardcoded: a fixed count fails the same way `flex: 1` does, because the
 * rendered line-to-gap ratio then depends on the container's width.
 *
 * **Centre-aligned, always.** Audio oscillates either side of zero; a waveform sitting on a baseline is a
 * bar chart. This single property does more for authenticity than any other.
 *
 * **Colour is a separate lookup from height.** `during`: index < recordedCount → signature, else the one
 * inactive grey. `after`: the whole shape is that same grey, with filler positions overriding both height
 * (full) and colour (signature). There is **no played/unplayed split in `after`**, because there is no
 * playhead and no playback — audio is never written to disk and never leaves the tab, so any transport
 * control would be a promise the product does not keep (S-11).
 */
export interface WaveformProps {
    /**
     * The source envelope, levels in 0..1, spanning the WHOLE take. When the track holds fewer lines than
     * there are levels, the component peak-downsamples the entire array to fit — it never truncates, which
     * would silently drop the end of the recording and any late filler.
     */
    amplitudes: number[];
    /** during: how many leading SOURCE levels are recorded (signature). Omit for the `after` resting shape. */
    recordedCount?: number;
    /** after: SOURCE indices sitting on a filler — full height, signature colour, in the otherwise flat shape. */
    fillerBars?: number[];
    /** Track height in px. The spec uses 34 in `during` and 30 for the static `after` shape. */
    height?: number;
    className?: string;
    'data-testid'?: string;
}

const SIGNATURE = 'var(--brand-signature)';
/**
 * ONE inactive grey, full stop (Designer, 17 Sep): the unrecorded tail in `during` and the whole resting
 * shape in `after` share it with the chart's baseline/past-run columns, because they mean the same thing —
 * a data mark that is no longer live. Two near-identical greys for one meaning is how a palette drifts, and
 * the drift stays invisible until someone has to choose between them.
 *
 * It is the `metric-inactive` DATA role, not a border token that happens to hold the same value: someone
 * retuning borders app-wide must not move a waveform, and the palette only stays coherent when the name
 * carries the reason.
 *
 * The recorded boundary is carried by yellow-against-grey. If a second grey ever seems necessary to make
 * that edge visible, the yellow is wrong.
 */
const INACTIVE = 'var(--brand-metric-inactive)';

/**
 * Height in px from a 0..1 level. Floored at 2px so a near-silent sample is still a visible line rather
 * than a gap — silence is part of the envelope, not missing data.
 */
const lineHeightPx = (level: number, trackHeight: number): number => {
    const clamped = Math.max(0, Math.min(1, level));
    return Math.max(2, Math.round(clamped * trackHeight));
};

export const Waveform: React.FC<WaveformProps> = ({
    amplitudes,
    recordedCount,
    fillerBars,
    height = 34,
    className,
    'data-testid': testId = 'waveform',
}) => {
    const trackRef = React.useRef<HTMLDivElement | null>(null);
    // Start at 0: nothing renders until the track has been measured, so the first paint can never be a
    // hardcoded count that happens to be wrong for this width.
    const [lineCount, setLineCount] = React.useState(0);

    React.useEffect(() => {
        const node = trackRef.current;
        if (!node) return;
        const measure = () => setLineCount(sampleCountForWidth(node.getBoundingClientRect().width));
        measure();
        if (typeof ResizeObserver !== 'function') return;
        // Debounced ~100ms: a resize storm must not re-render the track on every frame.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(measure, 100);
        });
        observer.observe(node);
        return () => {
            if (timer) clearTimeout(timer);
            observer.disconnect();
        };
    }, []);

    const isAfter = typeof recordedCount !== 'number';
    const sourceLength = amplitudes.length;

    // The lines this track can hold, capped by the levels we actually have. Never pad with invented levels.
    const rendered = Math.min(lineCount, sourceLength);
    const compressed = rendered < sourceLength;

    // Fit the WHOLE source to the track: each line is the peak of its bucket, so the end of the take and
    // any late filler survive a narrow track.
    const levels = React.useMemo(
        () => (compressed ? downsamplePeaks(amplitudes, rendered) : amplitudes),
        [amplitudes, rendered, compressed],
    );

    // A source index lands in the bucket that contains it — the SAME partition `downsamplePeaks` uses.
    const lineFor = React.useCallback(
        (sourceIndex: number) => (compressed
            ? bucketForIndex(sourceIndex, sourceLength, rendered)
            : sourceIndex),
        [compressed, rendered, sourceLength],
    );
    const fillerSet = React.useMemo(
        () => new Set((fillerBars ?? []).filter((i) => i >= 0 && i < sourceLength).map(lineFor)),
        [fillerBars, sourceLength, lineFor],
    );
    // A line is recorded when any of its bucket is: round the boundary up, so a partly recorded bucket
    // reads as recorded rather than the live edge lagging a line behind.
    const recordedLines = compressed
        ? Math.ceil(((recordedCount ?? 0) * rendered) / sourceLength)
        : (recordedCount ?? 0);

    const colorFor = (i: number): string => {
        if (isAfter) return fillerSet.has(i) ? SIGNATURE : INACTIVE;
        return i < recordedLines ? SIGNATURE : INACTIVE;
    };

    return (
        <div
            ref={trackRef}
            className={className}
            data-testid={testId}
            data-line-count={rendered}
            aria-hidden="true"
            style={{
                display: 'flex',
                // Centre-mirrored: the lines sit either side of a centre axis, not on a baseline.
                alignItems: 'center',
                // The leftover space becomes the gap; the lines themselves never grow.
                justifyContent: 'space-between',
                height,
                width: '100%',
                minWidth: 0,
                overflow: 'hidden',
            }}
        >
            {Array.from({ length: rendered }, (_, i) => (
                <span
                    key={i}
                    data-testid={`${testId}-line`}
                    data-recorded={isAfter ? undefined : i < recordedLines}
                    data-filler={fillerSet.has(i) || undefined}
                    style={{
                        width: 2,
                        flexShrink: 0,
                        // A filler in the static shape is a HEIGHT override — full height — so a marked
                        // filler is unmissable against the flat resting lines.
                        height: isAfter && fillerSet.has(i) ? height : lineHeightPx(levels[i], height),
                        borderRadius: 1,
                        backgroundColor: colorFor(i),
                    }}
                />
            ))}
        </div>
    );
};
