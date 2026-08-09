import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { FillerBreakdown } from '../FillerBreakdown';
import type { FillerCounts } from '@/utils/fillerWordUtils';

const fillers = (o: Record<string, number>): FillerCounts =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { count: v }])) as unknown as FillerCounts;

// #1231 R2 — per-word breakdown (which words to target) + custom-word manager.
describe('FillerBreakdown (#1231 R2)', () => {
    it('ranks filler words by count, descending', () => {
        render(<FillerBreakdown fillerData={fillers({ like: 2, um: 5, 'you know': 1, total: 8 })} />);
        const words = screen.getAllByTestId('filler-breakdown-word').map((el) => el.getAttribute('data-word'));
        expect(words).toEqual(['um', 'like', 'you know']); // desc; 'total' excluded
        expect(screen.getAllByTestId('filler-breakdown-count')[0]).toHaveTextContent('×5');
    });

    it('shows an honest empty state when no fillers were detected', () => {
        render(<FillerBreakdown fillerData={fillers({})} />);
        expect(screen.getByTestId('filler-breakdown-empty')).toHaveTextContent(/No filler words detected/i);
    });

    it('caps the list and shows "+N more"', () => {
        render(<FillerBreakdown fillerData={fillers({ a: 8, b: 7, c: 6, d: 5, e: 4, f: 3, g: 2, h: 1 })} maxWords={3} />);
        expect(screen.getAllByTestId('filler-breakdown-word')).toHaveLength(3);
        expect(screen.getByText('+5 more')).toBeInTheDocument();
    });

    it('opens the custom-word manager from "Add your filler words"', () => {
        render(<FillerBreakdown fillerData={fillers({ um: 1 })} />);
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        // The manager renders its custom-word input once the popover opens.
        expect(screen.getByPlaceholderText(/literally/i)).toBeInTheDocument();
    });
});
