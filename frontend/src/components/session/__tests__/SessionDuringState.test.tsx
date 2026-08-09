import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionDuringState } from '../SessionDuringState';
import { SessionBeforeState } from '../SessionBeforeState';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';

const progress = computeProgressVsBaseline([
    { fillerCount: 34, durationSeconds: 600 },
    { fillerCount: 26, durationSeconds: 600 },
]);

const duringProps = {
    recorder: { elapsedSeconds: 72, amplitudes: [0.5, 0.7, 0.4], recordedCount: 2, onStop: vi.fn() },
    transcript: { tokens: [{ text: 'So' }, { text: 'um', filler: true }], words: 184, fillersPerMin: 2.6 },
    progress,
};

describe('SessionDuringState (#1222 during)', () => {
    it('maps the recorder bar, live transcript, live progress and coaching into the four slots', () => {
        render(<SessionDuringState {...duringProps} liveTip={<span data-testid="tip">Pause instead of um</span>} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('recorder-bar'));
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('live-transcript'));
        expect(screen.getByTestId('session-slot-c')).toContainElement(screen.getByTestId('progress-vs-baseline'));
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('tip'));
    });

    it('slot B header carries live counts and the "not scored until you stop" note', () => {
        render(<SessionDuringState {...duringProps} />);
        expect(screen.getByTestId('transcript-header-meta')).toHaveTextContent('184 words · 2.6 fillers/min');
        expect(screen.getByTestId('transcript-footer')).toHaveTextContent(/Nothing is scored until you stop/);
    });
});

// The governing rule at composition level: the four slots keep identity + order from before → during.
describe('before → during (#1222 §1 — slots never move)', () => {
    it('keeps slot order A,B,C,D across the state change', () => {
        const beforeProps = {
            mic: { onStart: vi.fn() },
            transcript: {
                offerDismissed: false,
                onDismissOffer: vi.fn(), onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn(),
            },
            progress,
        };
        const { rerender } = render(<SessionBeforeState {...beforeProps} />);
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        expect(order()).toEqual(['A', 'B', 'C', 'D']);

        rerender(<SessionDuringState {...duringProps} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
    });
});
