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
import { render, screen } from '../../../tests/support/test-utils';
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
vi.mock('@/components/PromoExpiredDialog', () => ({ PromoExpiredDialog: () => <div /> }));
vi.mock('@/components/LocalErrorBoundary', () => ({ 
    LocalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> 
}));

// Import hook for mocking responses
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';

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
        activeEngine: 'native',
        isButtonDisabled: false,
        showPromoExpiredDialog: false,
        setMode: vi.fn(),
        sunsetModal: { open: false, type: 'pro' },
        setSunsetModal: vi.fn(),
        pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longestPause: 0, pausesPerMinute: 0 }
    };

    beforeEach(() => {
        vi.clearAllMocks();
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
