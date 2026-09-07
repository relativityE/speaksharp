/** F-07 casualty: the real completed-session parent must expose the saved-session 1+1 review. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
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
const savedRow = (transcriptState: string | null, transcript: string | null = 'A completed saved transcript') => ({
    id: 'session-complete-1', user_id: 'owner-1', transcript, transcript_state: transcriptState,
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

const publishCompletedSession = (wordCount: number) => {
    const store = useSessionStore.getState();
    store.setFinalizedWordCount(wordCount);
    store.setFinalizedFillerData({});
    store.setFinalizedFillerCount(0);
    store.setFinalizedAnalysis({
        sessionId: 'session-complete-1',
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
