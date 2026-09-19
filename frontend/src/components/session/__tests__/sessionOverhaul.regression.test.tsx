import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionBeforeState } from '../SessionBeforeState';
import { SessionDuringState } from '../SessionDuringState';
import { SessionAfterState } from '../SessionAfterState';
import { CoverageRail } from '../CoverageRail';
import { SessionVerdict } from '../SessionVerdict';
import type { CoverageRailPoint } from '../CoverageRail';

/**
 * Regression pass over the session slot map (Design Correction Brief Phase 6).
 *
 * jsdom does no real layout, so the responsive contract is asserted through the structure and classes that
 * produce it: A and B full-width blocks, then a row that stacks on phones and becomes C (flex 1) beside a
 * 310px D from `md`. Pixel checks at phone and desktop widths are the Playwright job
 * (`tests/e2e/session-shell-responsive.e2e.spec.ts`).
 */

const beforeProps = {
    mic: { onStart: vi.fn() },
    transcript: { offerDismissed: false, onRestoreOffer: vi.fn(), onTakePrompt: vi.fn(), onReadSample: vi.fn() },
    rail: <div>rail</div>,
};
const duringProps = {
    recorder: { elapsedSeconds: 30, amplitudes: [0.4, 0.6, 0.8], recordedCount: 2, onStop: vi.fn() },
    transcript: { tokens: [{ text: 'So' }, { text: 'um', filler: true }], words: 40, fillersPerMin: 2 },
    rail: <div>rail</div>,
};
const afterProps = {
    runShape: { durationSeconds: 124, amplitudes: [0.4, 0.6, 0.8], fillerBars: [1], onStart: vi.fn() },
    transcript: { tokens: [{ text: 'So' }, { text: 'um', filler: true }], headerMeta: 'x', stats: 'y' },
    review: <SessionVerdict verdictLine="Clean." fix="Pause more." onPracticeAgain={vi.fn()} onSeeAllSessions={vi.fn()} />,
    rail: <div>rail</div>,
};
const points: CoverageRailPoint[] = [{ id: '1', label: 'a', status: 'covered' }];

describe('#1222 S10 — session overhaul regression', () => {
    it('the shell layout contract: A and B full width, then C beside a 310px D from md', () => {
        render(<SessionBeforeState {...beforeProps} />);
        expect(screen.getByTestId('session-shell')).toHaveClass('flex', 'flex-col');
        expect(screen.getByTestId('session-slot-a')).toHaveClass('w-full');
        expect(screen.getByTestId('session-slot-b')).toHaveClass('w-full', 'bg-ink');
        // G16 D2: `before` stretches so the transcript and rail end level (during/after keep items-start).
        expect(screen.getByTestId('session-shell-row')).toHaveClass('md:flex-row', 'md:items-stretch');
        expect(screen.getByTestId('session-slot-c')).toHaveClass('md:flex-1', 'min-w-0');
        expect(screen.getByTestId('session-slot-d')).toHaveClass('md:w-[310px]', 'md:shrink-0');
    });

    it('the four slots keep identity and order across before → during → after AND Focus Points', () => {
        const order = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        const { rerender } = render(<SessionBeforeState {...beforeProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<SessionDuringState {...duringProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<SessionAfterState {...afterProps} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
        rerender(<SessionDuringState {...duringProps} rail={<CoverageRail points={points} />} />);
        expect(order()).toEqual(['A', 'B', 'C', 'D']);
    });

    it('F-1 parity: Open Mic and Focus Points differ only inside the slots, never in the slots themselves', () => {
        const shape = () => screen.getAllByTestId(/^session-slot-/).map((el) =>
            `${el.getAttribute('data-slot')}:${el.getAttribute('aria-label')}:${el.className}`);
        const { rerender } = render(<SessionDuringState {...duringProps} liveTip={<span>tip</span>} />);
        const openMic = shape();
        rerender(<SessionDuringState {...duringProps} nudge="Good moment to bring in point 2." rail={<CoverageRail points={points} />} />);
        expect(shape()).toEqual(openMic);
    });

    it('every slot keeps a stable accessible landmark in all three states', () => {
        const names = ['Recorder', 'Coaching', 'Transcript', 'This run'];
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

    /*
     * S-9 — the geometry inverted: hairlines that NEVER grow, so the leftover space falls between them as
     * gap. `flex: 1; min-width: 2px` was the old rule and it is the "looks fake" render, because the lines
     * grow to fill and come out wider than their gaps. jsdom has no layout, so the track measures 0 and
     * renders no lines; the per-line geometry and the width-derived count are proven in `Waveform.test.tsx`
     * and `waveformGeometry.test.ts`. What this regression pins is that BOTH states use the same track,
     * centre-mirrored, distributing its spare space rather than setting a gap.
     */
    it('both waveform tracks are centre-mirrored and distribute their spare space — recorder bar and run shape', () => {
        const { rerender } = render(<SessionDuringState {...duringProps} />);
        const during = screen.getByTestId('recorder-waveform');
        expect(during.style.alignItems).toBe('center');
        expect(during.style.justifyContent).toBe('space-between');
        expect(during.style.gap).toBe('');
        rerender(<SessionAfterState {...afterProps} />);
        const after = screen.getByTestId('run-shape-waveform');
        expect(after.style.alignItems).toBe('center');
        expect(after.style.justifyContent).toBe('space-between');
        expect(after.style.gap).toBe('');
    });

    it('CASUALTY: no state offers a transport — the mic is the only round control', () => {
        for (const Comp of [
            <SessionDuringState key="d" {...duringProps} />,
            <SessionAfterState key="a" {...afterProps} />,
        ]) {
            const { unmount } = render(Comp);
            for (const name of [/play/i, /pause/i, /seek/i, /download/i]) {
                expect(screen.queryByRole('button', { name })).toBeNull();
            }
            unmount();
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
