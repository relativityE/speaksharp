import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { ProgressVsBaseline } from '../ProgressVsBaseline';
import { computeProgressVsBaseline } from '@/utils/progressVsBaseline';

// #1222 slot C — the Progress card renders the % delta contract in all three states from one component.
describe('ProgressVsBaseline (#1222 slot C)', () => {
    it('session 1 shows BASELINE SET, no percentage', () => {
        const result = computeProgressVsBaseline([{ fillerCount: 6, durationSeconds: 120 }]);
        render(<ProgressVsBaseline result={result} sessionState="after" />);
        expect(screen.getByTestId('progress-baseline-set')).toBeInTheDocument();
        expect(screen.queryByTestId('progress-delta')).toBeNull();
        expect(screen.getByTestId('progress-vs-baseline')).toHaveAttribute('data-progress-state', 'baseline');
    });

    it('improvement shows a POSITIVE % in green with "fewer fillers"', () => {
        const result = computeProgressVsBaseline([
            { fillerCount: 34, durationSeconds: 600 }, // 3.4/min baseline
            { fillerCount: 24, durationSeconds: 600 }, // 2.4/min current → improvement
        ]);
        render(<ProgressVsBaseline result={result} sessionState="after" />);
        const delta = screen.getByTestId('progress-delta');
        expect(delta.textContent).toMatch(/^\+\d/); // positive sign
        expect(delta).toHaveStyle({ color: '#146b4a' }); // green
        expect(screen.getByText(/fewer/)).toBeInTheDocument();
        expect(screen.getByTestId('progress-vs-baseline')).toHaveAttribute('data-progress-state', 'improved');
        expect(screen.getByTestId('progress-current')).toHaveTextContent('Today 2.4/min');
    });

    it('regression is reported honestly (negative %, regress colour, "more fillers")', () => {
        const result = computeProgressVsBaseline([
            { fillerCount: 20, durationSeconds: 600 }, // 2.0/min baseline
            { fillerCount: 30, durationSeconds: 600 }, // 3.0/min current → regression
        ]);
        render(<ProgressVsBaseline result={result} sessionState="after" />);
        const delta = screen.getByTestId('progress-delta');
        expect(delta.textContent).toMatch(/^−\d/); // minus sign
        expect(delta).toHaveStyle({ color: '#a8321f' });
        expect(screen.getByText(/more/)).toBeInTheDocument();
    });

    it('too-short current session shows "—" / too short to compare', () => {
        const result = computeProgressVsBaseline([
            { fillerCount: 20, durationSeconds: 600 },
            { fillerCount: 1, durationSeconds: 10 },
        ]);
        render(<ProgressVsBaseline result={result} sessionState="after" />);
        expect(screen.getByTestId('progress-too-short')).toHaveTextContent(/too short to compare/i);
    });

    it('during state labels the current value "Now"', () => {
        const result = computeProgressVsBaseline([
            { fillerCount: 34, durationSeconds: 600 },
            { fillerCount: 26, durationSeconds: 600 },
        ]);
        render(<ProgressVsBaseline result={result} sessionState="during" />);
        expect(screen.getByTestId('progress-current')).toHaveTextContent(/^Now /);
    });
});
