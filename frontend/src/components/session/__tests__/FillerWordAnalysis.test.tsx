import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FillerWordAnalysis from '@/components/session/FillerWordAnalysis';

const mockAddCustomWord = vi.fn();

const defaultProps = {
    fillerData: {
        'um': { count: 5, color: '' },
        'like': { count: 10, color: '' },
    },
    customWords: [],
    addCustomWord: mockAddCustomWord,
    defaultFillerWords: ['um', 'like', 'so'],
};

describe('FillerWordAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders filler word cards sorted by count', () => {
        render(<FillerWordAnalysis {...defaultProps} />);
        const cards = screen.getAllByTestId('filler-word-card');
        expect(cards).toHaveLength(3);
        expect(cards[0]).toHaveTextContent('like10');
        expect(cards[1]).toHaveTextContent('um5');
        expect(cards[2]).toHaveTextContent('so0');
    });

    it('adds a new custom filler word', () => {
        render(<FillerWordAnalysis {...defaultProps} />);
        const input = screen.getByPlaceholderText('e.g., basically');
        const addButton = screen.getByRole('button', { name: 'Add custom filler word' });

        fireEvent.change(input, { target: { value: 'basically' } });
        fireEvent.click(addButton);

        expect(mockAddCustomWord).toHaveBeenCalledWith('basically');
    });

    it('does not add a duplicate custom filler word', () => {
        const props = {
            ...defaultProps,
            customWords: ['basically'],
        };
        render(<FillerWordAnalysis {...props} />);
        const input = screen.getByPlaceholderText('e.g., basically');
        const addButton = screen.getByRole('button', { name: 'Add custom filler word' });

        fireEvent.change(input, { target: { value: 'basically' } });
        fireEvent.click(addButton);

        expect(mockAddCustomWord).not.toHaveBeenCalled();
    });

    it('does not add a duplicate default filler word', () => {
        render(<FillerWordAnalysis {...defaultProps} />);
        const input = screen.getByPlaceholderText('e.g., basically');
        const addButton = screen.getByRole('button', { name: 'Add custom filler word' });

        fireEvent.change(input, { target: { value: 'like' } });
        fireEvent.click(addButton);

        expect(mockAddCustomWord).not.toHaveBeenCalled();
    });
});
