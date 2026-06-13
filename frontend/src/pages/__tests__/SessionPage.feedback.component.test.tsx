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
    getSessionRecoveryDraft: vi.fn(),
    clearSessionRecoveryDraft: vi.fn(),
}));

// Mock child components to verify props passed to them
vi.mock('@/components/session/StatusNotificationBar', () => ({
    StatusNotificationBar: ({ status }: { status: { message?: string, type?: string } }) => (
        <div data-testid="status-bar">
            {status?.message}
            {status?.type && <span data-testid="status-type">{status.type}</span>}
        </div>
    ),
}));

// Mock other components to silence them
vi.mock('@/components/session/LiveRecordingCard', () => ({ LiveRecordingCard: () => <div /> }));
vi.mock('@/components/session/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => <div /> }));
vi.mock('@/components/session/ClarityScoreCard', () => ({ ClarityScoreCard: () => <div /> }));
vi.mock('@/components/session/SpeakingRateCard', () => ({ SpeakingRateCard: () => <div /> }));
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
import { clearSessionRecoveryDraft, getSessionRecoveryDraft } from '@/services/sessionRecoveryDraft';

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
        vi.mocked(getSessionRecoveryDraft).mockReturnValue(null);
        vi.mocked(useSessionLifecycle).mockReturnValue(defaultMock as unknown as ReturnType<typeof useSessionLifecycle>);
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

    it('should show "Session saved" success in status bar when hook shows analytics prompt', async () => {
        vi.mocked(useSessionLifecycle).mockReturnValue({
            ...defaultMock,
            isListening: false,
            sttStatus: { type: 'ready' },
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof useSessionLifecycle>);

        render(<SessionPage />);

        expect(screen.getByTestId('status-bar')).toHaveTextContent(/Session saved/);
        expect(screen.getByTestId('status-type')).toHaveTextContent('ready');
        expect(screen.getByTestId('post-save-review-actions')).toHaveTextContent(/Review trends/i);
        expect(screen.getByTestId('post-save-review-session-link')).toHaveAttribute('href', '/analytics');
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

        render(<SessionPage />);

        const privateCta = screen.getByTestId('post-save-private-cta');
        expect(privateCta).toHaveTextContent(/Private/i);
        fireEvent.click(privateCta);
        expect(setMode).toHaveBeenCalledWith('private');
    });

    it('shows a same-page recovery action when an unsaved draft exists after a save issue', async () => {
        vi.mocked(getSessionRecoveryDraft).mockReturnValue({
            sessionId: 'draft-session',
            transcript: 'Recovered words from a failed save',
            durationSeconds: 42,
            mode: 'private',
            savedAt: new Date('2026-06-12T18:00:00Z').toISOString(),
        });
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
        vi.mocked(getSessionRecoveryDraft).mockReturnValue({
            sessionId: 'draft-session',
            transcript: 'Recovered words from a failed save',
            durationSeconds: 42,
            mode: 'private',
            savedAt: new Date('2026-06-12T18:00:00Z').toISOString(),
        });
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
        vi.mocked(getSessionRecoveryDraft).mockReturnValue({
            sessionId: 'draft-session',
            transcript: 'Recovered words from a failed save',
            durationSeconds: 42,
            mode: 'private',
            savedAt: new Date('2026-06-12T18:00:00Z').toISOString(),
        });
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
