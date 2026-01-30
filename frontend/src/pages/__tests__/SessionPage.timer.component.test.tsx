import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionPage } from '../SessionPage';
import * as SpeechRecognitionHook from '../../hooks/useSpeechRecognition';
import * as SessionStore from '../../stores/useSessionStore';
import * as VocalAnalysisHook from '../../hooks/useVocalAnalysis';
import * as AuthProvider from '../../contexts/AuthProvider';
import * as UserProfileHook from '@/hooks/useUserProfile';
import * as UsageLimitHook from '@/hooks/useUsageLimit';

// Mock modules
vi.mock('../../hooks/useSpeechRecognition');
vi.mock('../../stores/useSessionStore');
vi.mock('../../hooks/useVocalAnalysis');
vi.mock('../../contexts/AuthProvider');
vi.mock('@/hooks/useUserProfile');
vi.mock('@/hooks/useUsageLimit');
vi.mock('@/hooks/useUserFillerWords', () => ({
    useUserFillerWords: () => ({
        userFillerWords: ['mock-word'],
        fullVocabularyObjects: [{ id: '1', word: 'mock-word', user_id: 'test', created_at: new Date().toISOString() }],
        isLoading: false,
        error: null,
        addWord: vi.fn(),
        removeWord: vi.fn(),
        isAdding: false,
        isRemoving: false,
        count: 1,
        maxWords: 100,
        isPro: false,
    }),
}));
vi.mock('@/hooks/useSessionManager', () => ({
    useSessionManager: () => ({
        saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    }),
}));
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
    },
}));

// Helper to render with router
const renderWithRouter = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
    );
};

// Mock child components
vi.mock('@/components/session/PauseMetricsDisplay', () => ({
    PauseMetricsDisplay: () => <div data-testid="pause-metrics-display">Pause Metrics</div>,
}));
vi.mock('@/components/session/StatusNotificationBar', () => ({
    StatusNotificationBar: () => <div data-testid="status-notification-bar">Status Bar</div>,
}));

vi.mock('@/components/session/UserFillerWordsManager', () => ({
    UserFillerWordsManager: () => <div data-testid="user-filler-words-manager">User Filler Words Manager</div>,
}));

const mockUseSpeechRecognition = vi.mocked(SpeechRecognitionHook.useSpeechRecognition);
const mockUseSessionStore = vi.mocked(SessionStore.useSessionStore);
const mockUseVocalAnalysis = vi.mocked(VocalAnalysisHook.useVocalAnalysis);
const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockUseUserProfile = vi.mocked(UserProfileHook.useUserProfile);
const mockUseUsageLimit = vi.mocked(UsageLimitHook.useUsageLimit);

describe('SessionPage Timer Logic', () => {
    const mockStartListening = vi.fn();
    const mockStopListening = vi.fn();
    const mockUpdateElapsedTime = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // CRITICAL: Clear timers before setting fake timers
        vi.clearAllTimers();
        vi.useFakeTimers();

        // Default mocks
        mockUseSpeechRecognition.mockReturnValue({
            transcript: { transcript: '', confidence: 0, isFinal: false },
            fillerData: {},
            startListening: mockStartListening,
            stopListening: mockStopListening,
            isListening: false,
            isReady: true,
            modelLoadingProgress: null,
            error: null,
            resetTranscript: vi.fn(),
            sttStatus: { type: 'ready', message: 'Ready' },
            chunks: [],
        } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

        mockUseSessionStore.mockReturnValue({
            elapsedTime: 0,
            updateElapsedTime: mockUpdateElapsedTime,
            resetSession: vi.fn(),
        } as unknown as ReturnType<typeof SessionStore.useSessionStore>);

        mockUseVocalAnalysis.mockReturnValue({
            pauseMetrics: {
                totalPauses: 0,
                averagePauseDuration: 0,
                longPauses: 0,
                pauseRate: 0,
            },
        } as unknown as ReturnType<typeof VocalAnalysisHook.useVocalAnalysis>);

        mockUseAuthProvider.mockReturnValue({
            session: { user: { id: 'test-user' } },
        } as unknown as AuthProvider.AuthContextType);

        mockUseUserProfile.mockReturnValue({
            data: { id: 'test-profile' },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

        mockUseUsageLimit.mockReturnValue({
            data: { can_start: true, remaining_seconds: 1800, limit_seconds: 1800, is_pro: false },
            isLoading: false,
        } as unknown as ReturnType<typeof UsageLimitHook.useUsageLimit>);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    describe('Timer Logic', () => {
        it('should update elapsed time when listening', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: true,
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);

            // Advance time by 1 second
            act(() => {
                vi.advanceTimersByTime(1000);
            });

            expect(mockUpdateElapsedTime).toHaveBeenCalled();
        });

        it('should reset elapsed time when stopped', () => {
            mockUseSpeechRecognition.mockReturnValue({
                ...mockUseSpeechRecognition(),
                isListening: false,
            } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

            renderWithRouter(<SessionPage />);

            expect(mockUpdateElapsedTime).toHaveBeenCalledWith(0);
        });
    });
});
