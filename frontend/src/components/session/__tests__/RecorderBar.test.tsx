import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { RecorderBar } from '../RecorderBar';
import { formatTimer } from '@/utils/sessionFormat';

const amps = Array.from({ length: 8 }, () => 0.5);

describe('formatTimer', () => {
    it('formats seconds as mm:ss', () => {
        expect(formatTimer(0)).toBe('00:00');
        expect(formatTimer(72)).toBe('01:12');
        expect(formatTimer(605)).toBe('10:05');
    });
});

// #1222 slot A (during) — recorder bar with RECORDING marker, timer, waveform, stop.
describe('RecorderBar (#1222 slot A during)', () => {
    it('shows the RECORDING marker, mm:ss timer, waveform and Stop', () => {
        render(<RecorderBar elapsedSeconds={72} amplitudes={amps} recordedCount={5} deviceLabel="Built-in Mic" onStop={vi.fn()} />);
        expect(screen.getByText('RECORDING')).toBeInTheDocument();
        expect(screen.getByTestId('recorder-timer')).toHaveTextContent('01:12');
        expect(screen.getByTestId('recorder-waveform')).toBeInTheDocument();
        expect(screen.getByTestId('recorder-device')).toHaveTextContent('Built-in Mic');
        expect(screen.getByTestId('recorder-stop')).toHaveAccessibleName('Stop recording');
        expect(screen.getByTestId('recorder-stop')).toHaveClass('h-[58px]', 'w-[58px]', 'rounded-full', 'bg-[#d13c25]');
    });

    it('Stop fires the handler', () => {
        const onStop = vi.fn();
        render(<RecorderBar elapsedSeconds={5} amplitudes={amps} recordedCount={1} onStop={onStop} />);
        fireEvent.click(screen.getByTestId('recorder-stop'));
        expect(onStop).toHaveBeenCalledOnce();
    });
});
