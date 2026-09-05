/** F-07 casualty: the real completed-session parent must expose the saved-session 1+1 review. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
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
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    return { ...actual, useAuthProvider: () => ({ session: { user: { id: 'owner-1' } } }) };
});

const invoke = vi.fn();
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
        const user = userEvent.setup();

        render(<SessionPage />);
        await user.click(screen.getByRole('button', { name: 'Get my review' }));

        await waitFor(() => expect(invoke).toHaveBeenCalledWith('get-ai-suggestions', {
            body: { sessionId: 'session-complete-1' },
        }));
        expect(await screen.findAllByText('What went well')).toHaveLength(1);
        expect(screen.getAllByText('What to improve')).toHaveLength(1);
        expect(screen.getByText('Your opening stated the decision clearly.')).toBeInTheDocument();
        expect(screen.queryByText(/Session saved — nice work/i)).not.toBeInTheDocument();
    });

    it('fails closed when completion has no finalized transcript words', async () => {
        publishCompletedSession(0);
        const user = userEvent.setup();

        render(<SessionPage />);
        const button = screen.getByRole('button', { name: 'Get my review' });
        expect(button).toBeDisabled();
        expect(screen.getByTestId('practice-loop-review-not-ready')).toHaveTextContent(/needs a completed session with a saved transcript/i);
        await user.click(button);
        expect(invoke).not.toHaveBeenCalled();
    });
});
