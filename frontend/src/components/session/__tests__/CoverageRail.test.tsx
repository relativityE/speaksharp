import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CoverageRail } from '../CoverageRail';

const POINTS = [
    { id: 'p1', label: 'Name the price', status: 'covered' as const },
    { id: 'p2', label: 'Explain the guarantee', status: 'partial' as const },
    { id: 'p3', label: 'End with a clear ask', status: 'missing' as const },
];

describe('#1046 CoverageRail', () => {
    it('renders one row per focus point, labelled, in order', () => {
        render(<CoverageRail points={POINTS} />);
        const items = within(screen.getByTestId('coverage-rail-list')).getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items[0]).toHaveTextContent('Name the price');
        expect(items[2]).toHaveTextContent('End with a clear ask');
    });

    it('carries a non-colour status cue per row (data-status + sr-only word) for accessibility', () => {
        render(<CoverageRail points={POINTS} />);
        expect(screen.getByTestId('coverage-point-0')).toHaveAttribute('data-status', 'covered');
        expect(screen.getByTestId('coverage-point-1')).toHaveAttribute('data-status', 'partial');
        expect(screen.getByTestId('coverage-point-2')).toHaveAttribute('data-status', 'missing');
        // Meaning is not colour-only: a status word is present for each state.
        expect(screen.getByTestId('coverage-point-0')).toHaveTextContent(/detected/i);
        expect(screen.getByTestId('coverage-point-2')).toHaveTextContent(/not detected/i);
    });

    it('summarises detected / total', () => {
        render(<CoverageRail points={POINTS} />);
        expect(screen.getByTestId('coverage-rail-summary')).toHaveTextContent('1/3 detected');
    });

    it('renders nothing-summary safely with zero points', () => {
        render(<CoverageRail points={[]} />);
        expect(screen.getByTestId('coverage-rail')).toBeInTheDocument();
        expect(screen.queryByTestId('coverage-rail-summary')).toBeNull();
        expect(within(screen.getByTestId('coverage-rail-list')).queryAllByRole('listitem')).toHaveLength(0);
    });
});

describe('#1254 — the surface never claims more than the matcher measured', () => {
    // The engine is a conservative LOCAL KEYWORD MATCHER. "Covered"/"missed" assert what the SPEAKER did;
    // the measurement only supports what was DETECTED. A speaker who made a point in their own words and
    // got a "missed" pip was told they failed at something they actually did.
    it('shows no coverage-claim wording anywhere in the rendered rail', () => {
        const { container } = render(<CoverageRail points={POINTS} />);
        const text = container.textContent ?? '';
        expect(text).not.toMatch(/covered/i);
        expect(text).not.toMatch(/\bmissed\b/i);
        expect(text).toMatch(/detected/i);
    });

    it('keeps the internal status KEY unchanged — this is a copy change, not a data migration', () => {
        // Renaming the stored status would silently invalidate persisted rows and the coverage engine's
        // own vocabulary. Only what the user reads changes.
        render(<CoverageRail points={POINTS} />);
        expect(screen.getByTestId('coverage-point-0')).toHaveAttribute('data-status', 'covered');
    });
});
