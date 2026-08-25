/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecorderBar } from '../RecorderBar';
import { RECORDER_BAR, RECORDER_STOP, RETIRED_COMBINED_CONTROL } from '../../../../../tests/helpers/micControls';

/**
 * #1306 — RENDERED-STATE contract for the desktop `during` slot.
 *
 * The proof stopped recording by clicking the same control it started with, then asserted
 * `data-recording="false"` on it. Neither is real: start and stop are SPLIT (#1222/#1231), RecorderBar
 * REPLACES MicCard rather than toggling it, and no desktop control carries a `data-recording`
 * attribute at all. The post-stop assertion was therefore an assertion about an element that had been
 * unmounted — it could only ever pass vacuously or time out.
 *
 * This pins the two ids the live helper waits on, and the absence of the attribute it used to read.
 */
const props = { elapsedSeconds: 12, amplitudes: [0.2, 0.6], recordedCount: 2 };

describe('RecorderBar — the during-state control', () => {
    it('renders the recorder bar and an enabled stop control', () => {
        render(<RecorderBar {...props} onStop={vi.fn()} />);
        expect(screen.getByTestId(RECORDER_BAR)).toBeInTheDocument();
        expect(screen.getByTestId(RECORDER_STOP)).toBeEnabled();
    });

    it('clicking stop invokes onStop exactly once', () => {
        const onStop = vi.fn();
        render(<RecorderBar {...props} onStop={onStop} />);
        fireEvent.click(screen.getByTestId(RECORDER_STOP));
        expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('renders neither the retired combined control nor any data-recording attribute', () => {
        // Both are what the stale proof assertions depended on. Keeping this explicit means restoring
        // either one fails here instead of during a production dispatch.
        const { container } = render(<RecorderBar {...props} onStop={vi.fn()} />);
        expect(screen.queryByTestId(RETIRED_COMBINED_CONTROL)).not.toBeInTheDocument();
        expect(container.querySelector('[data-recording]')).toBeNull();
    });

    it('does not render the before-state start control — the slot is replaced, not toggled', () => {
        render(<RecorderBar {...props} onStop={vi.fn()} />);
        for (const before of ['mic-start', 'mic-download', 'mic-retry']) {
            expect(screen.queryByTestId(before), `${before} must not co-exist with the recorder`).not.toBeInTheDocument();
        }
    });
});
