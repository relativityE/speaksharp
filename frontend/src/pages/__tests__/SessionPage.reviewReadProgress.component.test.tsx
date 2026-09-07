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
import { render, screen, act } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import { reconcileFinalizedFillers } from '@/utils/finalizedSessionAnalysis';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as RecoveryHook from '@/hooks/useUnresolvedRecovery';
import { getSupabaseClient } from '@/lib/supabaseClient';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUnresolvedRecovery', () => ({ useUnresolvedRecovery: vi.fn() }));
vi.mock('@/lib/supabaseClient');
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    const user = { id: 'owner-1' };
    return { ...actual, useAuthProvider: () => ({ session: { user }, user }) };
});

// The returned functions are STABLE. Fresh `vi.fn()`s per render would change identity on every render,
// re-running the bound's effect and restarting its timer no matter what `failureCount` did — the test
// would then pass with the fix removed, which is exactly what it did before this was noticed.
const { readState, stableRefetch, stableAbandon } = vi.hoisted(() => ({
    readState: { current: { failureCount: 0 } },
    stableRefetch: vi.fn(),
    stableAbandon: vi.fn(),
}));
vi.mock('@/hooks/useSession', () => ({
    useSession: () => ({
        data: undefined,
        isFetching: true,                       // the read never answers in this test
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
    readState.current = { failureCount: 0 };
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
                readState.current = { failureCount: attempt };
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
