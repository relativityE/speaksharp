import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';

// Mock dependencies
vi.mock('@/lib/supabaseClient');
vi.mock('@/lib/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

const mockSupabaseClient = {
    functions: {
        invoke: vi.fn(),
    },
};

describe('AISuggestions Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getSupabaseClient).mockReturnValue(mockSupabaseClient as unknown as ReturnType<typeof getSupabaseClient>);
    });

    afterEach(() => {
        cleanup();
        if (global.gc) {
            global.gc();
        }
    });

    describe('Initial State', () => {
        it('renders with call-to-action when no suggestions', () => {
            render(<AISuggestions transcript="Hello world" />);

            expect(screen.getByText(/AI-Powered Suggestions/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /get suggestions/i })).toBeInTheDocument();
            expect(screen.getByText(/click the button to get ai-powered feedback/i)).toBeInTheDocument();
        });

        it('disables button when no transcript provided', () => {
            render(<AISuggestions transcript="" />);

            const button = screen.getByRole('button', { name: /get suggestions/i });
            expect(button).toBeDisabled();
        });
    });

    describe('Fetching Suggestions', () => {
        it('shows loading state while fetching', async () => {
            const user = userEvent.setup();

            // Mock a delayed response
            mockSupabaseClient.functions.invoke.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve({ data: { suggestions: null }, error: null }), 100))
            );

            render(<AISuggestions transcript="Hello world this is a test" />);

            const button = screen.getByRole('button', { name: /get suggestions/i });
            await user.click(button);

            // Should show loading state
            expect(screen.getByRole('button', { name: /analyzing/i })).toBeInTheDocument();
            expect(await screen.findByText(/analyzing your speech/i)).toBeInTheDocument();
        });

        it('calls Supabase edge function with transcript', async () => {
            const user = userEvent.setup();
            const mockTranscript = "This is a test transcript with some filler words like um and uh";

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: {
                    suggestions: {
                        summary: "Good speaking overall",
                        suggestions: [],
                    },
                },
                error: null,
            });

            render(<AISuggestions transcript={mockTranscript} />);

            const button = screen.getByRole('button', { name: /get suggestions/i });
            await user.click(button);

            await waitFor(() => {
                expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledWith('get-ai-suggestions', {
                    body: { transcript: mockTranscript },
                });
            });
        });
    });

    describe('Displaying Suggestions', () => {
        it('displays AI summary when suggestions are received', async () => {
            const user = userEvent.setup();
            const mockSuggestions = {
                summary: "Your pacing is good but reduce filler words",
                suggestions: [],
            };

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: { suggestions: mockSuggestions },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText(/your pacing is good but reduce filler words/i)).toBeInTheDocument();
            });
        });

        it('displays individual suggestion items', async () => {
            const user = userEvent.setup();
            const mockSuggestions = {
                summary: "Good speech overall",
                suggestions: [
                    {
                        title: "Reduce Filler Words",
                        description: "Try to minimize using 'um' and 'uh'",
                    },
                    {
                        title: "Improve Pacing",
                        description: "Slow down slightly for better clarity",
                    },
                ],
            };

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: { suggestions: mockSuggestions },
                error: null,
            });

            render(<AISuggestions transcript="Hello world um uh" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText("Reduce Filler Words")).toBeInTheDocument();
                expect(screen.getByText(/minimize using 'um' and 'uh'/i)).toBeInTheDocument();
                expect(screen.getByText("Improve Pacing")).toBeInTheDocument();
                expect(screen.getByText(/slow down slightly/i)).toBeInTheDocument();
            });
        });
    });

    describe('Error Handling', () => {
        it('displays error when Supabase function fails', async () => {
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: null,
                error: { message: 'Network error' },
            });

            render(<AISuggestions transcript="Hello world" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByRole('heading', { name: /error/i })).toBeInTheDocument();
                expect(screen.getByText(/network error/i)).toBeInTheDocument();
            });
        });

        it('displays error when function returns error in body', async () => {
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: { error: 'Rate limit exceeded' },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument();
            });
        });

        it('handles missing Supabase client gracefully', async () => {
            vi.mocked(getSupabaseClient).mockReturnValue(null as unknown as ReturnType<typeof getSupabaseClient>);
            const user = userEvent.setup();

            render(<AISuggestions transcript="Hello world" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText(/supabase client not available/i)).toBeInTheDocument();
            });
        });
    });

    describe('Button State Management', () => {
        it('disables button while loading', async () => {
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve({ data: { suggestions: null }, error: null }), 100))
            );

            render(<AISuggestions transcript="Hello world" />);

            const button = screen.getByRole('button', { name: /get suggestions/i });
            await user.click(button);

            // Button should be disabled while loading
            expect(button).toBeDisabled();
        });

        it('allows fetching suggestions multiple times', async () => {
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: {
                    suggestions: {
                        summary: "Good speech",
                        suggestions: [],
                    },
                },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" />);

            const button = screen.getByRole('button', { name: /get suggestions/i });

            // First fetch
            await user.click(button);
            await waitFor(() => expect(screen.getByText(/good speech/i)).toBeInTheDocument());

            // Second fetch should work
            await user.click(button);
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(2);
        });
    });
});
