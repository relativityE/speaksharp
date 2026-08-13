import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionAfterState } from '../SessionAfterState';
import { SessionBeforeState } from '../SessionBeforeState';
import { SessionDuringState } from '../SessionDuringState';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';

const progress = computeProgressVsBaseline([
    { fillerCount: 34, durationSeconds: 600 },
    { fillerCount: 24, durationSeconds: 600 },
]);

const afterProps = {
    scrubber: {
        playing: false, onTogglePlay: vi.fn(), positionSeconds: 0, durationSeconds: 124,
        amplitudes: Array.from({ length: 10 }, () => 0.5), fillerBars: [3], onSeek: vi.fn(),
    },
    transcript: {
        tokens: [{ text: 'So' }, { text: 'um', filler: true, seekSeconds: 12 }, { text: 'today' }],
        headerMeta: '318 words · 2.4 fillers/min · tap a highlight to hear it',
        stats: '5 fillers · 142 wpm · 2:04 spoken',
        onFillerSeek: vi.fn(),
    },
    progress,
    verdict: {
        verdictLine: 'Your cleanest session yet.',
        fix: "You opened three sentences with 'um'.",
        onPracticeAgain: vi.fn(), onSeeAllSessions: vi.fn(),
    },
};

describe('SessionAfterState (#1222 after)', () => {
    it('maps scrubber, seekable transcript, final progress and verdict into the four slots', () => {
        render(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('playback-scrubber'));
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('live-transcript'));
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('progress-vs-baseline'));
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('session-verdict'));
    });

    it('only makes highlighted fillers interactive when a real navigation callback exists', () => {
        const onFillerSeek = vi.fn();
        render(<SessionAfterState {...afterProps} transcript={{ ...afterProps.transcript, onFillerSeek }} />);
        fireEvent.click(screen.getByTestId('live-filler'));
        expect(onFillerSeek).toHaveBeenCalledOnce();
        expect(onFillerSeek.mock.calls[0][0]).toMatchObject({ text: 'um' });
    });

    it('keeps transcript and waveform non-interactive when review retains no audio', () => {
        render(
            <SessionAfterState
                {...afterProps}
                scrubber={{ ...afterProps.scrubber, audioAvailable: false, onSeek: undefined }}
                transcript={{ ...afterProps.transcript, onFillerSeek: undefined }}
            />,
        );
        expect(screen.queryByRole('button', { name: /seek/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /play|pause/i })).toBeNull();
        expect(screen.getByTestId('live-filler').tagName).toBe('MARK');
    });

    it('shows the stats strip and the final progress delta', () => {
        render(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('after-stats')).toHaveTextContent('5 fillers · 142 wpm · 2:04 spoken');
        expect(screen.getByTestId('progress-delta')).toBeInTheDocument();
    });
});

// The governing rule across the FULL journey: four slots keep identity + order in all three states.
describe('before → during → after (#1222 §1 — slots never move across the whole journey)', () => {
    it('holds slot order A,B,C,D through every state change', () => {
        const beforeProps = {
            mic: { onStart: vi.fn() },
            transcript: { offerDismissed: false, onDismissOffer: vi.fn(), onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn() },
            progress,
        };
        const duringProps = {
            recorder: { elapsedSeconds: 30, amplitudes: [0.4, 0.6], recordedCount: 1, onStop: vi.fn() },
            transcript: { tokens: [{ text: 'hi' }], words: 20, fillersPerMin: 1 },
            progress,
        };
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));

        const { rerender } = render(<SessionBeforeState {...beforeProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<SessionDuringState {...duringProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
    });
});
