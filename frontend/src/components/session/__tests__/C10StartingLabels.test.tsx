import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { MicCard } from '../MicCard';
import { SessionVerdict } from '../SessionVerdict';

// #1258 C10 — Honest Start (PRODUCT_REQUIREMENTS §5, rows 1–2): while a Start is in progress the pressed control keeps its
// size and place, reads `Starting…` and is disabled; `Mic ready on this device` is hidden because it isn't true yet.
describe('C10 — Starting… on the pressed control', () => {
    it('MicCard: Start recording reads Starting…, is disabled, and hides "Mic ready on this device"', () => {
        const onStart = vi.fn();
        const { rerender } = render(<MicCard onStart={onStart} />);
        expect(screen.getByTestId('mic-status')).toHaveTextContent('Mic ready on this device');

        rerender(<MicCard onStart={onStart} starting />);
        const control = screen.getByTestId('mic-start');
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('Starting…')).toBeInTheDocument();
        expect(screen.queryByText('Start recording')).toBeNull();
        expect(screen.queryByTestId('mic-status')).toBeNull();
        fireEvent.click(control);
        expect(onStart).not.toHaveBeenCalled();
    });

    it('MicCard: without a start in progress the control and status are unchanged', () => {
        render(<MicCard onStart={vi.fn()} starting={false} />);
        expect(screen.getByTestId('mic-start')).toBeEnabled();
        expect(screen.getByText('Start recording')).toBeInTheDocument();
        expect(screen.getByTestId('mic-status')).toBeInTheDocument();
    });

    it('SessionVerdict: Practice again? reads Starting… and is disabled while its Start is in progress', () => {
        const onPracticeAgain = vi.fn();
        const { rerender } = render(
            <SessionVerdict verdictLine={null} fix={null} onPracticeAgain={onPracticeAgain} onSeeAllSessions={vi.fn()} />,
        );
        expect(screen.getByTestId('verdict-practice-again')).toHaveTextContent('Practice again?');
        expect(screen.getByTestId('verdict-practice-again')).toBeEnabled();

        rerender(
            <SessionVerdict verdictLine={null} fix={null} onPracticeAgain={onPracticeAgain} onSeeAllSessions={vi.fn()} practiceAgainStarting />,
        );
        const button = screen.getByTestId('verdict-practice-again');
        expect(button).toHaveTextContent('Starting…');
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(button);
        expect(onPracticeAgain).not.toHaveBeenCalled();
    });
});
