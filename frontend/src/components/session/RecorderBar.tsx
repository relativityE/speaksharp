import React from 'react';
import { Waveform } from './Waveform';
import { formatTimer } from '@/utils/sessionFormat';

/**
 * S-8 / `RECORDER_SPEC` §1, §5 — slot A in `during`. The mic card **collapses**; it does not move.
 *
 * Left to right: the **stop control leading at 58px**, because it is the only thing the user might need to
 * hit mid-run, so it sits where the mic was. Then one right-hand column carrying `● RECORDING` and the
 * timer on a single baseline, with the waveform filling the row beneath them.
 *
 * **The timer is small here, not 30px.** Mid-run the number that matters is the waveform confirming they
 * are heard; a 30px clock invites clock-watching mid-sentence.
 *
 * **No copy in this bar at all** (§5): no "tap to stop", no device name, no hint text. A red square and a
 * waveform need no caption, and the run is the one moment the user should be looking away from the screen.
 * The badge is confirmation of the state the red circle already carries, not the only signal.
 *
 * **One control, one position, three states** (§1): this red stop IS the mic button, recoloured and
 * reshaped — never a second button appearing beside it. The `aria-label` switches with the state and the
 * element keeps its 58px hit area, well above the 44px floor.
 */
export interface RecorderBarProps {
    elapsedSeconds: number;
    /** Amplitude levels 0..1, peak-per-bucket, normalised against the run's rolling peak by the container. */
    amplitudes: number[];
    /** How many leading lines are recorded — the signature/inactive boundary. */
    recordedCount: number;
    onStop: () => void;
}

export const RecorderBar: React.FC<RecorderBarProps> = ({ elapsedSeconds, amplitudes, recordedCount, onStop }) => (
    <div
        className="flex items-center gap-5 rounded-2xl border border-neutral-border bg-white px-6 py-5"
        data-testid="recorder-bar"
    >
        {/* The stop leads. `aria-pressed` reflects that recording is live; the label says what pressing does. */}
        <button
            type="button"
            onClick={onStop}
            data-testid="recorder-stop"
            aria-label="Stop recording"
            aria-pressed={true}
            className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full bg-record focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-record focus-visible:ring-offset-2"
            // The red glow is derived from the record role, never a second literal red.
            style={{ boxShadow: '0 6px 18px -6px color-mix(in srgb, var(--brand-record) 70%, transparent)' }}
        >
            <span aria-hidden="true" className="h-[19px] w-[19px] rounded-[3px] bg-white" />
        </button>

        <div className="min-w-0 flex-1">
            <div className="mb-2.5 flex items-baseline gap-2.5">
                <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[12px] font-extrabold tracking-[0.07em] text-record-text">
                    <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-record" />
                    RECORDING
                </span>
                <span
                    className="text-[16px] font-extrabold [font-variant-numeric:tabular-nums] text-neutral-body"
                    data-testid="recorder-timer"
                >
                    {formatTimer(elapsedSeconds)}
                </span>
            </div>
            <Waveform
                amplitudes={amplitudes}
                recordedCount={recordedCount}
                height={36}
                data-testid="recorder-waveform"
            />
        </div>
    </div>
);
