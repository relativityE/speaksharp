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

    it('carries the progress explanation migrated from the "?" popover', () => {
        render(<FaqPage />);
        const item = screen.getByTestId('faq-item-how-progress-measured');
        expect(within(item).getByText(/speaking pace, detected filler words/i)).toBeInTheDocument();
        expect(within(item).getByText(/directional/i)).toBeInTheDocument();
    });

    it('explains the two practice modes', () => {
        render(<FaqPage />);
        const item = screen.getByTestId('faq-item-open-floor-vs-focus-points');
        expect(within(item).getByText(/speak freely on anything/i)).toBeInTheDocument();
        expect(within(item).getByText(/set a few things you want to cover/i)).toBeInTheDocument();
    });
});
