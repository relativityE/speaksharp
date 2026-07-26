/**
 * SessionPage Feedback Tests
 *
 * Tests validate real user-facing behavior:
 * - "Session too short" warning when stopped < 5s
 * - "Session saved" success with streak update
 * - Feedback clears on new session start
 *
 * Mock Count Justification:
 * The 15+ mocks silence child components (cards, panels) that are tested
 * separately. This isolates SessionPage's feedback orchestration logic.
 * The StatusNotificationBar mock captures props to verify correct messages.
 *
 * @see SessionPage.tsx for the component under test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import React from 'react';
import { useSessionStore } from '@/stores/useSessionStore';
import { reconcileFinalizedFillers } from '@/utils/finalizedSessionAnalysis';

// Post-save UI is gated on the TERMINAL finalizedAnalysis signal (published after the native formatter
// completes). Seed it so `postSaveReady` is true in tests that exercise the settled bar.
const seedFinalized = (mode: string) => useSessionStore.setState({
    finalizedAnalysis: { sessionId: 'sess-test', mode, reconciliation: reconcileFinalizedFillers('hello there', null), persistedTotal: 0 },
});

// --- Mocks ---
const mockNavigate = vi.fn();

// Mock dependencies
vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), init: vi.fn() },
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// Mock the main hook that SessionPage uses
vi.mock('@/hooks/useSessionLifecycle', () => ({
    useSessionLifecycle: vi.fn(),
}));

vi.mock('@/hooks/useUserFillerWords', () => ({
    useUserFillerWords: () => ({ userFillerWords: [] }),
}));

vi.mock('@/services/sessionRecoveryDraft', () => ({
    // #1033 A6: SessionPage now reads recovery drafts ONLY through the owner-scoped reader.
    getRecoverableDraftForUser: vi.fn(),
    clearSessionRecoveryDraft: vi.fn(),
}));

// #1033 A5/A6: SessionPage scopes recovery to the authenticated owner; provide one while keeping
// the module's other exports (AuthContext, AuthProvider) intact.
vi.mock('@/contexts/AuthProvider', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/contexts/AuthProvider')>()),
    useAuthProvider: () => ({ session: { user: { id: 'owner-user' } } }),
}));

// Mock child components to verify props passed to them
vi.mock('@/components/session/StatusNotificationBar', () => ({
    StatusNotificationBar: ({ status, analyticsAction, privateCta }: {
        status: { message?: string, type?: string },
        analyticsAction?: { cueKey?: string | number },
        privateCta?: { onSelect: () => void },
    }) => (
        <div data-testid="status-bar">
            {status?.message}
            {status?.type && <span data-testid="status-type">{status.type}</span>}
            {/* Consolidated post-save actions now live inside the ONE status bar. */}
            {privateCta && (
                <button data-testid="post-save-private-cta" onClick={() => privateCta.onSelect()}>
                    Try Private — the main beta experience
                </button>
            )}
            {analyticsAction && (
                <a data-testid="post-save-review-session-link" href="/analytics" data-cue-key={String(analyticsAction.cueKey ?? '')}>
                    Analytics
                </a>
            )}
        </div>
    ),
}));

// Mock other components to silence them. LiveRecordingCard exposes the `statusMessage` prop it receives
// so tests can prove SessionPage suppresses the recording-card pill message during post-save.
vi.mock('@/components/session/LiveRecordingCard', () => ({
    LiveRecordingCard: ({ statusMessage }: { statusMessage?: string }) => (
        <div data-testid="lrc-status-message">{statusMessage}</div>
    ),
}));
vi.mock('@/components/session/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => <div /> }));
vi.mock('@/components/session/FillerWordsCard', () => ({ FillerWordsCard: () => <div /> }));
vi.mock('@/components/session/SpeakingTipsCard', () => ({ SpeakingTipsCard: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('@/components/session/UserFillerWordsManager', () => ({ UserFillerWordsManager: () => <div /> }));
vi.mock('@/components/session/SessionPageSkeleton', () => ({ SessionPageSkeleton: () => <div /> }));
vi.mock('@/components/session/PauseMetricsDisplay', () => ({ PauseMetricsDisplay: () => <div /> }));
vi.mock('@/components/session/SunsetModals', () => ({ SunsetModals: () => <div /> }));
vi.mock('@/components/LocalErrorBoundary', () => ({ 
    LocalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> 
}));

// Import hook for mocking responses
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
import { clearSessionRecoveryDraft, getRecoverableDraftForUser } from '@/services/sessionRecoveryDraft';

describe('SessionPage Feedback Logic', () => {
    const defaultMock = {
        isListening: false,
        isReady: true,
        metrics: { 
            formattedTime: '00:00', 
            total_words: 0, 
            wpm: 0, 
            clarityScore: 100,
            clarityLabel: 'Great',
            wpmLabel: 'Normal',
            fillerCount: 0
        },
        sttStatus: { type: 'ready', message: 'Ready' },
        modelLoadingProgress: null,
        mode: 'native',
        elapsedTime: 0,
        handleStartStop: vi.fn(),
        showAnalyticsPrompt: false,
        sessionFeedbackMessage: null,
        transcriptContent: '',
        fillerData: {},
        isProUser: false,
        canUsePrivateStt: false,
        activeEngine: 'native',
        isButtonDisabled: false,
        setMode: vi.fn(),
        sunsetModal: { open: false, type: 'pro' },
        setSunsetModal: vi.fn(),
        pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longestPause: 0, pausesPerMinute: 0 }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getRecoverableDraftForUser).mockReturnValue(null);
        vi.mocked(useSessionLifecycle).mockReturnValue(defaultMock as unknown as ReturnType<typeof useSessionLifecycle>);
        useSessionStore.setState({ finalizedAnalysis: null }); // reset terminal signal between tests
    });

    it('should show "Session too short" warning in status bar when hook provides error message', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: false,
            sttStatus: { type: 'ready' },
            sessionFeedbackMessage: '⚠️ Session too short',
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        expect(screen.getByTestId('status-bar')).toHaveTextContent(/Session too short/);
        expect(screen.getByTestId('status-type')).toHaveTextContent('error');
    });

    // STATE C — terminal success: ONE authoritative saved-state surface (the status bar) carrying a single
    // Analytics action. No separate completion toast (it was removed).
    it('terminal success: single saved-state surface with one Analytics action, no toast', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: false,
            sttStatus: { type: 'ready' },
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof useSessionLifecycle>);
        seedFinalized('native'); // BOTH tracks terminal → finalizedAnalysis published

        render(<SessionPage />);

        expect(screen.getByTestId('status-bar')).toHaveTextContent(/Session saved · Your transcript is ready\./);
        expect(screen.getByTestId('status-type')).toHaveTextContent('ready');
        expect(screen.queryByTestId('post-save-review-actions')).toBeNull();
        // Exactly ONE Analytics action — the /analytics link folded into the single status bar.
        expect(screen.getAllByTestId('post-save-review-session-link')).toHaveLength(1);
        expect(screen.getByTestId('post-save-review-session-link')).toHaveAttribute('href', '/analytics');
        // The separate "Next: Analytics" toast is gone — the status bar is the sole post-save surface.
        expect(screen.queryByTestId('post-save-toast')).toBeNull();
        // ...and the recording-card pill does not echo the saved message even in the terminal state.
        expect(screen.getByTestId('lrc-status-message')).not.toHaveTextContent(/Session saved/i);
    });

    // TRANSITION — intermediate save window: showAnalyticsPrompt is TRUE but finalizedAnalysis has NOT
    // arrived yet (postSaveReady === false). The lifecycle sets its "✓ Great practice! Session saved."
    // message here; the recording-card pill must NEVER display/announce it — suppression begins as soon
    // as showAnalyticsPrompt does, not only once postSaveReady is reached.
    it('transition: recording-card pill never shows "Session saved" once showAnalyticsPrompt begins, before postSaveReady', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: false,
            sttStatus: { type: 'ready', message: '✓ Great practice! Session saved.' },
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof useSessionLifecycle>);
        // finalizedAnalysis stays null (beforeEach) → postSaveReady is FALSE: the intermediate window.
        render(<SessionPage />);

        // No Analytics action yet (gate not terminal) — but the pill is ALREADY suppressed.
        expect(screen.queryByTestId('post-save-review-session-link')).toBeNull();
        const pill = screen.getByTestId('lrc-status-message');
        expect(pill).not.toHaveTextContent(/Session saved/i);
        expect(pill).not.toHaveTextContent(/Great practice/i);
        expect(pill).toBeEmptyDOMElement(); // statusMessage suppressed (undefined) — nothing to render or announce
    });

    // STATE A — metrics/persistence failure: the warning is preserved; NO success UI (P1).
    it('metrics-persistence failure: warning retained, no toast / cue / Analytics action', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            mode: 'native',
            canUsePrivateStt: true,
            isListening: false,
            // Controller-set warning after a degraded save; finalizedAnalysis is NOT published.
            sttStatus: { type: 'warning', message: 'Session saved.', detail: 'some analysis metrics could not be updated yet.' },
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof useSessionLifecycle>);
        // finalizedAnalysis stays null (beforeEach reset) — the two-track gate never published.

        render(<SessionPage />);

        expect(screen.getByTestId('status-type')).toHaveTextContent('warning'); // warning NOT overwritten
        expect(screen.getByTestId('status-bar')).not.toHaveTextContent(/Your transcript is ready/);
        expect(screen.queryByTestId('post-save-review-session-link')).toBeNull(); // no Analytics action
        expect(screen.queryByTestId('post-save-private-cta')).toBeNull();         // no Private CTA
        expect(screen.queryByTestId('post-save-toast')).toBeNull();               // no completion toast
    });

    // STATE B — native formatter pending: explicit finalizing status; no ready copy / no success UI (P2).
    it('native formatter pending: explicit finalizing status, no ready copy or success UI', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            mode: 'native',
            canUsePrivateStt: true,
            isListening: false,
            sttStatus: { type: 'ready' }, // even a benign success message must not leak through
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof useSessionLifecycle>);
        useSessionStore.setState({ nativeFormatting: { status: 'pending', startedAt: Date.now() }, finalizedAnalysis: null });

        render(<SessionPage />);

        expect(screen.getByTestId('status-bar')).toHaveTextContent(/Finalizing your transcript/);
        expect(screen.getByTestId('status-bar')).not.toHaveTextContent(/Your transcript is ready/);
        expect(screen.queryByTestId('post-save-review-session-link')).toBeNull(); // no Analytics action yet
        expect(screen.queryByTestId('post-save-private-cta')).toBeNull();
        expect(screen.queryByTestId('post-save-toast')).toBeNull();               // no toast pre-terminal
        useSessionStore.setState({ nativeFormatting: { status: 'idle', startedAt: null } }); // cleanup
    });

    it('offers Private setup after a saved Browser session for eligible users', async () => {
        const setMode = vi.fn();
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            mode: 'native',
            isProUser: true,
            canUsePrivateStt: true,
            setMode,
            isListening: false,
            sttStatus: { type: 'ready' },
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof useSessionLifecycle>);
        seedFinalized('native'); // finalization terminal reached

        render(<SessionPage />);

        const privateCta = screen.getByTestId('post-save-private-cta');
        expect(privateCta).toHaveTextContent(/Private/i);
        fireEvent.click(privateCta);
        expect(setMode).toHaveBeenCalledWith('private');
    });

    it('free tester with a Private-sample entitlement sees EXACTLY ONE Private CTA after a Native save', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            mode: 'native',
            isProUser: false,             // not Pro...
            canUsePrivateStt: true,       // ...but has a Private-sample entitlement
            isListening: false,
            sttStatus: { type: 'ready' },
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof useSessionLifecycle>);
        seedFinalized('native');

        render(<SessionPage />);

        // Exactly one Private nudge — the consolidated status-bar CTA (the Browser-card nudge is mocked out).
        expect(screen.getAllByTestId('post-save-private-cta')).toHaveLength(1);
    });

    it('shows a same-page recovery action when an unsaved draft exists after a save issue', async () => {
        vi.mocked(getRecoverableDraftForUser).mockImplementation((uid) => (uid === 'owner-user' ? {
            sessionId: 'draft-session',
            userId: 'owner-user',
            transcript: 'Recovered words from a failed save',
            durationSeconds: 42,
            mode: 'private',
            savedAt: new Date('2026-06-12T18:00:00Z').toISOString(),
        } : null));
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: false,
            transcriptContent: 'Visible transcript is still on screen after save failure',
            sttStatus: {
                type: 'warning',
                message: 'Session was not saved yet.',
                detail: 'A local recovery draft was kept in this browser after a save issue.',
            },
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        expect(await screen.findByTestId('session-recovery-actions')).toHaveTextContent(/unsaved transcript draft/i);
        expect(screen.getByTestId('session-recovery-restore')).toHaveTextContent(/Restore draft/i);
        expect(screen.getByTestId('session-recovery-dismiss')).toHaveTextContent(/Dismiss/i);
    });

    it('clears the restored local recovery draft so the action resolves', async () => {
        vi.mocked(getRecoverableDraftForUser).mockImplementation((uid) => (uid === 'owner-user' ? {
            sessionId: 'draft-session',
            userId: 'owner-user',
            transcript: 'Recovered words from a failed save',
            durationSeconds: 42,
            mode: 'private',
            savedAt: new Date('2026-06-12T18:00:00Z').toISOString(),
        } : null));
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: false,
            transcriptContent: 'Visible transcript is still on screen after save failure',
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        fireEvent.click(await screen.findByTestId('session-recovery-restore'));

        expect(clearSessionRecoveryDraft).toHaveBeenCalledWith('draft-session');
        expect(screen.queryByTestId('session-recovery-actions')).not.toBeInTheDocument();
    });

    it('dismisses only the available local recovery draft', async () => {
        vi.mocked(getRecoverableDraftForUser).mockImplementation((uid) => (uid === 'owner-user' ? {
            sessionId: 'draft-session',
            userId: 'owner-user',
            transcript: 'Recovered words from a failed save',
            durationSeconds: 42,
            mode: 'private',
            savedAt: new Date('2026-06-12T18:00:00Z').toISOString(),
        } : null));
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: false,
            transcriptContent: 'Visible transcript is still on screen after save failure',
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        fireEvent.click(await screen.findByTestId('session-recovery-dismiss'));

        expect(clearSessionRecoveryDraft).toHaveBeenCalledWith('draft-session');
        expect(screen.queryByTestId('session-recovery-actions')).not.toBeInTheDocument();
    });

    it('should show listening state in status bar when hook indicates listening', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: true,
            sttStatus: { type: 'listening', message: 'Listening...' },
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        expect(screen.getByTestId('status-bar')).toHaveTextContent('Listening...');
        expect(screen.getByTestId('status-type')).toHaveTextContent('listening');
    });
});
