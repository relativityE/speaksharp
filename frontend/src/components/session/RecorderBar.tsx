import React from 'react';
import { Waveform } from './Waveform';
import { formatTimer } from '@/utils/sessionFormat';

/**
 * #1222 slot A (during) — the mic card collapsed to a recorder bar (spec §4). Same slot as the `before`
 * mic card; it does not move, it resizes. Left→right: `● RECORDING` · timer (30px/800 tabular-nums) ·
 * waveform · device name · `■ Stop` on a `#241503` fill.
 *
 * Presentational: `elapsedSeconds`, `amplitudes`/`recordedCount` and the stop handler come from the
 * container. Format the timer as mm:ss.
 */
export interface RecorderBarProps {
    elapsedSeconds: number;
    amplitudes: number[];
    recordedCount: number;
    deviceLabel?: string;
    onStop: () => void;
}

export const RecorderBar: React.FC<RecorderBarProps> = ({ elapsedSeconds, amplitudes, recordedCount, deviceLabel, onStop }) => {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#dbe2ec] bg-white px-4 py-3 sm:gap-4" data-testid="recorder-bar">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-extrabold text-[#a8321f]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#d13c25]" aria-hidden="true" />
                RECORDING
            </span>

            <span className="text-[22px] font-extrabold leading-none [font-variant-numeric:tabular-nums] text-[#1f2733] sm:text-[30px]" data-testid="recorder-timer">
                {formatTimer(elapsedSeconds)}
            </span>

            {/* On phones the recorder bar wraps, and the waveform must take its OWN full-width row: on a
                shared row it is squeezed narrower than its ~72 bars' 1px-min content and overflows the
                viewport (#1270). `w-full` forces the wrap to a full-width track (~all bars fit ≥143px);
                from `sm` up there is room, so it returns to an inline growing column. */}
            <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <Waveform amplitudes={amplitudes} recordedCount={recordedCount} data-testid="recorder-waveform" />
            </div>

            {deviceLabel && (
                <span className="whitespace-nowrap text-[12px] text-[#414b5c]" data-testid="recorder-device">{deviceLabel}</span>
            )}

            <button
                type="button"
                onClick={onStop}
                data-testid="recorder-stop"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#241503] px-3 py-2 text-[13px] font-bold text-white hover:opacity-90"
            >
                <span aria-hidden="true">■</span> Stop
            </button>
        </div>
    );
};
