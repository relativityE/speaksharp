import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { Waveform } from '../Waveform';

const amps = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? 0.9 : 0.4));

// #1222 §4 — bars flex:1 min-width:2px (fill the track); recorded=orange, tail grey; fillers stay orange; playhead + seek.
describe('Waveform (#1222 §4)', () => {
    it('every bar flexes to fill the track (flex:1, min-width:2px) — never a fixed width', () => {
        render(<Waveform amplitudes={amps} recordedCount={4} />);
        const bars = screen.getAllByTestId('waveform-bar');
        expect(bars).toHaveLength(12);
        for (const bar of bars) {
            expect(bar).toHaveStyle({ flex: '1 1 0', minWidth: '2px' });
        }
    });

    it('during: leading recordedCount bars are recorded (orange), the rest are the grey tail', () => {
        render(<Waveform amplitudes={amps} recordedCount={4} />);
        const bars = screen.getAllByTestId('waveform-bar');
        expect(bars.filter((b) => b.getAttribute('data-recorded') === 'true')).toHaveLength(4);
        expect(bars[0]).toHaveStyle({ backgroundColor: 'rgb(217, 138, 31)' }); // #d98a1f
        expect(bars[11]).toHaveStyle({ backgroundColor: 'rgb(224, 230, 238)' }); // #e0e6ee tail
    });

    it('after: resting grey track with orange filler positions + a travelling playhead', () => {
        render(<Waveform amplitudes={amps} fillerBars={[2, 7]} playedFraction={0.5} />);
        const bars = screen.getAllByTestId('waveform-bar');
        expect(bars[2].getAttribute('data-filler')).toBe('true');
        expect(bars[2]).toHaveStyle({ backgroundColor: 'rgb(217, 138, 31)' });
        expect(bars[3].getAttribute('data-filler')).toBeNull();
        const playhead = screen.getByTestId('waveform-playhead');
        expect(playhead).toHaveStyle({ left: '50%' });
    });

    it('after: clicking a bar seeks to its fraction', () => {
        const onSeek = vi.fn();
        render(<Waveform amplitudes={amps} fillerBars={[2]} onSeek={onSeek} />);
        const seekButtons = screen.getAllByRole('button', { name: /Seek to/ });
        fireEvent.click(seekButtons[seekButtons.length - 1]); // last bar → fraction 1
        expect(onSeek).toHaveBeenCalledWith(1);
    });
});
