import React from 'react';
import { render, screen, cleanup, waitFor } from '../../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';

// Mock dependencies
vi.mock('@/lib/supabaseClient');


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

            expect(screen.getByText(/AI Coaching Suggestions/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /get suggestions/i })).toHaveClass('w-full', 'sm:w-auto');
            expect(screen.getByText(/click the button to request ai coaching/i)).toBeInTheDocument();
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
                    body: { transcript: mockTranscript, metrics: null, sessionId: null },
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
                expect(screen.getByRole('heading', { name: /ai coaching unavailable/i })).toBeInTheDocument();
                expect(screen.getByText(/ai coaching could not connect/i)).toBeInTheDocument();
                expect(screen.queryByText(/network error/i)).not.toBeInTheDocument();
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
                expect(screen.getByText(/ai coaching is temporarily rate limited/i)).toBeInTheDocument();
                expect(screen.queryByText(/rate limit exceeded/i)).not.toBeInTheDocument();
            });
        });

        it('handles missing Supabase client gracefully', async () => {
            vi.mocked(getSupabaseClient).mockReturnValue(null as unknown as ReturnType<typeof getSupabaseClient>);
            const user = userEvent.setup();

            render(<AISuggestions transcript="Hello world" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText(/ai coaching is unavailable right now/i)).toBeInTheDocument();
                expect(screen.queryByText(/supabase client not available/i)).not.toBeInTheDocument();
            });
        });
    });

    describe('Initial Suggestions', () => {
        it('renders with initial suggestions if provided', () => {
            const initialSuggestions = {
                summary: "Initial summary",
                suggestions: [{ title: "Initial title", description: "Initial description" }],
            };
            render(<AISuggestions transcript="Hello world" initialSuggestions={initialSuggestions} />);

            expect(screen.getByText(/"Initial summary"/i)).toBeInTheDocument();
            expect(screen.getByText("Initial title")).toBeInTheDocument();
            expect(screen.getByText("Initial description")).toBeInTheDocument();
            expect(screen.queryByText(/click the button to request ai coaching/i)).not.toBeInTheDocument();
        });
    });

    describe('Gemini disclosure persistence', () => {
        // Count-neutral by design: the edge function currently asks Gemini for four
        // suggestions, so the disclosure must not promise a specific number.
        const DISCLOSURE = /sends this session's transcript to google gemini to create ai coaching\. audio is never sent\./i;

        it('shows the Gemini disclosure in the empty state', () => {
            render(<AISuggestions transcript="Hello world" />);

            expect(screen.getByTestId('ai-suggestions-disclosure')).toHaveTextContent(DISCLOSURE);
        });

        it('keeps the Gemini disclosure visible when suggestions are prefilled', () => {
            const initialSuggestions = {
                summary: "Initial summary",
                suggestions: [{ title: "Initial title", description: "Initial description" }],
            };
            render(<AISuggestions transcript="Hello world" initialSuggestions={initialSuggestions} />);

            expect(screen.getByText("Initial title")).toBeInTheDocument();
            expect(screen.getByTestId('ai-suggestions-disclosure')).toHaveTextContent(DISCLOSURE);
        });

        it('keeps the Gemini disclosure visible after suggestions are generated', async () => {
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: {
                    suggestions: {
                        summary: "Good speech overall",
                        suggestions: [
                            { title: "Reduce Filler Words", description: "Fewer ums" },
                            { title: "Improve Pacing", description: "Slow down" },
                        ],
                    },
                },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText("Reduce Filler Words")).toBeInTheDocument();
            });
            expect(screen.getByTestId('ai-suggestions-disclosure')).toHaveTextContent(DISCLOSURE);
        });

        it('does not generate suggestions without an explicit click', () => {
            render(<AISuggestions transcript="Hello world" />);

            expect(mockSupabaseClient.functions.invoke).not.toHaveBeenCalled();
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
