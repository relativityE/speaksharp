import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PracticeLoopReviewPair } from '../PracticeLoopReviewPair';

describe('PracticeLoopReviewPair (#1258 G20 — one component, both places)', () => {
    it('two headed sections, the next run prominent, evidence under "From this session", and the action inside it', () => {
        render(<PracticeLoopReviewPair whatWorked="Clear opening." whatToTryNext="Pause instead of um." evidence={['6.2 filler words a minute, above your target.']} action={<button type="button">Go</button>} testId="pair" />);
        expect(screen.getByRole('heading', { name: 'What went well' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Try this next run' })).toBeInTheDocument();
        expect(screen.getByTestId('review-what-went-well')).toHaveTextContent('Clear opening.');
        expect(screen.getByTestId('review-try-next')).toHaveTextContent('Pause instead of um.');
        expect(screen.getByTestId('review-try-next').parentElement).toHaveClass('bg-signature');
        expect(screen.getByTestId('review-evidence')).toHaveTextContent('From this session6.2 filler words a minute, above your target.');
        expect(screen.getByTestId('review-try-next').parentElement).toContainElement(screen.getByRole('button', { name: 'Go' }));
    });
    it('#1474 (Sam 6242062148): the prescription, its evidence and its action come BEFORE "What went well" in DOM order', () => {
        render(<PracticeLoopReviewPair whatWorked="Clear opening." whatToTryNext="Pause instead of um." evidence={['6.2 filler words a minute.']} action={<button type="button">Go</button>} />);
        const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const wentWell = screen.getByRole('heading', { name: 'What went well' });
        // Reading order (headings as a screen reader lists them) and focus order (the one action) both put the next run first.
        expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Try this next run', 'What went well']);
        expect(follows(screen.getByTestId('review-try-next'), wentWell)).toBe(true);
        expect(follows(screen.getByTestId('review-evidence'), wentWell)).toBe(true);
        expect(follows(screen.getByRole('button', { name: 'Go' }), wentWell)).toBe(true);
    });
    it('no evidence and no action render neither', () => {
        render(<PracticeLoopReviewPair whatWorked="a" whatToTryNext="b" />);
        expect(screen.queryByTestId('review-evidence')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
