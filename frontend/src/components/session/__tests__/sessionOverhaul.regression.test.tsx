import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionBeforeState } from '../SessionBeforeState';
import { SessionDuringState } from '../SessionDuringState';
import { SessionAfterState } from '../SessionAfterState';
import { FocusPointsDuringState } from '../SessionFocusPoints';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';
import type { CoverageRailPoint } from '../CoverageRail';

/**
 * #1222 S10 — regression pass over the whole overhaul (spec build-order #7).
 *
 * jsdom does no real layout, so "holds at 1024 / 1280 / 1440" is asserted through the CSS CONTRACT that
 * produces the layout at every width: the shell's `1.55fr 1fr` grid + per-slot flex (A/C size to content,
 * B/D fill), and the waveform's flex-fill bars. Live pixel checks at the three widths are the integration
 * slice's Playwright job (the shell is not yet mounted on a route).
 */
const progress = computeProgressVsBaseline([
    { fillerCount: 34, durationSeconds: 600 },
    { fillerCount: 24, durationSeconds: 600 },
]);

const beforeProps = {
    mic: { onStart: vi.fn() },
    transcript: { offerDismissed: false, onDismissOffer: vi.fn(), onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn() },
    progress,
};
const duringProps = {
    recorder: { elapsedSeconds: 30, amplitudes: [0.4, 0.6, 0.8], recordedCount: 2, onStop: vi.fn() },
    transcript: { tokens: [{ text: 'So' }, { text: 'um', filler: true }], words: 40, fillersPerMin: 2 },
    progress,
};
const afterProps = {
    scrubber: { playing: false, onTogglePlay: vi.fn(), positionSeconds: 10, durationSeconds: 124, amplitudes: [0.4, 0.6, 0.8], fillerBars: [1], onSeek: vi.fn() },
    transcript: { tokens: [{ text: 'So' }, { text: 'um', filler: true }], headerMeta: 'x', stats: 'y', onFillerSeek: vi.fn() },
    progress,
    verdict: { verdictLine: 'Clean.', fix: 'Pause more.', onPracticeAgain: vi.fn(), onSeeAllSessions: vi.fn() },
};
const points: CoverageRailPoint[] = [{ id: '1', label: 'a', status: 'covered' }];

describe('#1222 S10 — session overhaul regression', () => {
    it('the shell layout contract is width-independent (grid 1.55fr 1fr; A/C size, B/D fill)', () => {
        render(<SessionBeforeState {...beforeProps} />);
        const shell = screen.getByTestId('session-shell');
        expect(shell).toHaveStyle({ display: 'grid', gridTemplateColumns: '1.55fr 1fr' });
        expect(screen.getByTestId('session-slot-a')).toHaveStyle({ flex: '0 0 auto' }); // sizes to content
        expect(screen.getByTestId('session-slot-b')).toHaveStyle({ flex: '1 1 auto' }); // fills
        expect(screen.getByTestId('session-slot-c')).toHaveStyle({ flex: '0 0 auto' });
        expect(screen.getByTestId('session-slot-d')).toHaveStyle({ flex: '1 1 auto' });
    });

    it('the four slots keep identity + order across before → during → after AND Focus Points', () => {
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        const { rerender } = render(<SessionBeforeState {...beforeProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<SessionDuringState {...duringProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<SessionAfterState {...afterProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<FocusPointsDuringState {...duringProps} points={points} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']); // shared shell, only slot D content differs
    });

    it('every slot keeps a stable accessible landmark in all three states', () => {
        const names = ['Recorder', 'Transcript', 'Progress', 'Coaching'];
        for (const Comp of [
            <SessionBeforeState key="b" {...beforeProps} />,
            <SessionDuringState key="d" {...duringProps} />,
            <SessionAfterState key="a" {...afterProps} />,
        ]) {
            const { unmount } = render(Comp);
            for (const name of names) expect(screen.getByRole('region', { name })).toBeInTheDocument();
            unmount();
        }
    });

    it('both waveforms fill their track (flex:1, min-width:2px) — recorder bar and scrubber', () => {
        const { rerender } = render(<SessionDuringState {...duringProps} />);
        for (const bar of screen.getAllByTestId('recorder-waveform-bar')) {
            expect(bar).toHaveStyle({ flex: '1 1 0', minWidth: '2px' });
        }
        rerender(<SessionAfterState {...afterProps} />);
        for (const bar of screen.getAllByTestId('scrubber-waveform-bar')) {
            expect(bar).toHaveStyle({ flex: '1 1 0', minWidth: '2px' });
        }
    });

    it('STT stays Private-only across every state — no engine selector anywhere', () => {
        for (const Comp of [
            <SessionBeforeState key="b" {...beforeProps} />,
            <SessionDuringState key="d" {...duringProps} />,
            <SessionAfterState key="a" {...afterProps} />,
        ]) {
            const { unmount } = render(Comp);
            for (const label of [/engine/i, /browser/i, /cloud/i, /native/i]) {
                expect(screen.queryByRole('combobox', { name: label })).toBeNull();
            }
            unmount();
        }
    });
});
