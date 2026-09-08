import React from 'react';
import { render, screen, cleanup, waitFor } from '../../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';

// Mock dependencies
vi.mock('@/lib/supabaseClient');
// The failure counter is the subject of one casualty below, so it is observed rather than stubbed away.
vi.mock('@/services/practiceLoopTelemetry', async (orig) => {
    const actual = await orig<typeof import('@/services/practiceLoopTelemetry')>();
    return { ...actual, trackPracticeLoopReviewFailed: vi.fn() };
});
import { trackPracticeLoopReviewFailed } from '@/services/practiceLoopTelemetry';


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
        it('#1416 P2-4 — a reviewable session is already requesting, not waiting to be asked', () => {
            // There is no call-to-action state any more: the request fires on readiness. Asserting a
            // "Get my review" button here would be asserting the click-first product that P2-4
            // removed.
            mockSupabaseClient.functions.invoke.mockImplementation(() => new Promise(() => { /* in flight */ }));
            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            expect(screen.getByText(/Practice Loop review/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /creating review/i })).toBeInTheDocument();
        });

        it('an unreviewable session neither fires nor offers the control', () => {
            render(<AISuggestions transcript="" sessionId="session-test" />);

            expect(mockSupabaseClient.functions.invoke).not.toHaveBeenCalled();
            expect(screen.getByRole('button', { name: /retry review|refresh review/i })).toBeDisabled();
        });
    });

    describe('#1422 P3 — a failed review is classified by the SERVER\'S STATUS, not by its prose', () => {
        // The classifier matched substrings: '403', 'quota', 'transcript', 'not found'. Reword any of those
        // upstream and every outcome silently reclassifies, so the user is told the wrong thing about their
        // own session. The status is what the server actually decided.
        const httpError = (status: number) => {
            const err = new Error('server said something') as Error & { name: string; context: { status: number } };
            err.name = 'FunctionsHttpError';
            err.context = { status };
            return { data: null, error: err };
        };

        it.each([
            [403, /cannot request a new review/i],
            [401, /cannot request a new review/i],
            [429, /temporarily limited/i],
            [409, /does not have a transcript available/i],
            [404, /could not be found/i],
            [500, /unavailable right now/i],
            [502, /unavailable right now/i],
            [400, /unavailable right now/i],
        ])('status %i produces the matching copy', async (status, expected) => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(httpError(status as number));
            render(<AISuggestions transcript="Hello world" canReview sessionId={`s-${status}`} />);
            expect(await screen.findByText(expected as RegExp)).toBeInTheDocument();
        });

        it('CASUALTY: a network failure whose message CONTAINS "transcript" is not a data claim', async () => {
            // The exact defect. The old classifier saw "transcript" in a connectivity error and told the
            // user their saved session had no transcript available — a false statement about their stored
            // data, produced by a blip. Only a 409 licenses that sentence.
            const err = new Error('failed to fetch transcript for review') as Error & { name: string };
            err.name = 'FunctionsFetchError';
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: err });
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-net" />);

            expect(await screen.findByText(/could not connect/i)).toBeInTheDocument();
            expect(screen.queryByText(/does not have a transcript available/i)).toBeNull();
        });

        it('CASUALTY: prose alone cannot grant access_denied', async () => {
            // A 503 whose message happens to mention a pro plan must not read as an account restriction.
            const err = new Error('pro plan check unavailable: 403 upstream') as Error & { name: string; context: { status: number } };
            err.name = 'FunctionsHttpError';
            err.context = { status: 503 };
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: err });
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-503" />);

            expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
            expect(screen.queryByText(/cannot request a new review/i)).toBeNull();
        });

        it('the raw server prose never reaches the user', async () => {
            const err = new Error('PGRST116: row for relation "sessions" violates policy') as Error & { name: string; context: { status: number } };
            err.name = 'FunctionsHttpError';
            err.context = { status: 500 };
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: err });
            const { container } = render(<AISuggestions transcript="Hello world" canReview sessionId="s-prose" />);

            expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
            expect(container.textContent).not.toContain('PGRST116');
            expect(container.textContent).not.toContain('relation');
        });
    });

    describe('#1416 P2-4 — the first review fires itself', () => {
        const ok = {
            data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'a strength', what_to_try_next: 'an improvement' } },
            error: null,
        };

        it('fires exactly one request on reaching readiness, with no click', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(ok);
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-auto" />);

            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1));
            expect(await screen.findByText(/a strength/)).toBeInTheDocument();
        });

        it('does NOT auto-fire when the transcript authority says the session is not reviewable', async () => {
            // Composes with P2-2. An auto-fire on render readiness would send the doomed request
            // automatically, with no click left to stop it — strictly worse than the click it replaced.
            mockSupabaseClient.functions.invoke.mockResolvedValue(ok);
            render(<AISuggestions transcript="Hello world" canReview={false} sessionId="s-blocked" />);

            await new Promise((r) => setTimeout(r, 50));
            expect(mockSupabaseClient.functions.invoke).not.toHaveBeenCalled();
        });

        it('fires when readiness ARRIVES, not only when it is true at mount', async () => {
            // The real production sequence: the component mounts while finalization is still running
            // and becomes reviewable afterwards. If the guard latches before the session is
            // reviewable, the request is marked as already made and NEVER fires — the user waits
            // forever on a review nobody asked for. That is the failure the effect-level readiness
            // check prevents, and it is invisible if readiness is true at mount in every test.
            mockSupabaseClient.functions.invoke.mockResolvedValue(ok);
            const { rerender } = render(<AISuggestions transcript="Hello world" canReview={false} sessionId="s-later" />);
            await new Promise((r) => setTimeout(r, 30));
            expect(mockSupabaseClient.functions.invoke).not.toHaveBeenCalled();

            rerender(<AISuggestions transcript="Hello world" canReview sessionId="s-later" />);
            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1));
        });

        it('does not fire twice while the first request is still in flight', async () => {
            // The window the per-session guard exists for: between the effect firing and `isLoading`
            // reaching the next render, a re-render would otherwise start a second provider call —
            // billed, and racing the first.
            mockSupabaseClient.functions.invoke.mockImplementation(() => new Promise(() => { /* in flight */ }));
            const { rerender } = render(<AISuggestions transcript="Hello world" canReview sessionId="s-inflight" />);
            rerender(<AISuggestions transcript="Hello world" canReview sessionId="s-inflight" />);
            rerender(<AISuggestions transcript="Hello world more" canReview sessionId="s-inflight" />);
            await new Promise((r) => setTimeout(r, 40));

            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1);
        });

        it('does not fire twice across re-renders of the same session', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(ok);
            const { rerender } = render(<AISuggestions transcript="Hello world" canReview sessionId="s-once" />);
            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1));

            rerender(<AISuggestions transcript="Hello world" canReview sessionId="s-once" />);
            rerender(<AISuggestions transcript="Hello world different" canReview sessionId="s-once" />);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1);
        });

        it('does not auto-retry after a failure — the button owns retry', async () => {
            // A self-retrying request against a failing provider is a loop the user cannot escape,
            // and it bills on every pass.
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-fail" />);

            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1));
            await new Promise((r) => setTimeout(r, 80));
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1);
        });

        it('does not re-request a session that already carries a stored review', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(ok);
            render(
                <AISuggestions
                    transcript="Hello world"
                    canReview
                    sessionId="s-persisted"
                    initialSuggestions={{ version: 'gemini_coaching_v1', what_worked: 'stored', what_to_try_next: 'stored next' }}
                />,
            );
            await new Promise((r) => setTimeout(r, 50));
            expect(mockSupabaseClient.functions.invoke).not.toHaveBeenCalled();
        });

        it('the Gemini disclosure is present in the AUTOMATIC path, not only beside the button', async () => {
            // With a press, copy beside the button was read at the moment of the decision. With an
            // automatic send, a user must not learn their transcript went to Google from text
            // attached to a control they never touched.
            mockSupabaseClient.functions.invoke.mockResolvedValue(ok);
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-disclosure" />);

            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1));
            const disclosure = screen.getByTestId('ai-suggestions-disclosure');
            expect(disclosure).toHaveTextContent(/Google Gemini/i);
            expect(disclosure).toHaveTextContent(/Audio is never sent/i);
        });
    });

    describe('Fetching Suggestions', () => {
        it('shows loading state while fetching', async () => {

            // Mock a delayed response
            mockSupabaseClient.functions.invoke.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve({ data: { suggestions: null }, error: null }), 100))
            );

            render(<AISuggestions transcript="Hello world this is a test" sessionId="session-test" />);

            // No click: the request is already in flight because the session is reviewable.
            // Should show loading state
            expect(screen.getByRole('button', { name: /creating review/i })).toBeInTheDocument();
            expect(await screen.findByText(/creating your session review/i)).toBeInTheDocument();
        });

        it('calls the edge function with only the saved session id', async () => {
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

            // No click: a reviewable session requests on its own (#1416 P2-4).

            await waitFor(() => {
                expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledWith('get-ai-suggestions', {
                    body: { sessionId: 'session-test' },
                });
            });
        });
    });

    describe('Displaying Suggestions', () => {
        it('displays the persisted two-phrase coaching result', async () => {
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


            await waitFor(() => {
                expect(screen.getByText(/your risk example made the decision concrete/i)).toBeInTheDocument();
                expect(screen.getByText(/lead with the recommendation before the bottleneck/i)).toBeInTheDocument();
            });
        });

        it('labels the two persisted coaching phrases', async () => {
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


            await waitFor(() => {
                expect(screen.getByText('What went well')).toBeInTheDocument();
                expect(screen.getByText('What to improve')).toBeInTheDocument();
            });
        });

        it('rejects a malformed or expanded response instead of rendering partial coaching', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: {
                    suggestions: {
                        version: 'gemini_coaching_v1',
                        what_worked: 'A strength.',
                        what_to_try_next: 'An improvement.',
                        extra_generated_field: 'must not enter the review contract',
                    },
                },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            expect(await screen.findByRole('heading', { name: /review unavailable/i })).toBeInTheDocument();
            expect(screen.queryByText('A strength.')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /retry review/i })).toBeInTheDocument();
        });
    });

    describe('Error Handling', () => {
        it('displays error when Supabase function fails', async () => {

            // A real transport failure from `functions.invoke` is a FunctionsFetchError with NO status —
            // the request never reached a verdict. The previous mock was a bare object, which only
            // produced network copy because the classifier was matching the word "Network" in its prose.
            const transportError = new Error('Network error') as Error & { name: string };
            transportError.name = 'FunctionsFetchError';
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: transportError });

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);


            await waitFor(() => {
                expect(screen.getByRole('heading', { name: /review unavailable/i })).toBeInTheDocument();
                expect(screen.getByText(/review could not connect/i)).toBeInTheDocument();
                expect(screen.queryByText(/network error/i)).not.toBeInTheDocument();
            });
        });

        it('displays error when function returns error in body', async () => {

            mockSupabaseClient.functions.invoke.mockResolvedValue({
                data: { error: 'Rate limit exceeded' },
                error: null,
            });

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);


            await waitFor(() => {
                // An error in the RESPONSE BODY carries no HTTP status, so the server gave no category we
                // can trust. This used to read "temporarily limited" purely because the prose contained
                // "Rate limit" — the substring guess this PR removes. Unknown means "not now", which makes
                // no claim about the account or the saved data.
                expect(screen.getByText(/unavailable right now/i)).toBeInTheDocument();
                // The part that always mattered and still holds: the raw server prose never reaches them.
                expect(screen.queryByText(/rate limit exceeded/i)).not.toBeInTheDocument();
            });
        });

        it('handles missing Supabase client gracefully', async () => {
            vi.mocked(getSupabaseClient).mockReturnValue(null as unknown as ReturnType<typeof getSupabaseClient>);

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);


            await waitFor(() => {
                expect(screen.getByText(/review is unavailable right now/i)).toBeInTheDocument();
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
            expect(screen.queryByText(/one session-specific strength and one improvement/i)).not.toBeInTheDocument();
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


            await waitFor(() => {
                expect(screen.getByText('The launch example made the decision concrete.')).toBeInTheDocument();
            });
            expect(screen.getByTestId('ai-suggestions-disclosure')).toHaveTextContent(DISCLOSURE);
        });

        it('#1416 P2-4 — generation no longer waits for a click, and the disclosure is still shown', async () => {
            // This asserted the click-first contract directly. The PO ruling withdrew it: `LegalPage`
            // conditions provider processing on a coaching feature being USED, not on a press, and
            // the Gemini line is a disclosure rather than a consent gate. Inverted rather than
            // deleted, because the disclosure half of what it protected still matters — MORE so now
            // that nobody presses anything.
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: { suggestions: null }, error: null });
            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1));
            const disclosure = screen.getByTestId('ai-suggestions-disclosure');
            expect(disclosure).toHaveTextContent(/Google Gemini/i);
            expect(disclosure).toHaveTextContent(/Audio is never sent/i);
        });
    });

    describe('Button State Management', () => {
        it('disables button while loading', async () => {

            mockSupabaseClient.functions.invoke.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve({ data: { suggestions: null }, error: null }), 100))
            );

            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            // No click: a reviewable session requests on its own (#1416 P2-4), so the control is
            // already disabled by the automatic request rather than by a press.
            expect(screen.getByRole('button', { name: /creating review/i })).toBeDisabled();
        });

        it('CASUALTY: once a review is on screen, NO control is offered to refresh it', async () => {
            // This assertion is the inverse of the one it replaces, and the inversion is the point.
            //
            // The old control read "Refresh review" and promised something the product cannot do: the
            // coaching is generated once and persisted, so pressing it re-read the stored review and
            // rendered the identical two phrases. The user is invited to improve what they are looking
            // at, waits, and gets the same words back — which reads as the feature being broken rather
            // than working exactly as designed.
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

            // The FIRST review arrives on its own.
            await waitFor(() => expect(screen.getByText(/concise opening established the decision/i)).toBeInTheDocument());
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1);

            // No refresh, and no retry either — there is nothing here left to retry.
            expect({
                refresh: screen.queryByRole('button', { name: /refresh/i }),
                retry: screen.queryByRole('button', { name: /retry review/i }),
            }).toEqual({ refresh: null, retry: null });

            // The review itself is untouched: this removes an ACTION, not the coaching.
            expect(screen.getByText(/Close by restating the requested decision/i)).toBeInTheDocument();
        });

        it('CONTROL: after a FAILURE the retry is still offered and still works', async () => {
            // The control must survive exactly where pressing it can change the outcome. Removing it
            // there would strand a user on a failed review with no way forward — a worse defect than
            // the one being fixed.
            const user = userEvent.setup();

            mockSupabaseClient.functions.invoke.mockResolvedValueOnce({
                data: null,
                error: { message: 'Edge Function returned a non-2xx status code', context: { status: 500 } },
            });

            render(<AISuggestions transcript="Hello world" sessionId="session-retry" />);

            const retry = await screen.findByRole('button', { name: /retry review/i });

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

            await user.click(retry);

            await waitFor(() => expect(screen.getByText(/concise opening established the decision/i)).toBeInTheDocument());
            // ...and once it succeeds, the control goes away, like any other success.
            expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
        });
    });
});


/**
 * #1422 — A SUPERSEDED REQUEST REPORTS NOTHING.
 *
 * A late malformed answer for session A is correctly discarded by the UI, and used to be counted as a
 * review failure anyway — after the user had already moved to session B. The funnel then showed
 * failures nobody experienced, which is the same class of untruth as a silently missing event: a
 * number no one can act on.
 */
describe('#1422 — superseded review requests are silent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getSupabaseClient).mockReturnValue(mockSupabaseClient as unknown as ReturnType<typeof getSupabaseClient>);
    });
    afterEach(cleanup);

    it('CASUALTY: an invalid response for a SUPERSEDED session emits no failure', async () => {
        // A's request is still in flight when the component moves to B.
        let settleA!: (v: unknown) => void;
        mockSupabaseClient.functions.invoke.mockImplementationOnce(
            () => new Promise((resolve) => { settleA = resolve; }),
        );

        const view = render(<AISuggestions transcript="hello" sessionId="session-A" />);
        await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalled());

        // B takes over. Its own request answers normally.
        mockSupabaseClient.functions.invoke.mockResolvedValue({
            data: { suggestions: {
                version: 'gemini_coaching_v1',
                what_worked: 'Clear opening.',
                what_to_try_next: 'Lead with the recommendation.',
            } },
            error: null,
        });
        view.rerender(<AISuggestions transcript="hello" sessionId="session-B" />);
        await waitFor(() => expect(screen.getByText(/Clear opening/i)).toBeInTheDocument());

        vi.mocked(trackPracticeLoopReviewFailed).mockClear();

        // NOW A answers, malformed. The UI already discards it; the funnel must too.
        settleA({ data: { suggestions: { nonsense: true } }, error: null });
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect({ failuresReported: vi.mocked(trackPracticeLoopReviewFailed).mock.calls.length })
            .toEqual({ failuresReported: 0 });
        // ...and B's review is untouched by A's late answer.
        expect(screen.getByText(/Clear opening/i)).toBeInTheDocument();
    });

    it('CONTROL: an invalid response for the CURRENT session still reports once', async () => {
        // The counter must keep counting the failures users actually meet.
        mockSupabaseClient.functions.invoke.mockResolvedValue({
            data: { suggestions: { nonsense: true } },
            error: null,
        });

        render(<AISuggestions transcript="hello" sessionId="session-current" />);

        await waitFor(() => expect(vi.mocked(trackPracticeLoopReviewFailed).mock.calls.length).toBe(1));
        expect(vi.mocked(trackPracticeLoopReviewFailed).mock.calls[0][0]).toBe('invalid_response');
    });
});
