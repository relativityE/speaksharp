import { render, screen, fireEvent, cleanup } from '../../../../tests/support/test-utils';
import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunShape } from '../RunShape';

/**
 * S-11 / `RECORDER_SPEC` §1, §4 — slot A in `after`: the mic returns, in place, smaller, and the run is a
 * PICTURE, not a transport.
 *
 * This component replaced `PlaybackScrubber`, which was a play/seek/playhead transport whose controls were
 * merely hidden behind an `audioAvailable` flag. Audio is never written to disk and never leaves the tab,
 * so the absence has to be structural: a hidden transport is a promise waiting to be re-enabled by someone
 * who does not know why it was switched off.
 */
const amps = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? 0.05 : 0.6));

function stubTrackWidth(width: number) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { width, height: 34, top: 0, left: 0, right: width, bottom: 34, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
}

describe('RunShape — the mic returns and the run is a picture (S-11)', () => {
    let rect: ReturnType<typeof stubTrackWidth>;
    beforeEach(() => { rect = stubTrackWidth(400); });
    afterEach(() => { rect.mockRestore(); cleanup(); });

    const render1 = (over: Partial<React.ComponentProps<typeof RunShape>> = {}) => render(
        <RunShape durationSeconds={124} amplitudes={amps} fillerBars={[5, 20]} onStart={vi.fn()} {...over} />,
    );

    it('renders the mic at 42px with the signature fill, and it starts the next run', () => {
        const onStart = vi.fn();
        render1({ onStart });
        const mic = screen.getByTestId('run-shape-mic');
        expect(mic).toHaveAccessibleName('Start recording');
        expect(mic).toHaveClass('h-[42px]', 'w-[42px]', 'rounded-full', 'bg-signature');
        // The same control as `before`, not a second button: it reports that recording is NOT live.
        expect(mic).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(mic);
        expect(onStart).toHaveBeenCalledOnce();
    });

    it('shows the FINAL duration alone', () => {
        render1();
        expect(screen.getByTestId('run-shape-duration')).toHaveTextContent('02:04');
    });

    it('CASUALTY: no transport of any kind — no play, seek, scrubber, playhead, download or elapsed/total pair', () => {
        const { container } = render1();
        expect(screen.queryByTestId('playback-scrubber')).toBeNull();
        expect(screen.queryByTestId('run-shape-waveform-playhead')).toBeNull();
        for (const name of [/play/i, /pause/i, /seek/i, /download/i, /rewind/i]) {
            expect(screen.queryByRole('button', { name })).toBeNull();
        }
        // The mic is the ONLY button in the row.
        expect(container.querySelectorAll('button')).toHaveLength(1);
        // And no `00:00 / 02:04` timecode pair anywhere.
        expect(screen.getByTestId('run-shape').textContent ?? '').not.toMatch(/\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}/);
    });

    it('CASUALTY: the copy carries no playback promise', () => {
        const text = render1().getByTestId('run-shape').textContent ?? '';
        expect(text).not.toMatch(/hear it|listen|replay|tap a highlight/i);
        expect(screen.getByTestId('run-shape-legend')).toHaveTextContent('▮ marks a filler');
    });

    it('marks filler positions in the static shape, and drops the legend where fillers are not marked', () => {
        render1();
        const lines = screen.getAllByTestId('run-shape-waveform-line');
        expect(lines[5]).toHaveAttribute('data-filler', 'true');
        expect(lines[5].style.backgroundColor).toBe('var(--brand-signature)');
        cleanup();
        // Focus Points keeps the shape amplitude-only, so a filler legend would describe nothing.
        render1({ fillerBars: [], showFillerLegend: false });
        expect(screen.queryByTestId('run-shape-legend')).toBeNull();
    });

    it('CASUALTY: on a phone the row wraps and the track keeps a floor width, so the run is never squeezed to nothing', () => {
        // Found in a real browser at 320px: mic + duration + a nowrap legend took the whole row and the
        // flex-1 track collapsed to ~0px. jsdom has no layout, so the structural guarantees are asserted.
        render1();
        expect(screen.getByTestId('run-shape').className).toContain('flex-wrap');
        const track = screen.getByTestId('run-shape-track');
        expect(track.className).toContain('min-w-[96px]');
        expect(track).toContainElement(screen.getByTestId('run-shape-waveform'));
    });
});
