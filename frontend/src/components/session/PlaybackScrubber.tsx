import React from 'react';
import { Waveform } from './Waveform';
import { formatTimer } from '@/utils/sessionFormat';

/**
 * #1222 slot A (after) — the recorder bar resolved to a playback scrubber, in place (spec §5). Same slot,
 * it does not move. Orange play button (42px) · `mm:ss / mm:ss` tabular · the full waveform, now grey with
 * **filler positions left orange** · a travelling playhead · a `▮ marks a filler` legend.
 *
 * There is NO audio download — audio is for review inside the session only. Presentational: playback state
 * and seeking come from the container.
 *
 * `audioAvailable={false}` (PO 2026-08-08, transcript-only review): the app retains no audio, so the play
 * button, time readout and travelling playhead are omitted; the waveform stays as a static filler MAP and
 * the legend still reads "▮ marks a filler". Clicking a bar then seeks the TRANSCRIPT, not audio.
 */
export interface PlaybackScrubberProps {
    playing: boolean;
    onTogglePlay: () => void;
    positionSeconds: number;
    durationSeconds: number;
    amplitudes: number[];
    /** Waveform bar indices that sit on a filler (stay orange in the grey resting track). */
    fillerBars: number[];
    /** Seek to a 0..1 fraction of the track. */
    onSeek: (fraction: number) => void;
    /** When false, hide audio-playback affordances (no retained audio). Default true. */
    audioAvailable?: boolean;
}

export const PlaybackScrubber: React.FC<PlaybackScrubberProps> = ({
    playing,
    onTogglePlay,
    positionSeconds,
    durationSeconds,
    amplitudes,
    fillerBars,
    onSeek,
    audioAvailable = true,
}) => {
    const played = durationSeconds > 0 ? positionSeconds / durationSeconds : 0;

    return (
        <div className="rounded-xl border border-[#dbe2ec] bg-white px-4 py-3" data-testid="playback-scrubber">
            <div className="flex items-center gap-3">
                {audioAvailable && (
                    <button
                        type="button"
                        onClick={onTogglePlay}
                        data-testid="scrubber-play"
                        aria-label={playing ? 'Pause' : 'Play'}
                        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-[#d98a1f] text-[16px] text-[#241503]"
                    >
                        <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
                    </button>
                )}

                {audioAvailable && (
                    <span className="text-[13px] font-semibold [font-variant-numeric:tabular-nums] text-[#1f2733]" data-testid="scrubber-time">
                        {formatTimer(positionSeconds)} / {formatTimer(durationSeconds)}
                    </span>
                )}

                <div className="min-w-0 flex-1">
                    <Waveform
                        amplitudes={amplitudes}
                        fillerBars={fillerBars}
                        playedFraction={audioAvailable ? played : undefined}
                        onSeek={onSeek}
                        data-testid="scrubber-waveform"
                    />
                </div>
            </div>

            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#414b5c]" data-testid="scrubber-legend">
                <span aria-hidden="true" style={{ color: '#d98a1f' }}>▮</span> marks a filler
            </p>
        </div>
    );
};
