import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { CoveragePace } from '../CoveragePace';
import { coveragePlanSentence } from '@/utils/focusPace';

// Coverage & pace: count + pace-per-point + projection during/after; the plan in before; never a countdown;
// no pips. The nudge moved to slot B (Design Correction Brief F-1).
describe('CoveragePace', () => {
    it('no guide → the card is the count alone (no pace, no bar, no projection)', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={null} sessionState="during" />);
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('2/3');
        expect(screen.queryByTestId('coverage-pace-perpoint')).not.toBeInTheDocument();
        expect(screen.queryByTestId('coverage-pace-bar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
    });

    it('guide + zero covered → "— /point", no projection line (never ∞, never elapsed)', () => {
        render(<CoveragePace covered={0} total={3} elapsedSec={40} guideSecPerPoint={60} sessionState="during" />);
        expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('— /point');
        expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
        expect(screen.queryByText('0:40')).not.toBeInTheDocument(); // elapsed is never shown
    });

    it('during, over guide → pace-per-point + "at this pace" projection against the guide total', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={60} sessionState="during" />);
        expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('1:15 /point');
        const proj = screen.getByTestId('coverage-pace-projection');
        expect(proj).toHaveTextContent('3:00 guide');
        expect(proj).toHaveTextContent('3:45 at this pace');
        // Never a countdown / remaining time.
        expect(proj).not.toHaveTextContent(/left|remaining/i);
    });

    it('after → the projection reads "actual" and the bar is frozen', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={204} guideSecPerPoint={60} sessionState="after" />);
        expect(screen.getByTestId('coverage-pace-projection')).toHaveTextContent('3:24 actual');
    });

    it('F-1: the card never renders a nudge — coaching lives in slot B now', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={60} sessionState="during" />);
        expect(screen.queryByTestId('coverage-pace-nudge')).not.toBeInTheDocument();
    });

    it('never renders pips', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={60} sessionState="during" />);
        expect(screen.queryByTestId('coverage-this-run-pips')).not.toBeInTheDocument();
    });

    // #1474 N2 (adopted Rev2; Browser PM audit F07 on 724c): during a run, pace is a COVERAGE-EVENT reading. Elapsed time
    // alone used to drift the projection (2/3 at 150 s → 151 s read 3:45 → 3:47) with nothing newly covered.
    describe('N2 — during, the pace reading changes only on a coverage event', () => {
        const during = (covered: number, elapsedSec: number) =>
            <CoveragePace covered={covered} total={3} elapsedSec={elapsedSec} guideSecPerPoint={60} sessionState="during" />;

        it('CASUALTY: a time-only rerender keeps the dial, bar and projection exactly where the last coverage event left them', () => {
            const { rerender } = render(during(2, 150));
            const before = {
                dial: screen.getByTestId('coverage-pace-perpoint').textContent,
                projection: screen.getByTestId('coverage-pace-projection').textContent,
                bar: (screen.getByTestId('coverage-pace-bar').firstElementChild as HTMLElement).style.width,
            };
            expect(before.projection).toContain('3:45 at this pace');
            for (const t of [151, 170, 240]) {
                rerender(during(2, t));
                expect(screen.getByTestId('coverage-pace-perpoint').textContent).toBe(before.dial);
                expect(screen.getByTestId('coverage-pace-projection').textContent).toBe(before.projection);
                expect((screen.getByTestId('coverage-pace-bar').firstElementChild as HTMLElement).style.width).toBe(before.bar);
            }
        });

        it('CASUALTY: a point detected before the first heartbeat (0 s) takes its reading at the first positive elapsed time, not a frozen zero', () => {
            // Codex P2 on 2ed4ad76: a 0 s coverage event froze the snapshot at 0, and a non-positive elapsed is "no pace",
            // so a one-point brief read "— /point" for the whole live take although the point showed as detected.
            const one = (covered: number, elapsedSec: number) =>
                <CoveragePace covered={covered} total={1} elapsedSec={elapsedSec} guideSecPerPoint={60} sessionState="during" />;
            const { rerender } = render(one(0, 0));
            rerender(one(1, 0));
            rerender(one(1, 1));
            const dial = screen.getByTestId('coverage-pace-perpoint').textContent;
            expect(dial).toContain('0:01 /point');
            for (const t of [5, 30]) {
                rerender(one(1, t));
                expect(screen.getByTestId('coverage-pace-perpoint').textContent).toBe(dial);
            }
        });

        it('after a 0 s first reading, a later point still refreshes the reading, and a new take (count reset) starts over', () => {
            const three = (covered: number, elapsedSec: number) =>
                <CoveragePace covered={covered} total={3} elapsedSec={elapsedSec} guideSecPerPoint={60} sessionState="during" />;
            const dial = () => screen.getByTestId('coverage-pace-perpoint').textContent;
            const { rerender } = render(three(1, 0));
            rerender(three(1, 1));
            expect(dial()).toContain('0:01 /point');
            rerender(three(2, 40)); // a later coverage event refreshes from its own elapsed time
            expect(dial()).toContain('0:20 /point');
            rerender(three(2, 90));
            expect(dial()).toContain('0:20 /point');
            rerender(three(0, 0)); // a new take resets the count
            expect(dial()).toContain('— /point');
            rerender(three(1, 0));
            rerender(three(1, 2));
            expect(dial()).toContain('0:02 /point');
        });

        it('no detected point stays "— /point" as time passes, and no guide keeps the pace half absent', () => {
            const { rerender } = render(<CoveragePace covered={0} total={3} elapsedSec={0} guideSecPerPoint={60} sessionState="during" />);
            for (const t of [1, 30]) {
                rerender(<CoveragePace covered={0} total={3} elapsedSec={t} guideSecPerPoint={60} sessionState="during" />);
                expect(screen.getByTestId('coverage-pace-perpoint').textContent).toContain('— /point');
            }
            rerender(<CoveragePace covered={1} total={3} elapsedSec={0} guideSecPerPoint={null} sessionState="during" />);
            rerender(<CoveragePace covered={1} total={3} elapsedSec={5} guideSecPerPoint={null} sessionState="during" />);
            expect(screen.queryByTestId('coverage-pace-perpoint')).toBeNull();
        });

        it('after the take, the reading uses the real final duration, not a during snapshot', () => {
            const { rerender } = render(<CoveragePace covered={1} total={3} elapsedSec={0} guideSecPerPoint={60} sessionState="during" />);
            rerender(<CoveragePace covered={1} total={3} elapsedSec={90} guideSecPerPoint={60} sessionState="after" />);
            expect(screen.getByTestId('coverage-pace-perpoint').textContent).toContain('1:30 /point');
        });

        it('a NEW covered point updates the reading from the elapsed time at that event', () => {
            const { rerender } = render(during(2, 150));
            rerender(during(2, 200)); // time passes; nothing newly covered
            rerender(during(3, 210)); // the third point is detected at 210 s
            expect(screen.getByTestId('coverage-pace-covered')).toHaveTextContent('3');
            expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('1:10 /point');
            expect(screen.getByTestId('coverage-pace-projection')).toHaveTextContent('3:30 at this pace');
        });

        it('CONTROL: with nothing covered there is still no projection; with no guide, still no pace half', () => {
            const { rerender } = render(during(0, 40));
            rerender(during(0, 90));
            expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
            expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('— /point');
            rerender(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={null} sessionState="during" />);
            expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
        });

        it('session reset: a new run (covered back to 0) never shows the previous run\'s reading', () => {
            const { rerender } = render(during(2, 150));
            rerender(during(0, 5)); // the next run starts
            expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
            expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('— /point');
            rerender(during(0, 30));
            rerender(during(1, 40)); // first point of the new run, at 40 s
            expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('0:40 /point');
            expect(screen.getByTestId('coverage-pace-projection')).toHaveTextContent('2:00 at this pace');
        });

        it('CONTROL: after the run, "actual" is the real elapsed total, not a frozen coverage reading', () => {
            const { rerender } = render(during(2, 150));
            rerender(<CoveragePace covered={2} total={3} elapsedSec={204} guideSecPerPoint={60} sessionState="after" />);
            expect(screen.getByTestId('coverage-pace-projection')).toHaveTextContent('3:24 actual');
        });
    });

    // Design Correction Brief F-2 / F-3 / G4 — `before` states the plan once, and scores nothing.
    describe('before — the plan, not a score', () => {
        it('with a guide: one sentence carrying count, total and pace', () => {
            render(<CoveragePace covered={0} total={3} elapsedSec={0} guideSecPerPoint={60} sessionState="before" />);
            expect(screen.getByTestId('coverage-pace-plan')).toHaveTextContent('3 points · about 3:00 at 1:00 per point');
        });

        it('without a guide: the count of points alone', () => {
            render(<CoveragePace covered={0} total={2} elapsedSec={0} guideSecPerPoint={null} sessionState="before" />);
            expect(screen.getByTestId('coverage-pace-plan')).toHaveTextContent(/^2 points$/);
        });

        it('CASUALTY F-2: no 0/N scoreboard, no numerals, no bar, no projection before a run', () => {
            render(<CoveragePace covered={0} total={3} elapsedSec={0} guideSecPerPoint={60} sessionState="before" />);
            const card = screen.getByTestId('coverage-pace');
            expect(screen.queryByTestId('coverage-pace-count')).not.toBeInTheDocument();
            expect(card).not.toHaveTextContent(/\b0\s*\/\s*3\b/);
            expect(card).not.toHaveTextContent(/detected|covered/i);
            expect(screen.queryByTestId('coverage-pace-perpoint')).not.toBeInTheDocument();
            expect(screen.queryByTestId('coverage-pace-bar')).not.toBeInTheDocument();
            expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
        });

        it('CASUALTY F-3: the pace guide is stated exactly once', () => {
            render(<CoveragePace covered={0} total={3} elapsedSec={0} guideSecPerPoint={60} sessionState="before" />);
            const text = screen.getByTestId('coverage-pace').textContent ?? '';
            expect(text.match(/1:00/g) ?? []).toHaveLength(1);
            expect(text).not.toMatch(/pace guide|\/point|3:00 guide/);
            expect(screen.queryByTestId('coverage-pace-guide')).not.toBeInTheDocument();
            expect(screen.queryByTestId('coverage-pace-planned')).not.toBeInTheDocument();
        });

        it('offers `Edit pace` as a text link when an editor is wired', () => {
            const onEditPace = vi.fn();
            render(<CoveragePace covered={0} total={3} elapsedSec={0} guideSecPerPoint={60} sessionState="before" onEditPace={onEditPace} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit pace' }));
            expect(onEditPace).toHaveBeenCalledTimes(1);
        });

        it('singular and invalid guides read plainly', () => {
            expect(coveragePlanSentence(1, 90)).toBe('1 point · about 1:30 at 1:30 per point');
            expect(coveragePlanSentence(4, 0)).toBe('4 points');
        });
    });
});
