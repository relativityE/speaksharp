import { render, screen, fireEvent, within } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { FaqMenu } from '../FaqMenu';

// #1200 / #1222 — the FAQ is an inline dropdown opened from the global nav. It is never a
// page and never navigates away: the "FAQ" trigger drops the content open, as an accordion,
// on whatever page the user is currently on.
describe('FaqMenu', () => {
    const openPanel = () => {
        fireEvent.click(screen.getByTestId('faq-trigger'));
        return screen.getByTestId('faq-panel');
    };

    it('opens the inline panel when the FAQ trigger is clicked', () => {
        render(<FaqMenu />);
        // Panel is closed to start.
        expect(screen.queryByTestId('faq-panel')).not.toBeInTheDocument();
        const panel = openPanel();
        expect(panel).toBeInTheDocument();
        // A known question is present (progress explanation).
        expect(within(panel).getByText(/why doesn.t my first session show a progress percentage/i)).toBeInTheDocument();
        expect(within(panel).getByText(/how is my progress measured/i)).toBeInTheDocument();
    });

    it('expands a question to reveal its answer when clicked', () => {
        render(<FaqMenu />);
        const panel = openPanel();
        // Answers are collapsed by default.
        expect(within(panel).queryByTestId('faq-answer')).not.toBeInTheDocument();

        const question = within(panel).getByRole('button', {
            name: /why doesn.t my first session show a progress percentage/i,
        });
        expect(question).toHaveAttribute('data-testid', 'faq-question');
        expect(question).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(question);

        expect(question).toHaveAttribute('aria-expanded', 'true');
        const answer = within(panel).getByTestId('faq-answer');
        expect(answer).toBeInTheDocument();
        expect(answer).toHaveTextContent(/baseline set/i);
    });

    it('closes the panel on Escape', () => {
        render(<FaqMenu />);
        openPanel();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('faq-panel')).not.toBeInTheDocument();
    });
});
