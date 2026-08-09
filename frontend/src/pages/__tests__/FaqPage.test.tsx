import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import FaqPage from '../FaqPage';

describe('FaqPage', () => {
    it('renders the FAQ page with a heading', () => {
        render(<FaqPage />);
        expect(screen.getByTestId('faq-page')).toBeInTheDocument();
        expect(
            screen.getByRole('heading', { level: 1, name: /frequently asked questions/i }),
        ).toBeInTheDocument();
    });

    it('groups questions under labelled sections', () => {
        render(<FaqPage />);
        expect(screen.getByTestId('faq-group-privacy')).toBeInTheDocument();
        expect(screen.getByTestId('faq-group-progress')).toBeInTheDocument();
        expect(screen.getByTestId('faq-group-basics')).toBeInTheDocument();
    });

    it('renders each question as a keyboard-operable disclosure whose answer is collapsed by default', () => {
        render(<FaqPage />);
        const privacyItem = screen.getByTestId('faq-item-private-transcription');
        // Native <details> — collapsed by default (no `open` attribute).
        expect(privacyItem.tagName.toLowerCase()).toBe('details');
        expect(privacyItem).not.toHaveAttribute('open');
        expect(
            within(privacyItem).getByText(/how does transcription work/i),
        ).toBeInTheDocument();
    });

    it('carries the on-device privacy explanation migrated from the mic card', () => {
        render(<FaqPage />);
        const item = screen.getByTestId('faq-item-private-transcription');
        expect(within(item).getByText(/never uploaded to a server/i)).toBeInTheDocument();
    });

    it('explains session progress as an aggregate of four signals, baseline-anchored, coaching-first', () => {
        render(<FaqPage />);
        const item = screen.getByTestId('faq-item-how-progress-measured');
        // The four signals that make up the aggregate.
        expect(within(item).getByText(/filler rate.*clarity.*speaking pace.*pause rhythm/i)).toBeInTheDocument();
        // Personal, baseline-anchored — never a grade or cross-user comparison.
        expect(within(item).getByText(/baseline/i)).toBeInTheDocument();
        expect(within(item).getByText(/never a grade/i)).toBeInTheDocument();
        // The number is background; the takeaways are the point.
        expect(within(item).getByText(/what worked and what to try next/i)).toBeInTheDocument();
    });

    it('explains the "baseline signal" as the four named signals combined (transparency)', () => {
        render(<FaqPage />);
        const item = screen.getByTestId('faq-item-baseline-signal');
        // Names the four constituent signals — the baseline signal IS these, not a separate concept.
        expect(within(item).getByText(/filler rate, clarity, speaking pace, and pause rhythm/i)).toBeInTheDocument();
        expect(within(item).getByText(/starting point/i)).toBeInTheDocument();
        expect(within(item).getByText(/versus this baseline/i)).toBeInTheDocument();
    });

    it('explains the two practice modes', () => {
        render(<FaqPage />);
        const item = screen.getByTestId('faq-item-open-floor-vs-focus-points');
        expect(within(item).getByText(/speak freely on anything/i)).toBeInTheDocument();
        expect(within(item).getByText(/set a few things you want to cover/i)).toBeInTheDocument();
    });
});
