import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { PlaybackScrubber } from '../PlaybackScrubber';

const amps = Array.from({ length: 10 }, () => 0.5);

// #1222 slot A (after) — scrubber: play toggle, mm:ss/mm:ss, filler-marked waveform, seek, no download.
describe('PlaybackScrubber (#1222 slot A after)', () => {
    const base = {
        playing: false,
        onTogglePlay: vi.fn(),
        positionSeconds: 0,
        durationSeconds: 124,
        amplitudes: amps,
        fillerBars: [3, 8],
        onSeek: vi.fn(),
    };

    it('shows play control, mm:ss / mm:ss and the filler legend', () => {
        render(<PlaybackScrubber {...base} positionSeconds={0} />);
        expect(screen.getByTestId('scrubber-play')).toHaveAccessibleName('Play');
        expect(screen.getByTestId('scrubber-time')).toHaveTextContent('00:00 / 02:04');
        expect(screen.getByTestId('scrubber-legend')).toHaveTextContent(/marks a filler/);
    });

    it('reflects the playing state and toggles', () => {
        const onTogglePlay = vi.fn();
        render(<PlaybackScrubber {...base} playing onTogglePlay={onTogglePlay} positionSeconds={62} />);
        expect(screen.getByTestId('scrubber-play')).toHaveAccessibleName('Pause');
        expect(screen.getByTestId('scrubber-time')).toHaveTextContent('01:02 / 02:04');
        fireEvent.click(screen.getByTestId('scrubber-play'));
        expect(onTogglePlay).toHaveBeenCalledOnce();
    });

    it('the waveform marks the filler positions and carries a playhead', () => {
        render(<PlaybackScrubber {...base} positionSeconds={62} />);
        const bars = screen.getAllByTestId('scrubber-waveform-bar');
        expect(bars[3].getAttribute('data-filler')).toBe('true');
        expect(screen.getByTestId('scrubber-waveform-playhead')).toBeInTheDocument();
    });

    it('offers NO audio download', () => {
        render(<PlaybackScrubber {...base} />);
        expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    });
});
