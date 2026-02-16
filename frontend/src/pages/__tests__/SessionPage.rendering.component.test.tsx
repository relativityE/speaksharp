import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@/components/LocalErrorBoundary', () => ({
    LocalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@sentry/react', () => ({
    withScope: vi.fn((cb) => cb({ setTag: vi.fn(), setContext: vi.fn() })),
    captureException: vi.fn(),
}));

import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionPage } from '../SessionPage';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';

// Helper
const renderWithRouter = (ui: React.ReactElement) => {
    const queryClient = new QueryClient();
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
    );
};

// Mock everything
// Child component mocks for deterministic testing
vi.mock('@/components/session/LiveRecordingCard', () => ({
    LiveRecordingCard: ({ onStartStop, isListening, formattedTime }: { onStartStop: () => void, isListening: boolean, formattedTime: string }) => (
        <div data-testid="live-recording-card">
            <button data-testid="session-start-stop-button" onClick={onStartStop}>
                {isListening ? 'Stop' : 'Start'}
            </button>
            {isListening ? 'Recording' : 'Ready to record'}
            <div>{formattedTime}</div>
        </div>
    ),
}));

vi.mock('@/components/session/PauseMetricsDisplay', () => ({
    PauseMetricsDisplay: () => <div data-testid="pause-metrics-display">Pause Metrics</div>,
}));

vi.mock('@/components/session/StatusNotificationBar', () => ({
    StatusNotificationBar: ({ status }: { status: { message?: string, type?: string } }) => (
        <div data-testid="status-notification-bar">
            <span data-testid="session-status-indicator">{status.message || status.type}</span>
        </div>
    ),
}));

vi.mock('@/components/session/LiveTranscriptPanel', () => ({
    LiveTranscriptPanel: ({ transcript }: { transcript: string }) => (
        <div data-testid="live-transcript-panel">{transcript}</div>
    ),
}));

vi.mock('@/components/session/FillerWordsCard', () => ({
    FillerWordsCard: ({ fillerCount, headerAction }: { fillerCount: number, headerAction: React.ReactNode }) => (
        <div data-testid="filler-words-card">
            <span>Filler Words</span>
            <span data-testid="filler-count-value">({fillerCount})</span>
            {headerAction}
        </div>
    ),
}));

vi.mock('@/components/session/UserFillerWordsManager', () => ({
    UserFillerWordsManager: () => <div data-testid="user-filler-words-manager">User Filler Words Manager</div>,
}));

vi.mock('@/components/session/ClarityScoreCard', () => ({
    ClarityScoreCard: ({ clarityScore }: { clarityScore: number }) => (
        <div data-testid="clarity-score-card">
            <span>Clarity Score</span>
            Clarity: {clarityScore}
        </div>
    ),
}));

vi.mock('@/components/session/SpeakingRateCard', () => ({
    SpeakingRateCard: ({ wpm }: { wpm: number }) => (
        <div data-testid="speaking-rate-card">
            <span>Speaking Pace</span>
            WPM: {wpm}
        </div>
    ),
}));

vi.mock('@/components/session/SpeakingTipsCard', () => ({
    SpeakingTipsCard: () => <div data-testid="speaking-tips-card">Speaking Tips</div>,
}));

vi.mock('@/components/session/MobileActionBar', () => ({
    MobileActionBar: () => <div data-testid="mobile-action-bar">Mobile Action Bar</div>,
}));

vi.mock('@/components/PromoExpiredDialog', () => ({
    PromoExpiredDialog: () => <div data-testid="promo-expired-dialog">Promo Expired Dialog</div>,
}));

vi.mock('@/components/session/SessionPageSkeleton', () => ({
    SessionPageSkeleton: () => <div data-testid="session-page-skeleton">Skeleton</div>,
}));

// Mock useSessionLifecycle directly for Thin View testing
vi.mock('@/hooks/useSessionLifecycle', () => ({
    useSessionLifecycle: vi.fn(),
}));

const mockUseSessionLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);

// Default mock values
const defaultLifecycle = {
    isListening: false,
    isReady: true,
    metrics: {
        formattedTime: '00:00',
        wpm: 0,
        wpmLabel: 'Optimal',
        clarityScore: 100,
        clarityLabel: 'Excellent',
        fillerCount: 0
    },
    sttStatus: { type: 'ready' as const, message: 'Ready' },
    modelLoadingProgress: null,
    mode: 'native' as const,
    setMode: vi.fn(),
    elapsedTime: 0,
    handleStartStop: vi.fn(),
    showAnalyticsPrompt: false,
    sessionFeedbackMessage: null,
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
    transcriptContent: '',
    fillerData: {},
    isProUser: false,
    isButtonDisabled: false,
    showPromoExpiredDialog: false
};

describe('SessionPage Rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        mockUseSessionLifecycle.mockReturnValue(defaultLifecycle as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);
    });



    afterEach(async () => {
        cleanup();
        // Flush microtasks to drain pending queueMicrotask calls
        for (let i = 0; i < 3; i++) {
            await Promise.resolve();
        }
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('renders without crashing', () => {
        renderWithRouter(<SessionPage />);
        expect(screen.getByText('Practice Session')).toBeInTheDocument();
    });

    it('should render the live recording card', () => {
        renderWithRouter(<SessionPage />);
        expect(screen.getByTestId('live-recording-card')).toBeInTheDocument();
        expect(screen.getByText('Ready to record')).toBeInTheDocument();
    });

    it('should render metrics cards', () => {
        renderWithRouter(<SessionPage />);
        expect(screen.getByText('Clarity Score')).toBeInTheDocument();
        expect(screen.getByText('Speaking Pace')).toBeInTheDocument();
        expect(screen.getByText('Filler Words')).toBeInTheDocument();
    });

    it('should render pause metrics display', () => {
        renderWithRouter(<SessionPage />);
        expect(screen.getByTestId('pause-metrics-display')).toBeInTheDocument();
    });

    it('should render Add Custom Word settings button', () => {
        renderWithRouter(<SessionPage />);
        // The settings button is passed as headerAction to FillerWordsCard
        expect(screen.getByTestId('add-custom-word-button')).toBeInTheDocument();
        expect(screen.getByText('Custom')).toBeInTheDocument();
    });
});

describe('Loading States', () => {
    it('should render loading state when metrics are null (initializing)', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...defaultLifecycle,
            metrics: null,
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        renderWithRouter(<SessionPage />);
        expect(screen.getByTestId('session-page-skeleton')).toBeInTheDocument();
    });
});

describe('Session Control', () => {
    it('should call handleStartStop when start button is clicked', async () => {
        const mockHandleStartStop = vi.fn();
        mockUseSessionLifecycle.mockReturnValue({
            ...defaultLifecycle,
            handleStartStop: mockHandleStartStop,
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        renderWithRouter(<SessionPage />);

        const startButton = screen.getByTestId('session-start-stop-button');
        const { fireEvent } = await import('@testing-library/react');
        fireEvent.click(startButton);

        expect(mockHandleStartStop).toHaveBeenCalled();
    });

    it('should show Ready status when not listening', () => {
        renderWithRouter(<SessionPage />);
        expect(screen.getByTestId('session-status-indicator')).toHaveTextContent('Ready');
    });

    it('should show Connecting status when sttStatus type is initializing', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...defaultLifecycle,
            sttStatus: { type: 'initializing', message: 'Connecting...' },
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        renderWithRouter(<SessionPage />);
        expect(screen.getByTestId('session-status-indicator')).toHaveTextContent('Connecting...');
    });
});

describe('Metrics Display', () => {
    it('should display formatted time', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...defaultLifecycle,
            metrics: { ...defaultLifecycle.metrics, formattedTime: '01:05' },
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        renderWithRouter(<SessionPage />);
        expect(screen.getByText('01:05')).toBeInTheDocument();
    });

    it('should display WPM from metrics', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...defaultLifecycle,
            metrics: { ...defaultLifecycle.metrics, wpm: 145 },
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        renderWithRouter(<SessionPage />);
        expect(screen.getByText(/145/)).toBeInTheDocument();
    });

    it('should display filler word count from metrics', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...defaultLifecycle,
            metrics: { ...defaultLifecycle.metrics, fillerCount: 7 },
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        renderWithRouter(<SessionPage />);
        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('(7)');
    });
});

describe('Transcript Display', () => {
    it('should display transcript text', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...defaultLifecycle,
            transcriptContent: 'Hello world',
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        renderWithRouter(<SessionPage />);
        expect(screen.getByText(/Hello/)).toBeInTheDocument();
        expect(screen.getByText(/world/)).toBeInTheDocument();
    });
});
