import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionAfterState } from '../SessionAfterState';
import { SessionBeforeState } from '../SessionBeforeState';
import { SessionDuringState } from '../SessionDuringState';
import { SessionVerdict } from '../SessionVerdict';

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
    review: (
        <SessionVerdict
            verdictLine="Your cleanest session yet."
            fix="You opened three sentences with 'um'."
            onPracticeAgain={vi.fn()}
            onSeeAllSessions={vi.fn()}
        />
    ),
    rail: <div data-testid="rail-content">rail</div>,
};

describe('SessionAfterState — the shared slot map', () => {
    it('maps the run shape, the review, the transcript and the rail into A, B, C, D', () => {
        render(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('playback-scrubber'));
        // The AFTER state's slot B renders the transcript the SERVER retained, not the ephemeral working
        // memory the DURING state shows, so it carries its own identity — otherwise a leak of working memory
        // and a correctly restored review are indistinguishable to the suite.
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('review-transcript'));
        expect(screen.queryByTestId('live-transcript')).toBeNull();
        // S-12: the review sits in slot B, full width, directly under the recorder, on ink.
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('session-verdict'));
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('rail-content'));
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

    it('shows the stats strip', () => {
        render(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('after-stats')).toHaveTextContent('5 fillers · 142 wpm · 2:04 spoken');
    });
});

// G1 across the FULL journey: four slots, one order, in every state. The previous shell promoted the
// review by swapping columns in `after` (A, D, C, B); the shared map needs no swap because B is already
// full width under the recorder.
describe('before → during → after (G1 — slots never move)', () => {
    it('CASUALTY: holds A, B, C, D and the same landmarks in all three states', () => {
        const beforeProps = {
            mic: { onStart: vi.fn() },
            transcript: { offerDismissed: false, onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn() },
            rail: <div>rail</div>,
        };
        const duringProps = {
            recorder: { elapsedSeconds: 30, amplitudes: [0.4, 0.6], recordedCount: 1, onStop: vi.fn() },
            transcript: { tokens: [{ text: 'hi' }], words: 20, fillersPerMin: 1 },
            rail: <div>rail</div>,
        };
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        const landmarks = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('aria-label'));
        const LANDMARKS = ['Recorder', 'Coaching', 'Transcript', 'This run'];

        const { rerender } = render(<SessionBeforeState {...beforeProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        expect(landmarks()).toEqual(LANDMARKS);
        rerender(<SessionDuringState {...duringProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        expect(landmarks()).toEqual(LANDMARKS);
        rerender(<SessionAfterState {...afterProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        expect(landmarks()).toEqual(LANDMARKS);
    });
});
