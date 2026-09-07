/** F-07 casualty: the real completed-session parent must expose the saved-session 1+1 review. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import { reconcileFinalizedFillers } from '@/utils/finalizedSessionAnalysis';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as RecoveryHook from '@/hooks/useUnresolvedRecovery';
import { getSupabaseClient } from '@/lib/supabaseClient';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUnresolvedRecovery', () => ({ useUnresolvedRecovery: vi.fn() }));
vi.mock('@/lib/supabaseClient');
// Readiness is the SERVER's transcript state (#1422 P2), so the saved-session read is part of the
// journey now — not an incidental dependency. `getSessionById` is the one place it comes from.
vi.mock('@/lib/storage', async (orig) => {
    const actual = await orig<typeof import('@/lib/storage')>();
    return { ...actual, getSessionById: (...args: unknown[]) => getSessionById(...args) };
});
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    // The real provider exposes `user` alongside `session`, and `useSession` reads `user` directly —
    // without it the saved-session query stays disabled and readiness can never be granted, which is
    // now the thing under test rather than an incidental detail.
    const user = { id: 'owner-1' };
    return { ...actual, useAuthProvider: () => ({ session: { user }, user }) };
});

const invoke = vi.fn();
// `vi.hoisted`, because the mock factory below is hoisted above ordinary consts and would otherwise
// capture an uninitialised binding.
const { getSessionById } = vi.hoisted(() => ({ getSessionById: vi.fn() }));

/** The saved row as the server reports it. `transcript_state` is the only thing that grants readiness. */
const savedRow = (transcriptState: string | null, transcript: string | null = 'A completed saved transcript', id = 'session-complete-1') => ({
    id, user_id: 'owner-1', transcript, transcript_state: transcriptState,
    total_words: 4, duration: 42, created_at: new Date().toISOString(), status: 'completed',
});
const mockLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);
const mockRecovery = vi.mocked(RecoveryHook.useUnresolvedRecovery);

const lifecycle = () => ({
    isListening: false,
    isReady: true,
    metrics: {
        formattedTime: '00:42', wpm: 120, wpmLabel: 'Optimal', clarityScore: 80,
        clarityLabel: 'Good', fillerCount: 0, fillerData: {},
    },
    sttStatus: { type: 'ready' as const, message: 'Ready' },
    modelLoadingProgress: null,
    privateModelStatus: 'ready',
    mode: 'private' as const,
    setMode: vi.fn(),
    elapsedTime: 0,
    handleStartStop: vi.fn(),
    showAnalyticsPrompt: true,
    setShowAnalyticsPrompt: vi.fn(),
    sessionFeedbackMessage: null,
    micLevel: 0,
    transcriptContent: '',
    interimTranscript: '',
    canUsePrivateStt: true,
    isButtonDisabled: false,
    sunsetModal: { type: 'daily', open: false },
});

const publishCompletedSession = (wordCount: number, sessionId = 'session-complete-1') => {
    const store = useSessionStore.getState();
    store.setFinalizedWordCount(wordCount);
    store.setFinalizedFillerData({});
    store.setFinalizedFillerCount(0);
    store.setFinalizedAnalysis({
        sessionId,
        mode: 'private',
        reconciliation: reconcileFinalizedFillers('A completed saved transcript', {}),
        persistedTotal: 0,
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().resetSession();
    mockLifecycle.mockReturnValue(lifecycle() as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);
    mockRecovery.mockReturnValue({
        recoveryDraft: null, acknowledgeRecoveryDraft: vi.fn(), dismissRecoveryDraft: vi.fn(),
    } as unknown as ReturnType<typeof RecoveryHook.useUnresolvedRecovery>);
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
    // Default: the server retained the transcript, so the review is genuinely ready.
    getSessionById.mockResolvedValue(savedRow('available'));
});

describe('F-07 completed-session Practice Loop review', () => {
    it('CASUALTY: requests the owner-scoped saved session and renders exactly one approved 1+1 pair', async () => {
        publishCompletedSession(4);
        invoke.mockResolvedValue({
            data: { suggestions: {
                version: 'gemini_coaching_v1',
                what_worked: 'Your opening stated the decision clearly.',
                what_to_try_next: 'Put the supporting example before the implementation detail.',
            } },
            error: null,
        });
        render(<SessionPage />);

        // #1416 P2-4 — NO CLICK. The completed session reaches post-save readiness and the review
        // requests itself. This is the parent-level proof of the PO ruling: the whole journey, from a
        // finished session to a request, with nobody pressing anything.
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('get-ai-suggestions', {
            body: { sessionId: 'session-complete-1' },
        }));
        expect(await screen.findAllByText('What went well')).toHaveLength(1);
        expect(screen.getAllByText('What to improve')).toHaveLength(1);
        expect(screen.getByText('Your opening stated the decision clearly.')).toBeInTheDocument();
        expect(screen.queryByText(/Session saved — nice work/i)).not.toBeInTheDocument();
    });

    it('P2/P5 CASUALTY: a RETENTION FAILURE withholds the review and sends no doomed request', async () => {
        // `complete_session_v2` can save the session and still report `transcript_outcome:
        // "retention_failed"`. The controller publishes `finalizedAnalysis` either way and the LOCAL word
        // count stays positive, so readiness derived from that count said "ready" while the row held no
        // readable transcript. With the request firing automatically, that sent a call
        // `get-ai-suggestions` MUST reject — it requires `transcript_state === "available"` and answers
        // 409 — spending one of the user's ten daily generations to land them on an error for a session
        // that saved perfectly well.
        publishCompletedSession(4);
        getSessionById.mockResolvedValue(savedRow('expired', null));

        render(<SessionPage />);

        expect(await screen.findByTestId('practice-loop-review-not-ready')).toBeInTheDocument();
        // Long enough for an auto-fire to have happened if the gate were wrong.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(invoke).not.toHaveBeenCalled();
    });

    it('P2/P5 CASUALTY: a transcript that was never captured also withholds', async () => {
        publishCompletedSession(4);
        getSessionById.mockResolvedValue(savedRow('not_captured', null));

        render(<SessionPage />);

        expect(await screen.findByTestId('practice-loop-review-not-ready')).toBeInTheDocument();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(invoke).not.toHaveBeenCalled();
    });

    it('CASUALTY: a STALLED read settles as unavailable WITH Retry, not a permanent spinner', async () => {
        // The read that never answers. `reviewFetching` stays true forever, so the notice reported
        // "Loading your transcript…" indefinitely — and Retry belongs to the FAILED reading, not the
        // pending one, so the user was left on a spinner with nothing to press for a session that saved
        // perfectly well.
        vi.useFakeTimers();
        try {
            publishCompletedSession(4);
            getSessionById.mockReturnValue(new Promise(() => { /* never settles */ }));

            render(<SessionPage />);

            // Before the bound: still honestly pending, and no recovery offered yet.
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'pending');

            await act(async () => { vi.advanceTimersByTime(15_000); });

            // After it: the honest statement is "we could not load it", which is the reading that offers
            // recovery.
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');
            expect(screen.getByTestId('review-transcript-retry')).toBeInTheDocument();
            // FAIL-CLOSED PRESERVED: a stall must never become a doomed automatic request.
            expect(invoke).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY: Retry re-READS and recovers — it does not regenerate', async () => {
        vi.useFakeTimers();
        try {
            publishCompletedSession(4);
            getSessionById.mockReturnValue(new Promise(() => { /* stalls */ }));
            render(<SessionPage />);
            await act(async () => { vi.advanceTimersByTime(15_000); });
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');

            // The server answers on the retry.
            getSessionById.mockResolvedValue(savedRow('available'));
            invoke.mockResolvedValue({
                data: { suggestions: {
                    version: 'gemini_coaching_v1', what_worked: 'Clear opening.',
                    what_to_try_next: 'Lead with the recommendation.',
                } },
                error: null,
            });
            // Real timers from here: the recovery is asynchronous and `waitFor` cannot advance a fake
            // clock. The bound has already been exercised above; what follows is the recovery itself.
            vi.useRealTimers();
            await act(async () => { screen.getByTestId('review-transcript-retry').click(); });

            // Recovered: the retry RE-READ the saved row rather than regenerating coaching, and the
            // bound reset with the new read.
            await waitFor(() => expect(screen.queryByTestId('review-transcript-notice')).toBeNull());
            expect(getSessionById.mock.calls.length).toBeGreaterThan(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY: a stalled read for one session cannot condemn the NEXT session', async () => {
        // The timeout verdict belongs to the read that earned it. Carrying it across sessions would mark
        // a perfectly readable transcript unavailable because a previous one stalled.
        vi.useFakeTimers();
        try {
            publishCompletedSession(4);
            getSessionById.mockReturnValue(new Promise(() => { /* stalls */ }));
            const view = render(<SessionPage />);
            await act(async () => { vi.advanceTimersByTime(15_000); });
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');
            view.unmount();

            // A new session, which reads cleanly.
            useSessionStore.getState().resetSession();
            getSessionById.mockResolvedValue(savedRow('available'));
            publishCompletedSession(4);
            render(<SessionPage />);
            await act(async () => { await vi.advanceTimersByTimeAsync(100); });

            expect(screen.queryByTestId('review-transcript-notice')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY: a timed-out verdict does not carry into the NEXT read in the same mount', async () => {
        // The bound belongs to the read that earned it. Without resetting per read, one stalled session
        // would mark every later session unavailable for the life of the page — and unmounting is not the
        // production shape: the user records again on the same screen.
        vi.useFakeTimers();
        try {
            publishCompletedSession(4, 'session-stalled');
            getSessionById.mockReturnValue(new Promise(() => { /* stalls */ }));
            render(<SessionPage />);
            await act(async () => { vi.advanceTimersByTime(15_000); });
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');

            // Real timers from here: `waitFor` cannot advance a fake clock, and the bound has already
            // been exercised above.
            vi.useRealTimers();

            // A NEW session on the same mounted page whose read is STILL IN FLIGHT.
            //
            // This is the case that discriminates. Asserting the notice disappears would prove nothing:
            // it disappears whenever the transcript resolves as available, flag or no flag. The flag only
            // decides what an UNAVAILABLE view is called — "loading" or "we could not load it" — so the
            // second read has to still be pending for the difference to be visible.
            getSessionById.mockReturnValue(new Promise(() => { /* the next read is pending too */ }));
            await act(async () => { publishCompletedSession(4, 'session-next'); });

            // Pending, not the previous read's verdict. Without the per-read reset this still says
            // `unavailable`, telling the user a session we have not finished asking about is unreadable.
            await waitFor(() => expect(screen.getByTestId('review-transcript-notice'))
                .toHaveAttribute('data-outcome', 'pending'));
        } finally {
            vi.useRealTimers();
        }
    });

    // ---------------------------------------------------------------------------------------------
    // #1422 Codex P2 — A BOUND THAT ONLY STOPS LISTENING IS A LEAK.
    //
    // The first version of this fix bounded the UI and left the request running, and the casualties
    // above used promises that NEVER resolve. That combination cannot fail: if nothing ever arrives,
    // a test proves nothing about what happens when something arrives late. These three close it.
    // ---------------------------------------------------------------------------------------------

    it('CASUALTY: the bound ABORTS the request — it does not merely stop listening to it', async () => {
        vi.useFakeTimers();
        try {
            publishCompletedSession(4, 'session-stalled');
            getSessionById.mockReturnValue(new Promise(() => { /* stalls */ }));
            render(<SessionPage />);
            await act(async () => { vi.advanceTimersByTime(15_000); });

            // The read must have been handed a signal, and the bound must have fired it. Without the
            // signal reaching the data layer, cancellation stops at our own component boundary and the
            // request keeps running against the server.
            const signal = getSessionById.mock.calls[0]?.[1] as AbortSignal | undefined;
            expect({ received: signal instanceof AbortSignal, aborted: signal?.aborted })
                .toEqual({ received: true, aborted: true });
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY: an abandoned read that answers LATE cannot publish its row', async () => {
        // The provider here IGNORES the abort and answers anyway — a hostile but entirely realistic
        // shape, since aborting is a request to stop, not a guarantee. This is the only shape that can
        // distinguish "we discarded the answer" from "no answer ever came".
        vi.useFakeTimers();
        try {
            publishCompletedSession(4, 'session-late');
            let settle!: (row: unknown) => void;
            getSessionById.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
            render(<SessionPage />);
            await act(async () => { vi.advanceTimersByTime(15_000); });
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');

            await act(async () => {
                settle(savedRow('available', 'A completed saved transcript', 'session-late'));
                await vi.advanceTimersByTimeAsync(100);
            });

            // The answer belongs to a read we stopped believing. Publishing it would resurrect the
            // review from a request the user was already told had failed — and, worse, would grant
            // readiness and fire the automatic request off an abandoned read.
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');
            expect(invoke).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY: leaving the session ABANDONS its in-flight read', async () => {
        // Retirement, not timeout. The user navigates away while the read is still running; nothing has
        // failed and no bound has expired, but the request has outlived the only reader that wanted it.
        //
        // React Query provides this, not code in SessionPage: an explicit cancel-on-unmount was written,
        // mutation-tested, found redundant and removed. The casualty stays because the REQUIREMENT is
        // ours — if the query layer is ever configured or replaced such that abandoned reads keep
        // running, this is what notices.
        publishCompletedSession(4, 'session-leaving');
        getSessionById.mockReturnValue(new Promise(() => { /* still in flight when we leave */ }));

        const { unmount } = render(<SessionPage />);
        await waitFor(() => expect(getSessionById).toHaveBeenCalled());

        const signal = getSessionById.mock.calls[0]?.[1] as AbortSignal;
        expect({ aborted: signal?.aborted, phase: 'still mounted' })
            .toEqual({ aborted: false, phase: 'still mounted' });

        unmount();

        await waitFor(() => expect({ aborted: signal.aborted, phase: 'after leaving' })
            .toEqual({ aborted: true, phase: 'after leaving' }));
    });

    it('CASUALTY: Retry clears the verdict — the fresh read reads as PENDING, not still-failed', async () => {
        // The existing recovery casualty above cannot catch this. It lets the retry SUCCEED, and once the
        // transcript is available the notice disappears whether or not the stale verdict was cleared —
        // the same non-discriminating shape that hid the inert retry in the first place.
        //
        // The difference is only visible while the SECOND read is still in flight: a cleared verdict says
        // "asking again", a stale one says "we could not load it" underneath a request that is running.
        // That second reading is the dead end this whole finding is about.
        vi.useFakeTimers();
        try {
            publishCompletedSession(4);
            getSessionById.mockReturnValue(new Promise(() => { /* stalls */ }));
            render(<SessionPage />);
            await act(async () => { vi.advanceTimersByTime(15_000); });
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');

            vi.useRealTimers();

            // The retry's read is ALSO still pending.
            getSessionById.mockReturnValue(new Promise(() => { /* the re-read is in flight */ }));
            await act(async () => { screen.getByTestId('review-transcript-retry').click(); });

            await waitFor(() => expect(screen.getByTestId('review-transcript-notice'))
                .toHaveAttribute('data-outcome', 'pending'));
        } finally {
            vi.useRealTimers();
        }
    });

    it('P2/P5 CASUALTY: an UNSETTLED read withholds — unknown is not permission', async () => {
        // The read has not answered yet. "We do not know whether a transcript is there" must not fire a
        // request on optimism; the request is not free.
        publishCompletedSession(4);
        getSessionById.mockReturnValue(new Promise(() => { /* never settles */ }));

        render(<SessionPage />);

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(invoke).not.toHaveBeenCalled();
    });

    it('P2/P5: readiness follows the SERVER, not the local word count', async () => {
        // The mirror of the above: zero locally-counted words but a transcript the server retained is
        // ready. The local count was never the authority — it just looked like one.
        publishCompletedSession(0);
        getSessionById.mockResolvedValue(savedRow('available'));
        invoke.mockResolvedValue({
            data: { suggestions: {
                version: 'gemini_coaching_v1',
                what_worked: 'Clear opening.',
                what_to_try_next: 'Lead with the recommendation.',
            } },
            error: null,
        });

        render(<SessionPage />);

        await waitFor(() => expect(invoke).toHaveBeenCalledWith('get-ai-suggestions', {
            body: { sessionId: 'session-complete-1' },
        }));
    });
});
