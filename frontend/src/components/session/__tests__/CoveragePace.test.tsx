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
