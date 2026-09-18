import React from 'react';
import { Waveform } from './Waveform';
import { formatTimer } from '@/utils/sessionFormat';

/**
 * S-11 / `RECORDER_SPEC` §1, §4 — slot A in `after`. **The mic returns, in place, smaller.**
 *
 * This component replaces `PlaybackScrubber` outright. That component was a transport — play button,
 * elapsed/total readout, travelling playhead, per-line seek — with an `audioAvailable` flag that merely
 * hid the controls. Hiding them was the wrong shape: **audio is never written to disk and never leaves the
 * tab**, so there is nothing to play, and a hidden transport is a promise waiting to be re-enabled by
 * someone who does not know why it was switched off.
 *
 * So, deliberately absent: no play button, no scrubber, no playhead, no seek, no download, and **no
 * elapsed/total timecode** — the final duration only. The waveform here is a *picture of the run*.
 *
 * The mic is the same fill, glyph and halo as `before`, only scaled to sit in this row (§1): the run is
 * over, so the button is once again the way to start another, and the product's logo is never the element
 * that disappears.
 */
export interface RunShapeProps {
    /** The run's final duration. Shown alone — never as `elapsed / total`. */
    durationSeconds: number;
    /** Amplitude levels 0..1, peak-per-bucket, for the whole run. */
    amplitudes: number[];
    /** Line indices sitting on a filler: full height and signature colour in the flat resting shape. */
    fillerBars?: number[];
    /** Start the next run. This is the same control the `before` state carries, at 42px instead of 76px. */
    onStart: () => void;
    /** Hide the filler legend where fillers are not marked (Focus Points keeps the shape amplitude-only). */
    showFillerLegend?: boolean;
}

export const RunShape: React.FC<RunShapeProps> = ({
    durationSeconds, amplitudes, fillerBars, onStart, showFillerLegend = true,
}) => (
    <div
        className="flex items-center gap-5 rounded-[14px] border border-neutral-border bg-white px-[22px] py-3.5"
        data-testid="run-shape"
    >
        <button
            type="button"
            onClick={onStart}
            data-testid="run-shape-mic"
            aria-label="Start recording"
            aria-pressed={false}
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-signature focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2"
            // The same halo as `before`, one step tighter (5px against 8px). Derived from the signature
            // role rather than a second literal yellow.
            style={{ boxShadow: '0 0 0 5px color-mix(in srgb, var(--brand-signature) 20%, transparent)' }}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="2" width="6" height="11" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="17" x2="12" y2="21" />
                <line x1="8.5" y1="21" x2="15.5" y2="21" />
            </svg>
        </button>

        {/* The final duration, alone. An elapsed/total pair would imply a position in something playing. */}
        <span
            className="whitespace-nowrap text-[15px] font-extrabold [font-variant-numeric:tabular-nums] text-neutral-body"
            data-testid="run-shape-duration"
        >
            {formatTimer(durationSeconds)}
        </span>

        <Waveform
            amplitudes={amplitudes}
            fillerBars={fillerBars}
            height={34}
            className="flex-1"
            data-testid="run-shape-waveform"
        />

        {showFillerLegend && (
            <span
                className="shrink-0 whitespace-nowrap text-[12px] font-bold text-neutral-muted"
                data-testid="run-shape-legend"
            >
                ▮ marks a filler
            </span>
        )}
    </div>
);
