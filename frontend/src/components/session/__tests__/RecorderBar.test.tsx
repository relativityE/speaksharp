import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import * as React from 'react';
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

/**
 * S-8 / `RECORDER_SPEC` §1, §5 — slot A collapses to a bar; it does not move.
 */
describe('RecorderBar — the collapsed recorder (S-8)', () => {
    const render1 = (over: Partial<React.ComponentProps<typeof RecorderBar>> = {}) => render(
        <RecorderBar elapsedSeconds={72} amplitudes={amps} recordedCount={5} onStop={vi.fn()} {...over} />,
    );

    it('leads with the stop control, then the badge, timer and waveform', () => {
        render1();
        const stop = screen.getByTestId('recorder-stop');
        expect(stop).toHaveAccessibleName('Stop recording');
        expect(stop).toHaveClass('h-[58px]', 'w-[58px]', 'rounded-full', 'bg-record');
        expect(screen.getByText('RECORDING')).toBeInTheDocument();
        expect(screen.getByTestId('recorder-timer')).toHaveTextContent('01:12');
        expect(screen.getByTestId('recorder-waveform')).toBeInTheDocument();
        // The stop precedes the right-hand column in DOM order, where the mic was.
        const bar = screen.getByTestId('recorder-bar');
        expect(bar.firstElementChild).toBe(stop);
    });

    it('CASUALTY: the timer is SMALL here, never the 30px clock', () => {
        // Mid-run the number that matters is the waveform confirming they are heard; a 30px clock invites
        // clock-watching mid-sentence.
        const timer = render1().getByTestId('recorder-timer');
        expect(timer.className).toContain('text-[16px]');
        expect(timer.className).not.toMatch(/text-\[(2[0-9]|30)px\]/);
    });

    it('CASUALTY: there is NO copy in the bar — no hint text and no device name', () => {
        render1();
        expect(screen.queryByTestId('recorder-device')).toBeNull();
        const text = screen.getByTestId('recorder-bar').textContent ?? '';
        // Only the badge and the timer carry text.
        expect(text.replace(/RECORDING|01:12/g, '').trim()).toBe('');
        expect(text).not.toMatch(/tap to stop|stop recording|mic|built-in/i);
    });

    it('the stop is one control that reports its state, and it fires the handler', () => {
        const onStop = vi.fn();
        render1({ onStop });
        const stop = screen.getByTestId('recorder-stop');
        expect(stop).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(stop);
        expect(onStop).toHaveBeenCalledOnce();
    });

    it('CASUALTY: the stop is the red circle with a white square — never a dark fill', () => {
        // Black reads as disabled in this palette; red-circle-white-square is the control users know.
        const stop = render1().getByTestId('recorder-stop');
        expect(stop.className).toContain('bg-record');
        expect(stop.className).not.toMatch(/bg-(ink|black|neutral-body)/);
        const square = stop.querySelector('span');
        expect(square?.className).toContain('bg-white');
        expect(square?.className).toContain('rounded-[3px]');
    });
});
