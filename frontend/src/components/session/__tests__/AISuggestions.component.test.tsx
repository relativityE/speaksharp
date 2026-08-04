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
            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            expect(screen.getByText(/AI Coaching Suggestions/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /get suggestions/i })).toHaveClass('w-full', 'sm:w-auto');
            expect(screen.getByText(/click the button to request ai coaching/i)).toBeInTheDocument();
        });

        it('disables button when no transcript provided', () => {
            render(<AISuggestions transcript="" sessionId="session-test" />);

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

            render(<AISuggestions transcript="Hello world this is a test" sessionId="session-test" />);

            const button = screen.getByRole('button', { name: /get suggestions/i });
            await user.click(button);

            // Should show loading state
            expect(screen.getByRole('button', { name: /analyzing/i })).toBeInTheDocument();
            expect(await screen.findByText(/analyzing your speech/i)).toBeInTheDocument();
        });

        it('calls the edge function with only the saved session id', async () => {
            const user = userEvent.setup();
            const mockTranscript = "This is a test transcript with some filler words like um and uh";

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: {
                    suggestions: {
                        version: 'gemini_coaching_v1',
                        what_worked: 'Your opening made the decision clear.',
                        what_to_try_next: 'Move the recommendation before the detail.',
                    },
                },
                error: null,
            });

            render(<AISuggestions transcript={mockTranscript} sessionId="session-test" />);

            const button = screen.getByRole('button', { name: /get suggestions/i });
            await user.click(button);

            await waitFor(() => {
                expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledWith('get-ai-suggestions', {
                    body: { sessionId: 'session-test' },
                });
            });
        });
    });

    describe('Displaying Suggestions', () => {
        it('displays the persisted two-phrase coaching result', async () => {
            const user = userEvent.setup();
            const mockSuggestions = {
                version: 'gemini_coaching_v1' as const,
                what_worked: 'Your risk example made the decision concrete.',
                what_to_try_next: 'Lead with the recommendation before the bottleneck.',
            };

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: { suggestions: mockSuggestions },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText(/your risk example made the decision concrete/i)).toBeInTheDocument();
                expect(screen.getByText(/lead with the recommendation before the bottleneck/i)).toBeInTheDocument();
            });
        });

        it('labels the two persisted coaching phrases', async () => {
            const user = userEvent.setup();
            const mockSuggestions = {
                version: 'gemini_coaching_v1' as const,
                what_worked: 'Your contrast between risk and speed clarified the tradeoff.',
                what_to_try_next: 'Cut the repeated setup and close on the decision.',
            };

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: { suggestions: mockSuggestions },
                error: null,
            });

            render(<AISuggestions transcript="Hello world um uh" sessionId="session-test" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText('What worked')).toBeInTheDocument();
                expect(screen.getByText('What to try next')).toBeInTheDocument();
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

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

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

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText(/ai coaching is temporarily rate limited/i)).toBeInTheDocument();
                expect(screen.queryByText(/rate limit exceeded/i)).not.toBeInTheDocument();
            });
        });

        it('handles missing Supabase client gracefully', async () => {
            vi.mocked(getSupabaseClient).mockReturnValue(null as unknown as ReturnType<typeof getSupabaseClient>);
            const user = userEvent.setup();

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

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
                version: 'gemini_coaching_v1' as const,
                what_worked: 'Initial session-specific strength.',
                what_to_try_next: 'Initial session-specific next step.',
            };
            render(<AISuggestions transcript="Hello world" sessionId="session-test" initialSuggestions={initialSuggestions} />);

            expect(screen.getByText('Initial session-specific strength.')).toBeInTheDocument();
            expect(screen.getByText('Initial session-specific next step.')).toBeInTheDocument();
            expect(screen.queryByText(/click the button to request ai coaching/i)).not.toBeInTheDocument();
        });

        it('replaces session A coaching immediately when navigation switches to session B', () => {
            const sessionA = {
                version: 'gemini_coaching_v1' as const,
                what_worked: 'Session A strength.',
                what_to_try_next: 'Session A next step.',
            };
            const sessionB = {
                version: 'gemini_coaching_v1' as const,
                what_worked: 'Session B strength.',
                what_to_try_next: 'Session B next step.',
            };
            const { rerender } = render(
                <AISuggestions transcript="Session A transcript" sessionId="session-a" initialSuggestions={sessionA} />,
            );

            rerender(
                <AISuggestions transcript="Session B transcript" sessionId="session-b" initialSuggestions={sessionB} />,
            );

            expect(screen.getByText('Session B strength.')).toBeInTheDocument();
            expect(screen.getByText('Session B next step.')).toBeInTheDocument();
            expect(screen.queryByText('Session A strength.')).not.toBeInTheDocument();
            expect(screen.queryByText('Session A next step.')).not.toBeInTheDocument();
        });

        it('ignores a late session A response after navigation to session B', async () => {
            const user = userEvent.setup();
            let resolveSessionA!: (value: { data: unknown; error: null }) => void;
            mockSupabaseClient.functions.invoke.mockImplementationOnce(() => new Promise((resolve) => {
                resolveSessionA = resolve;
            }));
            const sessionB = {
                version: 'gemini_coaching_v1' as const,
                what_worked: 'Session B persisted strength.',
                what_to_try_next: 'Session B persisted next step.',
            };
            const { rerender } = render(
                <AISuggestions transcript="Session A transcript" sessionId="session-a" />,
            );
            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            rerender(
                <AISuggestions transcript="Session B transcript" sessionId="session-b" initialSuggestions={sessionB} />,
            );
            expect(screen.getByText('Session B persisted strength.')).toBeInTheDocument();

            resolveSessionA({
                data: {
                    suggestions: {
                        version: 'gemini_coaching_v1',
                        what_worked: 'Late session A strength.',
                        what_to_try_next: 'Late session A next step.',
                    },
                },
                error: null,
            });

            await waitFor(() => {
                expect(screen.getByText('Session B persisted strength.')).toBeInTheDocument();
                expect(screen.queryByText('Late session A strength.')).not.toBeInTheDocument();
            });
        });
    });

    describe('Gemini disclosure persistence', () => {
        // Count-neutral by design: the edge function currently asks Gemini for four
        // suggestions, so the disclosure must not promise a specific number.
        const DISCLOSURE = /sends this session's transcript to google gemini to create ai coaching\. audio is never sent\./i;

        it('shows the Gemini disclosure in the empty state', () => {
            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            expect(screen.getByTestId('ai-suggestions-disclosure')).toHaveTextContent(DISCLOSURE);
        });

        it('keeps the Gemini disclosure visible when suggestions are prefilled', () => {
            const initialSuggestions = {
                version: 'gemini_coaching_v1' as const,
                what_worked: 'Initial session-specific strength.',
                what_to_try_next: 'Initial session-specific next step.',
            };
            render(<AISuggestions transcript="Hello world" sessionId="session-test" initialSuggestions={initialSuggestions} />);

            expect(screen.getByText('Initial session-specific strength.')).toBeInTheDocument();
            expect(screen.getByTestId('ai-suggestions-disclosure')).toHaveTextContent(DISCLOSURE);
        });

        it('keeps the Gemini disclosure visible after suggestions are generated', async () => {
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: {
                    suggestions: {
                        version: 'gemini_coaching_v1',
                        what_worked: 'The launch example made the decision concrete.',
                        what_to_try_next: 'Put the recommendation before the implementation details.',
                    },
                },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            await user.click(screen.getByRole('button', { name: /get suggestions/i }));

            await waitFor(() => {
                expect(screen.getByText('The launch example made the decision concrete.')).toBeInTheDocument();
            });
            expect(screen.getByTestId('ai-suggestions-disclosure')).toHaveTextContent(DISCLOSURE);
        });

        it('does not generate suggestions without an explicit click', () => {
            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            expect(mockSupabaseClient.functions.invoke).not.toHaveBeenCalled();
        });
    });

    describe('Button State Management', () => {
        it('disables button while loading', async () => {
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve({ data: { suggestions: null }, error: null }), 100))
            );

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

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
                        version: 'gemini_coaching_v1',
                        what_worked: 'The concise opening established the decision quickly.',
                        what_to_try_next: 'Close by restating the requested decision.',
                    },
                },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            const button = screen.getByRole('button', { name: /get suggestions/i });

            // First fetch
            await user.click(button);
            await waitFor(() => expect(screen.getByText(/concise opening established the decision/i)).toBeInTheDocument());

            // Second fetch should work
            await user.click(button);
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(2);
        });
    });
});
