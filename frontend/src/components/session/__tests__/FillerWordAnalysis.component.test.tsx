import React from 'react';
import { render, screen, cleanup } from '../../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FillerWordAnalysis from '@/components/session/FillerWordAnalysis';



describe('FillerWordAnalysis Integration', () => {
    const mockAddUserWord = vi.fn();
    const defaultFillerWords = ['um', 'uh', 'like', 'you know'];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
        if (global.gc) {
            global.gc();
        }
    });

    describe('Filler Word Display', () => {
        it('displays all filler words with their counts', () => {
            const fillerData = {
                um: { count: 5, color: '#ff6b6b' },
                like: { count: 3, color: '#ffd93d' },
                uh: { count: 1, color: '#6bcf7f' },
            };

            render(
                <FillerWordAnalysis
                    fillerData={fillerData}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            expect(screen.getByText('um')).toBeInTheDocument();
            expect(screen.getByText('5')).toBeInTheDocument();
            expect(screen.getByText('like')).toBeInTheDocument();
            expect(screen.getByText('3')).toBeInTheDocument();
            expect(screen.getByText('uh')).toBeInTheDocument();
            expect(screen.getByText('1')).toBeInTheDocument();
        });

        it('sorts filler words by count (highest first)', () => {
            const fillerData = {
                um: { count: 2, color: '#ff6b6b' },
                like: { count: 5, color: '#ffd93d' },
                uh: { count: 3, color: '#6bcf7f' },
            };

            render(
                <FillerWordAnalysis
                    fillerData={fillerData}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const cards = screen.getAllByTestId('filler-word-card');
            // 'like' (5 counts) should be first
            expect(cards[0]).toHaveTextContent('like');
            expect(cards[0]).toHaveTextContent('5');

            // 'uh' (3 counts) should be second
            expect(cards[1]).toHaveTextContent('uh');
            expect(cards[1]).toHaveTextContent('3');

            // 'um' (2 counts) should be third
            expect(cards[2]).toHaveTextContent('um');
            expect(cards[2]).toHaveTextContent('2');
        });

        it('applies severity-based color coding', () => {
            const fillerData = {
                um: { count: 10, color: '#ff6b6b' },
                like: { count: 5, color: '#ffd93d' },
                uh: { count: 2, color: '#6bcf7f' },
                basically: { count: 1, color: '#95e1d3' },
            };

            render(
                <FillerWordAnalysis
                    fillerData={fillerData}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={[...defaultFillerWords, 'basically']}
                />
            );

            const cards = screen.getAllByTestId('filler-word-card');

            // Highest count should have 'high' severity color (red)
            expect(cards[0].className).toContain('bg-red-300');

            // 2nd-3rd should have 'medium' severity (yellow)
            expect(cards[1].className).toContain('bg-yellow-300');

            // Lower counts should have 'low' or 'default' severity
            expect(cards[2].className).toMatch(/bg-(yellow|green)-300/);
        });

        it('shows zero counts for words not detected', () => {
            const fillerData = {
                um: { count: 3, color: '#ff6b6b' },
            };

            render(
                <FillerWordAnalysis
                    fillerData={fillerData}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            // 'um' should show with count, others with 0
            expect(screen.getByText('um')).toBeInTheDocument();
            expect(screen.getByText('3')).toBeInTheDocument();

            // 'like', 'uh', 'you know' should exist with 0 count
            const allCards = screen.getAllByTestId('filler-word-card');
            expect(allCards.length).toBe(4); // All default words shown
        });
    });

    describe('User Word Addition', () => {
        it('allows adding a user filler word', async () => {
            const user = userEvent.setup();

            render(
                <FillerWordAnalysis
                    fillerData={{}}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const input = screen.getByPlaceholderText(/basically/i);
            const addButton = screen.getByRole('button', { name: /add user word/i });

            await user.type(input, 'basically');
            await user.click(addButton);

            expect(mockAddUserWord).toHaveBeenCalledWith('basically');
        });

        it('normalizes user words to lowercase', async () => {
            const user = userEvent.setup();

            render(
                <FillerWordAnalysis
                    fillerData={{}}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const input = screen.getByPlaceholderText(/basically/i);
            await user.type(input, 'Actually');
            await user.click(screen.getByRole('button', { name: /add user word/i }));

            // Should be called with lowercase version
            expect(mockAddUserWord).toHaveBeenCalledWith('actually');
        });

        it('prevents adding duplicate user words', async () => {
            const user = userEvent.setup();

            render(
                <FillerWordAnalysis
                    fillerData={{}}
                    userWords={['basically']}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const input = screen.getByPlaceholderText(/basically/i);
            await user.type(input, 'basically');
            await user.click(screen.getByRole('button', { name: /add user word/i }));

            // Should NOT be called since word already exists
            expect(mockAddUserWord).not.toHaveBeenCalled();
        });

        it('prevents adding words that are already in default list', async () => {
            const user = userEvent.setup();

            render(
                <FillerWordAnalysis
                    fillerData={{}}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const input = screen.getByPlaceholderText(/basically/i);
            await user.type(input, 'um'); // 'um' is in default list
            await user.click(screen.getByRole('button', { name: /add user word/i }));

            // Should NOT be called since 'um' is already a default
            expect(mockAddUserWord).not.toHaveBeenCalled();
        });

        it('clears input field after successful addition', async () => {
            const user = userEvent.setup();

            render(
                <FillerWordAnalysis
                    fillerData={{}}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const input = screen.getByPlaceholderText(/basically/i) as HTMLInputElement;
            await user.type(input, 'actually');
            await user.click(screen.getByRole('button', { name: /add user word/i }));

            // Input should be cleared
            expect(input.value).toBe('');
        });
    });

    describe('User Words Integration', () => {
        it('displays user words alongside default words', () => {
            const userWords = ['basically', 'actually'];
            const fillerData = {
                basically: { count: 4, color: '#ff6b6b' },
                um: { count: 2, color: '#ffd93d' },
            };

            render(
                <FillerWordAnalysis
                    fillerData={fillerData}
                    userWords={userWords}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            // Both user and default words should be visible
            expect(screen.getByText('basically')).toBeInTheDocument();
            expect(screen.getByText('um')).toBeInTheDocument();

            // Total card count should be defaults + user
            const cards = screen.getAllByTestId('filler-word-card');
            expect(cards.length).toBe(defaultFillerWords.length + userWords.length);
        });

        it('sorts user and default words together by count', () => {
            const userWords = ['basically'];
            const fillerData = {
                basically: { count: 10, color: '#ff6b6b' }, // User word with high count
                um: { count: 3, color: '#ffd93d' }, // Default word with lower count
            };

            render(
                <FillerWordAnalysis
                    fillerData={fillerData}
                    userWords={userWords}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const cards = screen.getAllByTestId('filler-word-card');
            // 'basically' (10) should be first, even though it's a user word
            expect(cards[0]).toHaveTextContent('basically');
            expect(cards[0]).toHaveTextContent('10');
        });
    });

    describe('Empty State', () => {
        it('shows all default words with zero counts when no filler data', () => {
            render(
                <FillerWordAnalysis
                    fillerData={{}}
                    userWords={[]}
                    addUserWord={mockAddUserWord}
                    defaultFillerWords={defaultFillerWords}
                />
            );

            const cards = screen.getAllByTestId('filler-word-card');
            expect(cards.length).toBe(defaultFillerWords.length);

            // All should have count of 0
            cards.forEach((card: HTMLElement) => {
                expect(card).toHaveTextContent('0');
            });
        });
    });
});
