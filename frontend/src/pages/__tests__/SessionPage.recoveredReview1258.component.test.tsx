/**
 * #1258 RWT round 2 C (Codex P1 r4300891532, Sam RETURN 6228898440) — the REAL page, after a recovered save, once the
 * failure hold has expired (runtime TERMINATED) and a queued engine-policy rejection has landed as an `error` status.
 *
 * The saved take keeps its review and `Practice this again`, and the error is VISIBLE in the real status bar. Without an
 * error the bar says the take is saved, never "Finalizing…" (a recovered save never publishes `finalizedAnalysis`).
 * CONTROL: once a newer Start retires the licence, its denied microphone is the failed start the page shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as RecoveryHook from '@/hooks/useUnresolvedRecovery';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { SttStatus } from '@/types/transcription';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUnresolvedRecovery', () => ({ useUnresolvedRecovery: vi.fn() }));
vi.mock('@/lib/supabaseClient');
vi.mock('@/lib/storage', async (orig) => {
    const actual = await orig<typeof import('@/lib/storage')>();
    return { ...actual, getSessionById: vi.fn().mockResolvedValue(null) };
});
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    const user = { id: 'owner-1' };
    return { ...actual, useAuthProvider: () => ({ session: { user }, user }) };
});

const POLICY_ERROR = 'Could not update your transcription settings.';

const lifecycle = (sttStatus: SttStatus) => ({
    isListening: false,
    isReady: true,
    metrics: { formattedTime: '00:42', wpm: 120, wpmLabel: 'Optimal', clarityScore: 80, clarityLabel: 'Good', fillerCount: 0, fillerData: {} },
    sttStatus,
    modelLoadingProgress: null,
    privateModelStatus: 'ready',
    mode: 'private' as const,
    setMode: vi.fn(),
    elapsedTime: 0,
    handleStartStop: vi.fn(),
    showAnalyticsPrompt: true,
    setShowAnalyticsPrompt: vi.fn(),
    settleReviewLatency: vi.fn(),
    sessionFeedbackMessage: null,
    micLevel: 0,
    transcriptContent: '',
    interimTranscript: '',
    canUsePrivateStt: true,
    isButtonDisabled: false,
    sunsetModal: { type: 'daily', open: false },
});

const renderPage = (sttStatus: SttStatus, recoveredSaveSessionId: string | null) => {
    vi.mocked(SessionLifecycleHook.useSessionLifecycle).mockReturnValue(
        lifecycle(sttStatus) as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);
    // The failure hold has EXPIRED: the runtime is no longer FAILED, so the bar's failure-priority branch does not apply.
    useSessionStore.setState({ runtimeState: 'TERMINATED', recoveredSaveSessionId, completedSessionId: 'session-A' });
    return render(<SessionPage />);
};

beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().resetSession();
    useSessionStore.getState().setProgressGate(null);
    // The owner's Progress gate has resolved clear, as it has by the time a saved take is reviewed.
    useSessionStore.getState().setProgressGateResolvedFor('owner-1');
    vi.mocked(RecoveryHook.useUnresolvedRecovery).mockReturnValue({
        recoveryDraft: null, acknowledgeRecoveryDraft: vi.fn(), dismissRecoveryDraft: vi.fn(),
    } as unknown as ReturnType<typeof RecoveryHook.useUnresolvedRecovery>);
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke: vi.fn() } } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe('#1258 C — a recovered save after the failure hold expires', () => {
    it('a delayed policy rejection is VISIBLE while the review and Practice again stay available', () => {
        renderPage({ type: 'error', message: POLICY_ERROR }, 'session-A');
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getAllByText(POLICY_ERROR).length, 'the policy error is on screen').toBeGreaterThan(0);
        expect(screen.getByTestId('verdict-practice-again')).toBeEnabled();
    });

    it('without an error the bar says the take is saved — never "Finalizing…"', () => {
        renderPage({ type: 'idle', message: 'Ready to record' }, 'session-A');
        expect(screen.getAllByText(/Session saved/).length).toBeGreaterThan(0);
        expect(screen.queryByText(/Finalizing your transcript/)).toBeNull();
    });

    it('CONTROL: after a newer Start retired the licence, its denied microphone shows the failed start, not A\'s review', () => {
        renderPage({ type: 'error', message: 'Mic blocked' }, null);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('mic-error')).toHaveTextContent('Mic blocked');
        expect(screen.queryByTestId('verdict-practice-again')).toBeNull();
    });
});
