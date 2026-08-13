import React from 'react';

/**
 * #1222 — the waveform, shared by the `during` recorder bar and the `after` scrubber (spec §4).
 *
 * Hard rule: bars are `flex: 1; min-width: 1px` with a 1px gap (thin enough that all ~72 bars fit a 320px track without clipping) — **never a fixed width**, or the track
 * won't fill and the playhead will disagree with the audio. ~72 bars. Recorded audio is orange
 * (`#d98a1f`); the un-recorded tail is `#e0e6ee`.
 *
 * Two modes:
 *   • during  → `recordedCount` bars are orange (growing left→right), the rest are the grey tail.
 *   • after   → all bars grey EXCEPT optional `fillerBars` (orange Open Mic positions). Optional playback
 *              consumers may supply `playedFraction`/`onSeek`; the transcript-only product review does not.
 */
export interface WaveformProps {
    /** Per-bar heights, 0..1. Length defines the bar count (~72). */
    amplitudes: number[];
    /** during: how many leading bars are recorded (orange). */
    recordedCount?: number;
    /** after: indices that sit on a filler (left orange even in the grey resting track). */
    fillerBars?: number[];
    /** after: 0..1 playback position; draws the playhead and seeking. */
    playedFraction?: number;
    /** after: seek to a bar; receives 0..1. */
    onSeek?: (fraction: number) => void;
    className?: string;
    'data-testid'?: string;
}

const ORANGE = '#d98a1f';
const TAIL = '#e0e6ee';
const TRACK_HEIGHT = 40;
// #4: height is a separate function of the level, in PX (not a % that floors into flat mush).
// height = 4 + level*30, clamped. A filler bar in the after-state is a HEIGHT override — full height,
// so "marks a filler" is visually unmissable against the short grey resting bars.
const barHeightPx = (level: number): number => Math.max(4, Math.min(TRACK_HEIGHT, Math.round(4 + level * 30)));

export const Waveform: React.FC<WaveformProps> = ({
    amplitudes,
    recordedCount,
    fillerBars,
    playedFraction,
    onSeek,
    className,
    'data-testid': testId = 'waveform',
}) => {
    const fillerSet = React.useMemo(() => new Set(fillerBars ?? []), [fillerBars]);
    const n = amplitudes.length;
    const seekable = typeof onSeek === 'function';

    const colorFor = (i: number): string => {
        // during: leading `recordedCount` bars orange.
        if (typeof recordedCount === 'number') return i < recordedCount ? ORANGE : TAIL;
        // after: resting grey with orange fillers.
        return fillerSet.has(i) ? ORANGE : TAIL;
    };

    return (
        <div
            className={className}
            data-testid={testId}
            // minWidth: 0 so this flex track never forces its own min-content (all bars' 1px minimums)
            // onto a constrained flex parent — the track shrinks with its column instead of overflowing.
            style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 1, height: TRACK_HEIGHT, width: '100%', minWidth: 0 }}
        >
            {amplitudes.map((a, i) => {
                // after-state fillers are full height (a deliberate override, not their amplitude); every
                // other bar's height is 4 + level*30 px.
                const isAfterFiller = typeof recordedCount !== 'number' && fillerSet.has(i);
                const heightPx = isAfterFiller ? TRACK_HEIGHT : barHeightPx(a);
                const bar = (
                    <span
                        key={i}
                        data-testid={`${testId}-bar`}
                        data-recorded={typeof recordedCount === 'number' ? i < recordedCount : undefined}
                        data-filler={fillerSet.has(i) || undefined}
                        style={{
                            flex: '1 1 0',
                            minWidth: 1,
                            height: heightPx,
                            backgroundColor: colorFor(i),
                            borderRadius: 1,
                        }}
                    />
                );
                if (!seekable) return bar;
                return (
                    <button
                        key={i}
                        type="button"
                        aria-label={`Seek to ${Math.round((i / Math.max(1, n - 1)) * 100)}%`}
                        onClick={() => onSeek?.(n > 1 ? i / (n - 1) : 0)}
                        style={{ flex: '1 1 0', minWidth: 1, height: '100%', display: 'flex', alignItems: 'flex-end', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}
                    >
                        {bar}
                    </button>
                );
            })}

            {typeof playedFraction === 'number' && (
                <span
                    aria-hidden="true"
                    data-testid={`${testId}-playhead`}
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${Math.max(0, Math.min(1, playedFraction)) * 100}%`,
                        width: 2,
                        backgroundColor: '#241503',
                    }}
                />
            )}
        </div>
    );
};
