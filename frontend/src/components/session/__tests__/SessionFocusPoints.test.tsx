import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { FocusPointsBeforeState, FocusPointsDuringState, FocusPointsAfterState } from '../SessionFocusPoints';
import { SessionDuringState } from '../SessionDuringState';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';
import type { CoverageRailPoint } from '../CoverageRail';

const progress = computeProgressVsBaseline([
    { fillerCount: 34, durationSeconds: 600 },
    { fillerCount: 24, durationSeconds: 600 },
]);

const points: CoverageRailPoint[] = [
    { id: '1', label: 'State the problem', status: 'covered' },
    { id: '2', label: 'Give the metric', status: 'partial' },
    { id: '3', label: 'Ask for the close', status: 'missing' },
];

const duringBase = {
    recorder: { elapsedSeconds: 30, amplitudes: [0.4, 0.6], recordedCount: 1, onStop: vi.fn() },
    transcript: { tokens: [{ text: 'hi' }], words: 20, fillersPerMin: 1 },
    progress,
};

// #1222 S8 — Focus Points renders through the SAME shell; only slot D differs (coverage rail).
describe('Focus Points shared shell (#1222 S8)', () => {
    it('before: the capture step occupies slot D, slots A,B,C unchanged', () => {
        render(
            <FocusPointsBeforeState
                mic={{ onStart: vi.fn() }}
                transcript={{ offerDismissed: true, onDismissOffer: vi.fn(), onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn() }}
                progress={progress}
                capture={<div data-testid="focus-capture">Declare your focus points</div>}
            />,
        );
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('focus-capture'));
        // Not the Open Mic coaching card.
        expect(screen.queryByTestId('coaching-card')).toBeNull();
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('mic-card'));
    });

    it('during: the coverage rail occupies slot D (not the coaching card)', () => {
        render(<FocusPointsDuringState {...duringBase} points={points} />);
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('coverage-rail'));
        expect(screen.getByTestId('coverage-rail-summary')).toHaveTextContent('1/3 detected');
        expect(screen.queryByTestId('coaching-card')).toBeNull();
        // Same shell: transcript + recorder still in their slots.
        expect(screen.getByTestId('session-slot-a')).toContainElement(screen.getByTestId('recorder-bar'));
        expect(screen.getByTestId('session-slot-b')).toContainElement(screen.getByTestId('live-transcript'));
    });

    it('after: the resolved coverage rail replaces the verdict in slot D', () => {
        render(
            <FocusPointsAfterState
                scrubber={{ playing: false, onTogglePlay: vi.fn(), positionSeconds: 0, durationSeconds: 120, amplitudes: [0.5], fillerBars: [], onSeek: vi.fn() }}
                transcript={{ tokens: [{ text: 'hi' }], headerMeta: 'x', stats: 'y', onFillerSeek: vi.fn() }}
                progress={progress}
                points={points}
            />,
        );
        expect(screen.getByTestId('session-slot-d')).toContainElement(screen.getByTestId('coverage-rail'));
        expect(screen.queryByTestId('session-verdict')).toBeNull();
    });

    it('parity: Open Mic and Focus Points use the SAME slot structure (order A,B,C,D)', () => {
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        const { rerender } = render(<SessionDuringState {...duringBase} liveTip={<span>tip</span>} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<FocusPointsDuringState {...duringBase} points={points} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']); // identical shell, slot D content swapped
    });
});
