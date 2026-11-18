/**
 * #1422 — THE BOUND MEASURES LACK OF PROGRESS, NOT ELAPSED TIME.
 *
 * React Query retries a failed read on its own with exponential backoff, and that ladder plus the
 * requests themselves can run most of fifteen seconds. While the bound only changed what the UI said,
 * treating that as "stalled" was invisible. Once the bound also CANCELS the read, it began killing
 * recoveries that had been succeeding — three CI runs lost the saved transcript on exactly this.
 *
 * WHY `useSession` IS MOCKED HERE. The shared test render pins `retry: false`, so no retry ladder can
 * exist under it and `failureCount` can never move. The one thing this test needs to control is the
 * thing that harness fixes, so the hook is replaced with a hand-driven one — and nothing else about the
 * page is faked.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '../../../tests/support/test-utils';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import { reconcileFinalizedFillers } from '@/utils/finalizedSessionAnalysis';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as RecoveryHook from '@/hooks/useUnresolvedRecovery';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { grantPracticePrivacy, resetPracticePrivacyForTests } from '../../../tests/test-utils/practicePrivacy';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUnresolvedRecovery', () => ({ useUnresolvedRecovery: vi.fn() }));
vi.mock('@/lib/supabaseClient');
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    return { ...actual, useAuthProvider: () => {
        const user = currentOwner.id ? { id: currentOwner.id } : null;
        return { session: user ? { user } : null, user };
    } };
});

// The returned functions are STABLE. Fresh `vi.fn()`s per render would change identity on every render,
// re-running the bound's effect and restarting its timer no matter what `failureCount` did — the test
// would then pass with the fix removed, which is exactly what it did before this was noticed.
const { readState, currentOwner, stableRefetch, stableAbandon } = vi.hoisted(() => ({
    readState: {
        current: {
            failureCount: 0,
            data: undefined as { id: string; user_id: string; transcript_state: string; transcript: null } | undefined,
        },
    },
    currentOwner: { id: 'owner-1' as string | null },
    stableRefetch: vi.fn(),
    stableAbandon: vi.fn(),
}));
vi.mock('@/hooks/useSession', () => ({
    useSession: () => ({
        data: readState.current.data,
        isFetching: true,                       // the read never answers in this test
        isFetchedAfterMount: Boolean(readState.current.data),
        isSuccess: Boolean(readState.current.data),
        isError: false,
        failureCount: readState.current.failureCount,
        refetch: stableRefetch,
        abandonCurrentRead: stableAbandon,
    }),
}));

const mockLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);
const mockRecovery = vi.mocked(RecoveryHook.useUnresolvedRecovery);
const invoke = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    resetPracticePrivacyForTests();
    readState.current = { failureCount: 0, data: undefined };
    currentOwner.id = 'owner-1';
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as never);
    mockRecovery.mockReturnValue({ pendingResolutionKind: null } as never);
    mockLifecycle.mockReturnValue({
        isListening: false, isReady: true,
        metrics: {
            formattedTime: '00:42', wpm: 120, wpmLabel: 'Optimal', clarityScore: 80,
            clarityLabel: 'Good', fillerCount: 0, fillerData: {},
        },
        sttStatus: { type: 'ready' as const, message: 'Ready' },
        modelLoadingProgress: null, privateModelStatus: 'ready', mode: 'private' as const,
        setMode: vi.fn(), elapsedTime: 0, handleStartStop: vi.fn(),
        showAnalyticsPrompt: true, setShowAnalyticsPrompt: vi.fn(),
        // #1428's review-latency reporter, which SessionPage now calls once the read settles. These
        // fixtures predate it; a lifecycle mock missing it makes the component throw rather than
        // exercise the settling behaviour under test.
        settleReviewLatency: vi.fn(),
        sessionFeedbackMessage: null, micLevel: 0, transcriptContent: '', interimTranscript: '',
        canUsePrivateStt: true, isButtonDisabled: false, sunsetModal: { type: 'daily', open: false },
    } as never);

    const store = useSessionStore.getState();
    store.setFinalizedWordCount(4);
    store.setFinalizedFillerData({});
    store.setFinalizedFillerCount(0);
    store.setFinalizedAnalysis({
        sessionId: 'session-progress-1', mode: 'private',
        reconciliation: reconcileFinalizedFillers('A completed saved transcript', {}),
        persistedTotal: 0,
    });
});

describe('#1422 — a retrying read is not a stalled read', () => {
    it('CASUALTY: a read that keeps retrying is never declared unavailable', async () => {
        vi.useFakeTimers();
        try {
            const view = render(<SessionPage />);
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'pending');

            // Four rounds of "nearly the whole bound, then the query layer tries again". Total elapsed is
            // far past two bounds; the read has never gone fifteen seconds without an attempt.
            for (let attempt = 1; attempt <= 4; attempt += 1) {
                await act(async () => { vi.advanceTimersByTime(14_000); });
                readState.current.failureCount = attempt;
                view.rerender(<SessionPage />);
                await act(async () => { await Promise.resolve(); });
            }

            // Still asking. Declaring failure here would abandon a read that is visibly making progress —
            // and, once the bound cancels, would destroy the recovery in flight.
            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'pending');
        } finally {
            vi.useRealTimers();
        }
    });

    it('CONTROL: a read that makes NO attempt for two full bounds does settle as unavailable', async () => {
        vi.useFakeTimers();
        try {
            render(<SessionPage />);
            // failureCount never moves: nothing is being attempted.
            await act(async () => { vi.advanceTimersByTime(15_000); });
            await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
            await act(async () => { vi.advanceTimersByTime(15_000); });
            await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

            expect(screen.getByTestId('review-transcript-notice')).toHaveAttribute('data-outcome', 'unavailable');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('#1835 — an unsaved transcript belongs only to its original completed review', () => {
    const SESSION_ID = 'session-progress-1';
    const TEXT = 'This completed speech stays only on this page.';
    const delivery = { sessionId: SESSION_ID, recordingId: 'take-1', ownerId: 'owner-1', text: TEXT };
    const finish = (view: ReturnType<typeof render>, ui = <SessionPage />, fields = delivery) => {
        const receive = mockLifecycle.mock.lastCall?.[0]?.beginLocalTranscriptReview?.();
        act(() => {
            receive?.(fields);
            useSessionStore.getState().setCompletedSessionId(SESSION_ID);
        });
        mockLifecycle.mockReturnValue({ ...mockLifecycle(), showAnalyticsPrompt: true });
        view.rerender(ui);
    };

    beforeEach(() => {
        useSessionStore.getState().setCompletedSessionId(null);
        readState.current.data = { id: SESSION_ID, user_id: 'owner-1', transcript_state: 'not_captured', transcript: null };
        mockLifecycle.mockReturnValue({ ...mockLifecycle(), showAnalyticsPrompt: false });
    });

    it('shows only the page-local text after Stop, without giving coaching saved-transcript authority', () => {
        // Even a stale opted-in settings view must not make the non-retained receipt eligible for coaching.
        grantPracticePrivacy({ ownerId: 'owner-1' });
        const view = render(<SessionPage />);
        finish(view);
        expect(screen.getByTestId('local-review-transcript')).toHaveTextContent(TEXT);
        expect(useSessionStore.getState().transcript.transcript).not.toContain(TEXT);
        expect(invoke.mock.calls.some(([endpoint]) => endpoint === 'get-ai-suggestions')).toBe(false);
        view.unmount();
        mockLifecycle.mockReturnValue({ ...mockLifecycle(), showAnalyticsPrompt: false });
        render(<SessionPage />, { route: { pathname: '/session', search: `?review=${SESSION_ID}` } });
        expect(screen.getByTestId('saved-session-return-transcript-not_captured')).toBeInTheDocument();
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    });

    it('keeps the local review across its own URL replace under the production explicit-location Routes', () => {
        const otherRouteState = { preservedField: 'unrelated navigation state' };
        const Host = () => {
            const location = useLocation();
            const navigate = useNavigate();
            return <>
                <output data-testid="review-location">{location.search}</output>
                <output data-testid="navigation-state">{JSON.stringify(location.state)}</output>
                <button type="button" onClick={() => navigate(location.pathname + location.search, { state: location.state })}>
                    Push same URL with copied state
                </button>
                <button type="button" onClick={() => navigate(-1)}>Back one entry</button>
                <button type="button" onClick={() => navigate(1)}>Forward one entry</button>
                <Routes location={location}><Route path="/session" element={<SessionPage />} /></Routes>
            </>;
        };
        const ui = <Host />;
        const view = render(ui, { route: { pathname: '/session', search: '?existing=1', state: otherRouteState } });
        finish(view, ui);
        expect(screen.getByTestId('review-location')).toHaveTextContent(`?existing=1&review=${SESSION_ID}`);
        expect(screen.getByTestId('local-review-transcript')).toHaveTextContent(TEXT);
        expect(JSON.parse(screen.getByTestId('navigation-state').textContent ?? 'null')).toMatchObject(otherRouteState);
        expect(screen.getByTestId('navigation-state')).not.toHaveTextContent(TEXT);

        fireEvent.click(screen.getByText('Push same URL with copied state'));
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Back one entry'));
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Forward one entry'));
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    });

    it.each([
        ['another owner', { ...delivery, ownerId: 'owner-2' }],
        ['another completed session', { ...delivery, sessionId: 'a-different-session' }],
    ])('refuses a handoff for %s', (_label, fields) => {
        const view = render(<SessionPage />);
        finish(view, <SessionPage />, fields);
        expect(screen.queryByTestId('local-review-transcript')).not.toBeInTheDocument();
    });

    it('a new recording retires the text and a prior in-flight Stop receiver', () => {
        const view = render(<SessionPage />);
        finish(view);
        const receiver = mockLifecycle.mock.lastCall?.[0]?.beginLocalTranscriptReview?.();
        act(() => {
            mockLifecycle.mock.lastCall?.[0]?.clearLocalTranscriptReview?.();
            receiver?.(delivery);
        });
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    });

    it('sign-out and later sign-in do not restore the local copy', () => {
        const view = render(<SessionPage />);
        finish(view);
        currentOwner.id = null;
        view.rerender(<SessionPage />);
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
        currentOwner.id = 'owner-1';
        view.rerender(<SessionPage />);
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    });

    it('navigation away and back does not restore the local copy even if this component stays mounted', () => {
        const Controls = () => {
            const navigate = useNavigate();
            return <>
                <button type="button" onClick={() => navigate('/history')}>Leave the practice page</button>
                <button type="button" onClick={() => navigate(-1)}>Return to the practice page</button>
            </>;
        };
        const ui = <><SessionPage /><Controls /></>;
        const view = render(ui);
        finish(view, ui);
        expect(screen.getByText(TEXT)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Leave the practice page'));
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Return to the practice page'));
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    });

    it('retires the page-local copy on pagehide without needing a React unmount', () => {
        const view = render(<SessionPage />);
        finish(view);
        expect(screen.getByText(TEXT)).toBeInTheDocument();
        act(() => { window.dispatchEvent(new Event('pagehide')); });
        expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    });
    it.each(['successor', 'owner change', 'unmount', 'revoked saved row'] as const)(
        'a late Retry Save receipt cannot display text after %s',
        (transition) => {
            let view = render(<SessionPage />);
            const receive = mockLifecycle.mock.lastCall?.[0]?.beginLocalTranscriptReview?.();
            expect(receive).toBeDefined();
            if (transition === 'successor') {
                act(() => mockLifecycle.mock.lastCall?.[0]?.clearLocalTranscriptReview?.());
            } else if (transition === 'owner change') {
                currentOwner.id = 'owner-2';
                view.rerender(<SessionPage />);
                currentOwner.id = 'owner-1'; // Even returning to the same account does not renew the old receipt.
                view.rerender(<SessionPage />);
            } else if (transition === 'unmount') {
                view.unmount();
                view = render(<SessionPage />);
            } else {
                readState.current.data = { id: SESSION_ID, user_id: 'owner-1', transcript_state: 'expired', transcript: null };
            }
            act(() => {
                receive?.(delivery);
                useSessionStore.getState().setCompletedSessionId(SESSION_ID);
                useSessionStore.getState().setRecoveredSaveSessionId(SESSION_ID);
            });
            mockLifecycle.mockReturnValue({ ...mockLifecycle(), showAnalyticsPrompt: true });
            view.rerender(<SessionPage />);
            expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
        },
    );

});
