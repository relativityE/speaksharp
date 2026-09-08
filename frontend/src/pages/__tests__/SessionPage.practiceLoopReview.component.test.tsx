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
/**
 * Drive the review read to the end of its budget.
 *
 * The bound does not strand the read on its first expiry — it cancels the obsolete request and starts
 * one fresh one, because cancelling and stopping there lost Focus Points users their coverage card when
 * a first read merely ran long. Two bounds is the end of it, and that is when `unavailable` + Retry is
 * the honest reading. Tests that want the exhausted state have to spend both.
 */
const settleMicrotasks = async () => {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};
const exhaustReviewReadBudget = async () => {
    await act(async () => { vi.advanceTimersByTime(15_000); });
    await settleMicrotasks();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    await settleMicrotasks();
};

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

            await exhaustReviewReadBudget();

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
            await exhaustReviewReadBudget();
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
            await exhaustReviewReadBudget();
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
            await exhaustReviewReadBudget();
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
    // #1422 Codex P2 — AN ABANDONED READ'S ANSWER MUST NOT BECOME THE REVIEW.
    //
    // The first version bounded the UI and left the request running, and its casualties used promises
    // that NEVER resolve — a combination that cannot fail, because if nothing ever arrives a test
    // proves nothing about what happens when something arrives late.
    //
    // What is guaranteed here is at the CACHE, not the wire: a cancelled query's result is discarded
    // rather than published under its key. Aborting the request itself was implemented twice and
    // reverted — it killed reads that were going to succeed. See `useSession`.
    // ---------------------------------------------------------------------------------------------

    it('CASUALTY: the first bound RE-READS rather than stranding the review', async () => {
        // This is the regression CI caught. Cancelling on the first bound and stopping there took the
        // Focus Points coverage card away from anyone whose first read merely ran long — permanently,
        // with no request left in flight and nothing on screen yet offering Retry. Abandoning the
        // obsolete request has to come with a fresh one.
        vi.useFakeTimers();
        try {
            publishCompletedSession(4, 'session-slow');
            getSessionById.mockReturnValue(new Promise(() => { /* the first read runs long */ }));
            render(<SessionPage />);
            expect(getSessionById.mock.calls.length).toBe(1);

            await act(async () => { vi.advanceTimersByTime(15_000); });
            await settleMicrotasks();

            // A SECOND read is in flight, and the surface still says pending — not "we could not load
            // it", because we are in fact still asking.
            expect({ reads: getSessionById.mock.calls.length }).toEqual({ reads: 2 });
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'pending');
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY: an abandoned read that answers LATE cannot publish its row', async () => {
        // Each read gets its OWN promise, because that is the shape of the defect: the ABANDONED first
        // request answers while a newer one is still in flight. A shared promise cannot express that —
        // resolving it settles both reads at once, so the test could not say which one published.
        //
        // The provider here also IGNORES the abort and answers anyway, which is realistic: aborting is a
        // request to stop, not a guarantee. A promise that never resolves — what the first version of
        // these casualties used — cannot detect late publication at all.
        vi.useFakeTimers();
        try {
            publishCompletedSession(4, 'session-late');
            const settlers: Array<(row: unknown) => void> = [];
            getSessionById.mockImplementation(() => new Promise((resolve) => { settlers.push(resolve); }));

            render(<SessionPage />);
            await act(async () => { vi.advanceTimersByTime(15_000); });
            await settleMicrotasks();

            // The first read was abandoned and a second is in flight.
            expect({ reads: settlers.length }).toEqual({ reads: 2 });

            await act(async () => {
                settlers[0](savedRow('available', 'A completed saved transcript', 'session-late'));
                await vi.advanceTimersByTimeAsync(50);
            });

            // The abandoned answer must not become the review. Publishing it would resurrect a read we
            // stopped believing — and, worse, grant readiness and fire the automatic request off it.
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'pending');
            expect(invoke).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
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
            await exhaustReviewReadBudget();
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

    it('CASUALTY: a saved session is READ even when the optional analysis never publishes', async () => {
        // `finalizedAnalysis` is published only when the finalized reconciliation ALSO succeeded, and
        // that reconciliation's failure is explicitly caught as non-fatal. A session could therefore
        // save perfectly, reach the after-state, and leave the review reader with no id at all: the
        // query never enabled, the settling expression never false, and the saved transcript replaced
        // indefinitely by "Loading your transcript…" for a session that had finished saving.
        //
        // The store here is in exactly that state — persisted id present, analysis absent.
        const store = useSessionStore.getState();
        store.setFinalizedWordCount(4);
        store.setFinalizedFillerData({});
        store.setFinalizedFillerCount(0);
        store.setCompletedSessionId('session-complete-1');
        store.setFinalizedAnalysis(null);

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

        // The saved row is read from the persisted id, so the review appears.
        await waitFor(() => expect(getSessionById).toHaveBeenCalledWith('session-complete-1'));
        await waitFor(() => expect(screen.queryByTestId('review-transcript-notice')).toBeNull());
    });

    it('CASUALTY: without the optional analysis, an UNAVAILABLE transcript still settles', async () => {
        // The other half of the same defect, and the half the successful-read casualty cannot see.
        //
        // The settling expression waited on `finalizedAnalysis`. When the optional reconciliation fails
        // that value never arrives, so the expression stayed true for the rest of the session and the
        // surface claimed to be loading FOREVER — even for a transcript the server had already told us
        // was gone. The user is shown a spinner instead of the honest sentence, and never offered the
        // retry that belongs to it.
        const store = useSessionStore.getState();
        store.setFinalizedWordCount(4);
        store.setFinalizedFillerData({});
        store.setFinalizedFillerCount(0);
        store.setCompletedSessionId('session-complete-1');
        store.setFinalizedAnalysis(null);

        // The server ANSWERS, and the answer does not yield a readable transcript. `expired` would not
        // discriminate here — that reading short-circuits the notice's copy — so this is the plain
        // unreadable case, which is the one the settling flag actually governs.
        getSessionById.mockResolvedValue(null);

        render(<SessionPage />);

        // It SETTLES. The exact settled reading is the server's — here `expired`, which is more precise
        // than a generic failure — and what matters is that it is no longer claiming to be loading.
        // It SETTLES: the honest sentence and the retry that belongs to it, not a permanent spinner for
        // a session the server has already answered about.
        await waitFor(() => expect(screen.getByTestId('review-transcript-notice'))
            .toHaveAttribute('data-outcome', 'unavailable'));
        expect(screen.getByTestId('review-transcript-notice')).not.toHaveTextContent(/Loading your transcript/i);
        expect(screen.getByTestId('review-transcript-retry')).toBeInTheDocument();
        expect(invoke).not.toHaveBeenCalled();
    });

    it('CASUALTY: without the optional analysis, the automatic review STILL fires', async () => {
        // The other half of the persistence fallback, and the half that was missing. The reader was moved
        // onto the persisted id; `AISuggestions` and its readiness condition were not. So in exactly the
        // state the fallback exists for — reconciliation failed, transcript saved and readable — the
        // transcript loaded and the review never ran, with a Retry control that could not fire either.
        const store = useSessionStore.getState();
        store.setFinalizedWordCount(4);
        store.setFinalizedFillerData({});
        store.setFinalizedFillerCount(0);
        store.setCompletedSessionId('session-complete-1');
        store.setFinalizedAnalysis(null);          // the optional analysis never published

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

        // The automatic post-save submission fires against the PERSISTED id.
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('get-ai-suggestions', {
            body: { sessionId: 'session-complete-1' },
        }));
    });

    it('CASUALTY: TWO CONSECUTIVE TAKES — the second must not review the first', async () => {
        // "Practice this again" does not unmount the page. `showAnalyticsPrompt` stays true and the
        // saved-session query can still hold take one's available transcript, so if the completed-session
        // identity outlives its take, the moment take two finalizes the after-state remounts the review
        // and authorizes an automatic request for the PREVIOUS session.
        //
        // That is not only a wrong render: it replays stale coaching, duplicates its telemetry, and — if
        // take one's review was not cached — spends a generation from the user's daily budget on the
        // wrong take. Budget is the part that cannot be undone by a refresh.
        publishCompletedSession(4, 'session-take-one');
        getSessionById.mockResolvedValue(savedRow('available', 'take one transcript', 'session-take-one'));
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
            body: { sessionId: 'session-take-one' },
        }));
        invoke.mockClear();

        // Take two begins. The controller supersedes the previous take's finalized signal AND its
        // completed-session identity; nothing here unmounts the page or clears the prompt.
        await act(async () => {
            const store = useSessionStore.getState();
            store.setFinalizedAnalysis(null);
            store.setCompletedSessionId(null);
        });

        // No request may fire for take one, and none may fire at all until take two has saved.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
        expect({ requestsForPreviousTake: invoke.mock.calls.length }).toEqual({ requestsForPreviousTake: 0 });
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
