import React from 'react';
import { render, screen, cleanup, waitFor } from '../../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { OnDeviceCountsContext } from '@/components/session/onDeviceCounts';
import { getSupabaseClient } from '@/lib/supabaseClient';

// Mock dependencies
vi.mock('@/lib/supabaseClient');
// The failure counter is the subject of one casualty below, so it is observed rather than stubbed away.
vi.mock('@/services/practiceLoopTelemetry', async (orig) => {
    const actual = await orig<typeof import('@/services/practiceLoopTelemetry')>();
    return { ...actual, trackPracticeLoopReviewFailed: vi.fn() };
});
import { trackPracticeLoopReviewFailed } from '@/services/practiceLoopTelemetry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetPracticeLoopTelemetryForTests } from '@/services/telemetry/practiceLoopTelemetry';
import { __resetJourneyIdentityForTests, beginJourney } from '@/services/telemetry/journeyIdentity';
import { reachedStages, __resetCompletionStagesForTests } from '@/services/telemetry/completionStages';


const mockSupabaseClient = {
    functions: {
        invoke: vi.fn(),
    },
};

describe('AISuggestions Integration', () => {
    /** The card root, which carries the lifecycle observables (`data-lifecycle`, `data-retry-scheduled`). */
    const card = () => screen.getByTestId('ai-suggestions-card');

    beforeEach(() => {
        vi.clearAllMocks();
        // `clearAllMocks` keeps queued `mockResolvedValueOnce` answers; an answer one case queues but never consumes
        // (for example a retry the component under test does not make) must not reach the next case's request.
        mockSupabaseClient.functions.invoke.mockReset();
        vi.mocked(getSupabaseClient).mockReturnValue(mockSupabaseClient as unknown as ReturnType<typeof getSupabaseClient>);
    });

    afterEach(() => {
        cleanup();
        if (global.gc) {
            global.gc();
        }
    });

    /*
     * S-14 — while the review is still coming, the ON-DEVICE counts fill the space the verdict will occupy.
     * They are published by the view (the one owner of those numbers) and never stubbed: an unmeasured
     * value is omitted, not zeroed or dashed.
     */
    describe('S-14 — on-device counts fill the still-coming state', () => {
        it('renders the published fillers and pace while the review is pending', () => {
            mockSupabaseClient.functions.invoke.mockImplementation(() => new Promise(() => { /* in flight */ }));
            render(
                <OnDeviceCountsContext.Provider value={{ fillers: 6, wordsPerMinute: 122.4 }}>
                    <AISuggestions transcript="Hello world" canReview sessionId="s-counts" />
                </OnDeviceCountsContext.Provider>,
            );
            expect(card()).toHaveAttribute('data-lifecycle', 'pending');
            expect(screen.getByTestId('on-device-fillers')).toHaveTextContent('6');
            expect(screen.getByTestId('on-device-pace')).toHaveTextContent('122');
        });

        it('CASUALTY: an unmeasured count is omitted — never a zero, never a dash', () => {
            mockSupabaseClient.functions.invoke.mockImplementation(() => new Promise(() => { /* in flight */ }));
            render(
                <OnDeviceCountsContext.Provider value={{ fillers: null, wordsPerMinute: 110 }}>
                    <AISuggestions transcript="Hello world" canReview sessionId="s-partial" />
                </OnDeviceCountsContext.Provider>,
            );
            expect(screen.queryByTestId('on-device-fillers')).toBeNull();
            expect(screen.getByTestId('on-device-pace')).toHaveTextContent('110');
            expect(screen.getByTestId('on-device-counts').textContent ?? '').not.toMatch(/—|\b0 fillers/);
        });

        it('no counts at all ⇒ no strip, rather than an empty box', () => {
            mockSupabaseClient.functions.invoke.mockImplementation(() => new Promise(() => { /* in flight */ }));
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-none" />);
            expect(screen.queryByTestId('on-device-counts')).toBeNull();
        });
    });

    describe('Initial State', () => {
        it('#1416 P2-4 — a reviewable session is already requesting, not waiting to be asked', () => {
            // There is no call-to-action state any more: the request fires on readiness. Asserting a
            // "Get my review" button here would be asserting the click-first product that P2-4
            // removed.
            mockSupabaseClient.functions.invoke.mockImplementation(() => new Promise(() => { /* in flight */ }));
            render(<AISuggestions transcript="Hello world" sessionId="session-test" />);

            expect(screen.getByText(/Practice Loop review/i)).toBeInTheDocument();
            // The contract is "a pending lifecycle is visible", not "a button says this". The card exposes
            // the lifecycle structurally and the chip is the only progress indicator (S-14: never a spinner
            // where the verdict goes).
            expect(card()).toHaveAttribute('data-lifecycle', 'pending');
            expect(screen.getByTestId('ai-suggestions-retrying')).toBeInTheDocument();
            expect(screen.getByTestId('ai-suggestions-headline')).toHaveTextContent(/coaching is still coming/i);
        });

        it('an unreviewable session neither fires nor offers the control', () => {
            render(<AISuggestions transcript="" sessionId="session-test" />);

            expect(mockSupabaseClient.functions.invoke).not.toHaveBeenCalled();
            // Nothing is in flight and nothing failed, so no retry affordance is offered — and the card
            // says why instead of showing a dead control.
            expect(screen.queryByRole('button', { name: /retry review/i })).toBeNull();
            expect(screen.getByTestId('practice-loop-review-not-ready')).toBeInTheDocument();
            expect(card()).toHaveAttribute('data-lifecycle', 'idle');
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

            // The server-classified copy occupies the headline slot; the raw provider prose never reaches
            // the user.
            // A network failure is RECOVERABLE, so it first shows "still coming" while its single retry is
            // scheduled; the classified copy takes the headline once the lifecycle has ENDED.
            await waitFor(() => expect(card()).toHaveAttribute('data-lifecycle', 'terminal'), { timeout: 3000 });
            expect(screen.getByTestId('ai-suggestions-headline')).toHaveTextContent(/could not connect/i);
            expect(screen.queryByText(/does not have a transcript available/i)).toBeNull();
            expect(screen.getByTestId('ai-suggestions-headline').textContent).not.toMatch(/failed to fetch/i);
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

    describe('#1473 — closed service_configuration code and failure-aware retry', () => {
        const okResponse = {
            data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'Clear opening.', what_to_try_next: 'State the ask first.' } },
            error: null,
        };
        /** A FunctionsHttpError whose `context` is a Response-like object with a readable JSON body. */
        const httpErrorWithBody = (status: number, body: () => Promise<unknown>) => {
            const err = new Error('Edge Function returned a non-2xx status code') as Error & { name: string; context: unknown };
            err.name = 'FunctionsHttpError';
            err.context = { status, clone: () => ({ json: body }) };
            return { data: null, error: err };
        };
        /**
         * #1486 — the ONLY failure that still earns an automatic retry: a transport error, with no status,
         * so the request reached no verdict and therefore carries no quota receipt to charge twice. The
         * provider/5xx class (`unavailable`) is terminal now, and is driven by `httpErrorWithBody` below.
         */
        const transportFailure = () => {
            const err = new Error('network down') as Error & { name: string };
            err.name = 'FunctionsFetchError';
            return { data: null, error: err };
        };
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        // `vi.clearAllMocks()` keeps queued `mockResolvedValueOnce` answers. A case that queues an answer the component
        // under test never consumes would otherwise hand it to the NEXT case's first request.
        beforeEach(() => { mockSupabaseClient.functions.invoke.mockReset(); });

        it('CASUALTY: a 503 carrying service_configuration is terminal — one request, its own copy, one terminal report', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(
                httpErrorWithBody(503, async () => ({ error: 'AI coaching is unavailable right now.', code: 'service_configuration' })),
            );
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-config" retryBackoffMs={10} />);

            await waitFor(() => expect(screen.getByTestId('ai-suggestions-headline')).toHaveTextContent(/service setup problem on our side/i));
            await sleep(60);
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1);
            // A TERMINAL failure schedules nothing, so the RETRYING chip must not appear: claiming coaching
            // is on its way when the lifecycle has ended is a false promise (the bug this split fixed).
            expect(card()).toHaveAttribute('data-retry-scheduled', 'false');
            expect(card()).toHaveAttribute('data-lifecycle', 'terminal');
            expect(screen.queryByTestId('ai-suggestions-retrying')).toBeNull();
            expect(screen.getByTestId('ai-suggestions-headline').textContent).not.toMatch(/still coming/i);
            expect(card()).toHaveAttribute('data-review-state', 'error');
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledTimes(1);
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledWith('service_configuration');
        });

        it.each([
            ['malformed JSON', async () => { throw new SyntaxError('Unexpected token'); }],
            ['an unknown code', async () => ({ code: 'database_role_missing' })],
            ['no code', async () => ({ error: 'AI coaching is unavailable right now.' })],
        // #1486 — these prove the CLASSIFICATION fallback. The reason is still `unavailable`; what changed is that
        // `unavailable` no longer re-enters the edge function, so the fallback now settles on its first answer.
        ])('CONTROL: a 503 with %s falls back to the status classification and is not retried from here', async (_label, body) => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(httpErrorWithBody(503, body as () => Promise<unknown>));
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-fallback" retryBackoffMs={10} />);

            await waitFor(() => expect(card()).toHaveAttribute('data-review-state', 'error'));
            await sleep(60);
            expect(mockSupabaseClient.functions.invoke, 'one charged request, not two').toHaveBeenCalledTimes(1);
            expect(screen.queryByText(/service setup problem/i)).toBeNull();
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledTimes(1);
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledWith('unavailable');
        });

        it('CONTROL: the closed code is ignored on any status other than 503', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(httpErrorWithBody(401, async () => ({ code: 'service_configuration' })));
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-401-code" retryBackoffMs={10} />);

            expect(await screen.findByText(/cannot request a new review/i)).toBeInTheDocument();
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledWith('access_denied');
        });

        it('CASUALTY: a recoverable failure shows the failure, waits, retries ONCE, then settles as one terminal failure', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(transportFailure());
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-recoverable" retryBackoffMs={40} />);

            await waitFor(() => expect(card()).toHaveAttribute('data-retry-scheduled', 'true'));
            expect(card(), 'a scheduled retry is still in motion').toHaveAttribute('data-review-state', 'loading');
            // While waiting out the backoff the chip is the only indicator; no attempt is CLAIMED to be
            // active, and the lifecycle still reads pending because one retry is genuinely coming.
            expect(screen.getByTestId('ai-suggestions-retrying')).toBeInTheDocument();
            expect(card()).toHaveAttribute('data-lifecycle', 'pending');
            expect(trackPracticeLoopReviewFailed, 'the first recoverable failure is not yet an outcome').not.toHaveBeenCalled();

            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(2));
            await waitFor(() => expect(card()).toHaveAttribute('data-review-state', 'error'));
            await sleep(80);
            expect(mockSupabaseClient.functions.invoke, 'exactly ONE automatic retry, never a loop').toHaveBeenCalledTimes(2);
            expect(card(), 'nothing is scheduled once it has settled').toHaveAttribute('data-retry-scheduled', 'false');
            expect(card()).toHaveAttribute('data-lifecycle', 'terminal');
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledTimes(1);
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledWith('network');
        });

        it('CASUALTY: a recoverable failure that succeeds on its retry renders the review and reports no failure', async () => {
            mockSupabaseClient.functions.invoke
                .mockResolvedValueOnce(transportFailure())
                .mockResolvedValueOnce(okResponse);
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-recovers" retryBackoffMs={10} />);

            expect(await screen.findByText('Clear opening.')).toBeInTheDocument();
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(2);
            expect(trackPracticeLoopReviewFailed).not.toHaveBeenCalled();
        });

        it.each([401, 403, 429, 404, 409])('CONTROL: terminal status %i is never retried automatically', async (status) => {
            const err = new Error('terminal') as Error & { name: string; context: { status: number } };
            err.name = 'FunctionsHttpError';
            err.context = { status };
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: err });
            render(<AISuggestions transcript="Hello world" canReview sessionId={`s-terminal-${status}`} retryBackoffMs={10} />);

            await waitFor(() => expect(card()).toHaveAttribute('data-review-state', 'error'));
            await sleep(60);
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1);
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledTimes(1);
        });

        /**
         * #1486 — A PROVIDER FAILURE IS NOT RETRIED HERE, BECAUSE HERE IS WHERE IT COSTS A SECOND SLOT.
         *
         * The edge function consumes quota before it calls the provider, so re-entering it charges the user twice
         * for one generation action. Worse, if the first attempt spent their last slot the retry returns 429, which
         * this component maps to `rate_limited` and shows as a limit the user never reached — the outage disappears
         * behind a false claim about their account. The provider retry lives inside the edge function now.
         */
        it('CASUALTY: a provider 502 is asked ONCE from here, and never becomes a false rate-limit', async () => {
            // Attempt 1 is the provider outage. Attempt 2, if it ever happened, would be the exhausted-quota 429
            // — the exact false claim this casualty exists to forbid.
            mockSupabaseClient.functions.invoke
                .mockResolvedValueOnce(httpErrorWithBody(502, async () => ({ error: 'AI coaching could not be generated. Please try again.' })))
                .mockResolvedValue(httpErrorWithBody(429, async () => ({ error: 'Daily AI coaching limit reached. Try again tomorrow.' })));
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-502-once" retryBackoffMs={10} />);

            await waitFor(() => expect(card()).toHaveAttribute('data-review-state', 'error'));
            await sleep(60);

            expect(mockSupabaseClient.functions.invoke, 'one user action, one charged request').toHaveBeenCalledTimes(1);
            expect(card(), 'nothing is scheduled').toHaveAttribute('data-retry-scheduled', 'false');
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledTimes(1);
            expect(trackPracticeLoopReviewFailed, 'reported as the outage it was').toHaveBeenCalledWith('unavailable');
            expect(trackPracticeLoopReviewFailed).not.toHaveBeenCalledWith('rate_limited');
            expect(screen.queryByText(/temporarily limited/i), 'never a limit the user did not reach').toBeNull();
            expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
        });

        /**
         * #1486 Codex P1 — THE COMPONENT IS TESTED THE WAY THE APP RENDERS IT.
         *
         * `main.tsx` wraps the app in `StrictMode`, whose replay runs effects as setup -> cleanup -> setup.
         * Every other casualty in this file renders `AISuggestions` bare, so none of them ever executed that
         * replay — which is exactly how a cleanup that invalidated the in-flight request could discard a
         * SUCCESSFUL response and leave the card empty while the whole suite stayed green. The bug was only
         * ever visible to someone running the real app.
         *
         * Wrapping the render in `StrictMode` is the point of this casualty: it reproduces the replay, and
         * then asserts the plain thing the user cares about — the review that the provider returned is on
         * screen, and it cost exactly one request.
         */
        it('P1 CASUALTY: the automatic review survives the StrictMode effect replay', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(okResponse);
            render(
                <React.StrictMode>
                    <AISuggestions transcript="Hello world" canReview sessionId="s-strictmode" retryBackoffMs={10} />
                </React.StrictMode>,
            );

            expect(await screen.findByText('Clear opening.')).toBeInTheDocument();
            expect(await screen.findByText('State the ask first.')).toBeInTheDocument();
            // The state vocabulary is loading | error | ready | empty; a rendered valid review is 'ready'.
            await waitFor(() => expect(card()).toHaveAttribute('data-review-state', 'ready'));
            // The replay must not cost the user a second generation, and must not lose the first one.
            expect(mockSupabaseClient.functions.invoke, 'one automatic request, replay included').toHaveBeenCalledTimes(1);
            expect(trackPracticeLoopReviewFailed).not.toHaveBeenCalled();
        });

        it('CASUALTY: leaving during the backoff cancels the automatic retry', async () => {
            mockSupabaseClient.functions.invoke.mockResolvedValue(transportFailure());
            const { unmount } = render(<AISuggestions transcript="Hello world" canReview sessionId="s-leave" retryBackoffMs={40} />);

            await waitFor(() => expect(card()).toHaveAttribute('data-retry-scheduled', 'true'));
            unmount();
            await sleep(120);
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1);
            expect(trackPracticeLoopReviewFailed).not.toHaveBeenCalled();
        });

        it('CASUALTY: the manual action is unavailable while a retry is scheduled, and one press starts ONE new lifecycle', async () => {
            const err = new Error('limited') as Error & { name: string; context: { status: number } };
            err.name = 'FunctionsHttpError';
            err.context = { status: 429 };
            mockSupabaseClient.functions.invoke
                .mockResolvedValueOnce(transportFailure())
                .mockResolvedValue({ data: null, error: err });
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-manual" retryBackoffMs={40} />);

            await waitFor(() => expect(card()).toHaveAttribute('data-retry-scheduled', 'true'));
            // The manual action is a text link now; one press must still start exactly ONE new lifecycle,
            // so it stays unavailable while the automatic retry is already scheduled.
            expect(screen.getByRole('button', { name: /retry review now/i }), 'no manual press while a retry is scheduled').toBeDisabled();

            await waitFor(() => expect(card()).toHaveAttribute('data-review-state', 'error'));
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(2);
            const button = screen.getByRole('button', { name: /retry review/i });
            await userEvent.click(button);
            await waitFor(() => expect(card()).toHaveAttribute('data-review-state', 'error'));
            await sleep(80);
            expect(mockSupabaseClient.functions.invoke, 'one press, one request: a terminal 429 is not retried').toHaveBeenCalledTimes(3);
            expect(trackPracticeLoopReviewFailed).toHaveBeenCalledTimes(2);
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

        // #1473 (PM 5682363888) replaces "never auto-retry": a RECOVERABLE failure gets exactly ONE automatic retry after
        // a bounded backoff, and never more — a self-retrying request against a failing provider stays impossible.
        it('a recoverable failure is retried automatically at most once, never looped', async () => {
            // #1486 — a transport failure is the recoverable class now: no response, so no quota slot to charge
            // twice. A provider/5xx answer is terminal here and is covered by its own casualty.
            const transport = new Error('boom') as Error & { name: string };
            transport.name = 'FunctionsFetchError';
            mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: transport });
            render(<AISuggestions transcript="Hello world" canReview sessionId="s-fail" retryBackoffMs={10} />);

            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(2));
            await new Promise((r) => setTimeout(r, 80));
            expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(2);
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

            // No click: the request is already in flight because the session is reviewable. The pending
            // lifecycle is what is visible — never a spinner where the verdict goes (S-14).
            expect(card()).toHaveAttribute('data-lifecycle', 'pending');
            expect(screen.getByTestId('ai-suggestions-retrying')).toBeInTheDocument();
            // The pending lifecycle is the observable; the old "Creating your session review…" spinner copy
            // is exactly what S-14 removed from the verdict's place.
            expect(card()).toHaveAttribute('data-lifecycle', 'pending');
            expect(screen.getByTestId('ai-suggestions-retrying')).toBeInTheDocument();
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


            // The pair is rendered as the strength plus the fix in its `TRY THIS NEXT RUN` block; what the
            // user must be able to read is the SENTENCES, not the old labels.
            await waitFor(() => {
                expect(screen.getByTestId('ai-suggestions-pair')).toBeInTheDocument();
                expect(screen.getByText('What went well')).toBeInTheDocument();
                expect(screen.getByText('Try this next run')).toBeInTheDocument();
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

            // NEVER A DEAD END: the classified copy is the headline and the correction path stays offered.
            // `Review unavailable` over an empty box is what S-14 deleted.
            await waitFor(() => expect(card()).toHaveAttribute('data-lifecycle', 'terminal'));
            expect(screen.getByTestId('ai-suggestions-headline').textContent ?? '').not.toMatch(/review unavailable/i);
            expect(screen.queryByText('A strength.')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /retry review now/i })).toBeInTheDocument();
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


            // Recoverable ⇒ one scheduled retry first, so wait for the lifecycle to reach TERMINAL before
            // asserting the classified headline (leaving `pending` is not enough: an inverted branch would
            // still pass).
            await waitFor(() => expect(card()).toHaveAttribute('data-lifecycle', 'terminal'), { timeout: 3000 });
            await waitFor(() => {
                // The server-classified copy IS the headline, verbatim; the raw provider prose never shows.
                expect(screen.getByTestId('ai-suggestions-headline')).toHaveTextContent(/review could not connect/i);
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

            // No click: a reviewable session requests on its own (#1416 P2-4), so the lifecycle is already
            // pending and no manual affordance is offered to press.
            expect(card()).toHaveAttribute('data-lifecycle', 'pending');
            expect(screen.queryByRole('button', { name: /retry review now/i })).toBeNull();
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

            // #1486: a 500 is the provider class, which is TERMINAL here — the edge function has already retried the
            // provider behind its single quota consumption, so this lifecycle settles on one answer. The manual
            // action belongs to the lifecycle once it has settled as a failure, which is now immediately.
            const failure = {
                data: null,
                error: { message: 'Edge Function returned a non-2xx status code', context: { status: 500 } },
            };
            mockSupabaseClient.functions.invoke.mockReset();
            mockSupabaseClient.functions.invoke.mockResolvedValueOnce(failure);

            render(<AISuggestions transcript="Hello world" sessionId="session-retry" retryBackoffMs={10} />);

            await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalledTimes(1));
            const retry = await screen.findByRole('button', { name: /retry review/i });
            await waitFor(() => expect(retry).toBeEnabled());

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
        // `clearAllMocks` keeps queued `mockResolvedValueOnce` answers; an answer one case queues but never consumes
        // (for example a retry the component under test does not make) must not reach the next case's request.
        mockSupabaseClient.functions.invoke.mockReset();
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


/**
 * #1422 P1 (Codex 3994409733) — THE REVIEW RECEIPT IS EMITTED WHERE THE REVIEW EXISTS.
 *
 * `SessionOverhaulView` emitted the `coaching_verdict` receipt — one strength, one improvement, both
 * `generated`, `rendered: true` — the moment the Raw Takes review SETTLED, which is a fact about the
 * transcript, not about the generated review. It also marked `practice_loop_ready` and
 * `review_rendered` there. That view never sees the review: while it published that receipt this card
 * could still be requesting, could have been refused by the server, or could have been handed a
 * malformed answer it discards. Decoded, every completed Open Mic session claimed a review the user
 * may never have been shown, and the two completion links said the loop closed when it had not.
 *
 * The receipt and the two stages therefore live here, behind the same condition that puts the review
 * on screen.
 */
describe('#1422 P1 — the Open Mic review receipt belongs to the rendered review', () => {
    let pushSpy: ReturnType<typeof vi.spyOn>;
    let intersectionCallback: IntersectionObserverCallback;
    const scrollIntoView = vi.fn();

    const VALID = {
        version: 'gemini_coaching_v1' as const,
        what_worked: 'Clear opening.',
        what_to_try_next: 'Lead with the ask.',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getSupabaseClient).mockReturnValue(mockSupabaseClient as unknown as ReturnType<typeof getSupabaseClient>);
        __resetPracticeLoopTelemetryForTests();
        __resetJourneyIdentityForTests();
        __resetCompletionStagesForTests();
        beginJourney();
        pushSpy = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoView,
        });
        vi.stubGlobal('IntersectionObserver', vi.fn((callback: IntersectionObserverCallback) => {
            intersectionCallback = callback;
            return {
                root: null,
                rootMargin: '0px',
                thresholds: [0.01],
                observe: vi.fn(),
                unobserve: vi.fn(),
                disconnect: vi.fn(),
                takeRecords: vi.fn(() => []),
            } as unknown as IntersectionObserver;
        }));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    const receipts = () => pushSpy.mock.calls
        .filter((c) => c[0] === 'practice_loop')
        .map((c) => c[1] as Record<string, unknown>);

    const stages = () => ({
        ready: reachedStages().includes('practice_loop_ready'),
        rendered: reachedStages().includes('review_rendered'),
    });

    const revealReview = () => {
        const card = screen.getByTestId('ai-suggestions-card');
        intersectionCallback([
            { target: card, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry,
        ], {} as IntersectionObserver);
    };

    it('a visible 1+1 review emits exactly one truthful receipt and marks both stages once', async () => {
        mockSupabaseClient.functions.invoke.mockResolvedValue({ data: { suggestions: VALID }, error: null });

        const view = render(<AISuggestions transcript="hello" sessionId="session-ok" />);
        await waitFor(() => expect(screen.getByText('Clear opening.')).toBeInTheDocument());

        // #1466 Codex P1 (PM RETURN 4010857491) — READINESS IS NOT RENDERING. The validated review is available the
        // moment it arrives, so `practice_loop_ready` is marked now; only the rendered receipt and `review_rendered`
        // wait for the card to be seen. Gating readiness on intersection folded the user's scroll time into the
        // generation interval and collapsed the render interval to zero.
        expect({ count: receipts().length, ...stages() }).toEqual({ count: 0, ready: true, rendered: false });
        revealReview();

        // A re-render of the same session is not a second review.
        view.rerender(<AISuggestions transcript="hello" sessionId="session-ok" />);
        revealReview();

        const emitted = receipts();
        expect({ count: emitted.length, ...stages() }).toEqual({ count: 1, ready: true, rendered: true });
        expect({
            phase: emitted[0]?.phase,
            surface: emitted[0]?.review_surface,
            wentWell: emitted[0]?.what_went_well_count,
            toImprove: emitted[0]?.what_to_improve_count,
            wentWellSource: emitted[0]?.what_went_well_source,
            toImproveSource: emitted[0]?.what_to_improve_source,
            rendered: emitted[0]?.rendered,
            suppression: emitted[0]?.suppression_reason,
        }).toEqual({
            phase: 'rendered',
            surface: 'coaching_verdict',
            wentWell: 1,
            toImprove: 1,
            wentWellSource: 'generated',
            toImproveSource: 'generated',
            rendered: true,
            suppression: 'none',
        });
        // #1466 — placement provides visibility; the card never scrolls the page (and the saved confirmation with it).
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('CASUALTY: a review still in flight emits no receipt and marks neither stage', async () => {
        mockSupabaseClient.functions.invoke.mockImplementation(() => new Promise(() => { /* never settles */ }));

        render(<AISuggestions transcript="hello" sessionId="session-pending" />);
        await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalled());

        // The old emitter fired on the settled transcript, so this state reported a rendered review.
        expect({ count: receipts().length, ...stages() }).toEqual({ count: 0, ready: false, rendered: false });
    });

    it('CASUALTY: a refused review emits no receipt and marks neither stage', async () => {
        const err = new Error('server said something') as Error & { name: string; context: { status: number } };
        err.name = 'FunctionsHttpError';
        err.context = { status: 500 };
        mockSupabaseClient.functions.invoke.mockResolvedValue({ data: null, error: err });

        render(<AISuggestions transcript="hello" sessionId="session-failed" />);
        await screen.findByText(/unavailable right now/i);

        expect({ count: receipts().length, ...stages() }).toEqual({ count: 0, ready: false, rendered: false });
    });

    it('CASUALTY: a malformed answer the card refuses to render emits no receipt and marks neither stage', async () => {
        mockSupabaseClient.functions.invoke.mockResolvedValue({ data: { suggestions: { nonsense: true } }, error: null });

        render(<AISuggestions transcript="hello" sessionId="session-invalid" />);
        await waitFor(() => expect(vi.mocked(trackPracticeLoopReviewFailed).mock.calls.length).toBe(1));

        expect({ count: receipts().length, ...stages() }).toEqual({ count: 0, ready: false, rendered: false });
    });

    it('CASUALTY: a superseded session cannot emit a receipt for the session on screen', async () => {
        // A is still in flight when the user moves to B. B renders its own stored review; A's late
        // answer is discarded by the UI and must not add a receipt — the receipt would be counted
        // against B's journey for a review B never showed.
        let settleA!: (v: unknown) => void;
        mockSupabaseClient.functions.invoke.mockImplementationOnce(
            () => new Promise((resolve) => { settleA = resolve; }),
        );

        const view = render(<AISuggestions transcript="hello" sessionId="session-A" />);
        await waitFor(() => expect(mockSupabaseClient.functions.invoke).toHaveBeenCalled());
        expect(receipts().length).toBe(0);

        view.rerender(<AISuggestions transcript="hello" sessionId="session-B" initialSuggestions={VALID} />);
        await waitFor(() => expect(screen.getByText('Clear opening.')).toBeInTheDocument());
        revealReview();
        expect(receipts().length).toBe(1);

        settleA({ data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'A strength.', what_to_try_next: 'A next step.' } }, error: null });
        await new Promise((resolve) => setTimeout(resolve, 40));

        // Still exactly one, and it is still B's review that is on screen.
        expect({ count: receipts().length, aOnScreen: screen.queryByText('A strength.') !== null })
            .toEqual({ count: 1, aOnScreen: false });
        expect(screen.getByText('Clear opening.')).toBeInTheDocument();
    });

    // #1466 Codex P1 (PM RETURN) — readiness and rendering are separate intervals, each published exactly once.
    // Counted from the real `stage_latency` rows, not only the reached-stage set: the chain is seeded at
    // `session_saved` so every later stage publishes one row, and a duplicate mark would publish a second.
    it('CASUALTY: an offscreen valid review is ready once and rendered zero; first intersection renders once; repeats add nothing', async () => {
        const { markCompletionStage } = await import('@/services/telemetry/completionStages');
        markCompletionStage('session_saved');
        mockSupabaseClient.functions.invoke.mockResolvedValue({ data: { suggestions: VALID }, error: null });
        const latencyRows = (stage: string) => pushSpy.mock.calls
            .filter((c) => c[0] === 'stage_latency' && (c[1] as Record<string, unknown> | undefined)?.stage === stage)
            .length;
        const snapshot = () => ({
            readyRows: latencyRows('practice_loop_ready'),
            renderedRows: latencyRows('review_rendered'),
            receipts: receipts().length,
            ...stages(),
        });

        const view = render(<AISuggestions transcript="hello" sessionId="session-offscreen" />);
        await waitFor(() => expect(screen.getByText('Clear opening.')).toBeInTheDocument());

        // Available but not yet seen: ready once, nothing rendered.
        expect(snapshot()).toEqual({ readyRows: 1, renderedRows: 0, receipts: 0, ready: true, rendered: false });
        view.rerender(<AISuggestions transcript="hello" sessionId="session-offscreen" />);
        expect(snapshot()).toEqual({ readyRows: 1, renderedRows: 0, receipts: 0, ready: true, rendered: false });

        // First intersection renders once; repeated observer notifications and rerenders add nothing.
        revealReview();
        revealReview();
        view.rerender(<AISuggestions transcript="hello" sessionId="session-offscreen" />);
        revealReview();
        expect(snapshot()).toEqual({ readyRows: 1, renderedRows: 1, receipts: 1, ready: true, rendered: true });
    });

    it('CASUALTY: an empty review (blank takeaways) is neither ready nor rendered', async () => {
        mockSupabaseClient.functions.invoke.mockResolvedValue({
            data: { suggestions: { version: 'gemini_coaching_v1', what_worked: '   ', what_to_try_next: '' } },
            error: null,
        });

        render(<AISuggestions transcript="hello" sessionId="session-empty" />);
        await waitFor(() => expect(vi.mocked(trackPracticeLoopReviewFailed).mock.calls.length).toBe(1));

        expect({ count: receipts().length, ...stages() }).toEqual({ count: 0, ready: false, rendered: false });
    });
});
