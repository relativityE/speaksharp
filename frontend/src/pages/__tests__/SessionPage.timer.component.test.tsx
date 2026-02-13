/**
 * SessionPage Timer Tests
 *
 * Tests the useSessionLifecycle hook directly (not the full component).
 * Uses fake timers to validate timer increment logic without real delays.
 *
 * Invariants validated:
 * - Timer increments elapsed time when listening
 * - Timer resets to 0 when session stops
 *
 * @see useSessionLifecycle.ts for the hook under test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionLifecycle } from '../../hooks/useSessionLifecycle';
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
        isLoading: false,
    }),
}));
vi.mock('@/hooks/useSessionManager', () => ({
    useSessionManager: () => ({
        saveSession: vi.fn(),
    }),
}));
vi.mock('@/hooks/useStreak', () => ({
    useStreak: () => ({
        updateStreak: vi.fn().mockReturnValue({ isNewDay: false, currentStreak: 1 }),
    }),
}));
vi.mock('@/hooks/useSessionMetrics', () => ({
    useSessionMetrics: () => ({ wpm: 0, clarityScore: 0, fillerCount: 0 }),
}));
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
    },
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
}));

// Mock react-query
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({
        invalidateQueries: vi.fn(),
    }),
}));

const mockUseSpeechRecognition = vi.mocked(SpeechRecognitionHook.useSpeechRecognition);
const mockUseSessionStore = vi.mocked(SessionStore.useSessionStore);
const mockUseVocalAnalysis = vi.mocked(VocalAnalysisHook.useVocalAnalysis);
const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockUseUserProfile = vi.mocked(UserProfileHook.useUserProfile);
const mockUseUsageLimit = vi.mocked(UsageLimitHook.useUsageLimit);

describe('useSessionLifecycle Timer Logic', () => {
    const mockStartListening = vi.fn();
    const mockStopListening = vi.fn();
    const mockUpdateElapsedTime = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
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
            mode: 'native',
        } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

        mockUseSessionStore.mockImplementation((selector?: (state: SessionStore.SessionStore) => unknown) => {
            const state = {
                elapsedTime: 0,
                updateElapsedTime: mockUpdateElapsedTime,
                resetSession: vi.fn(),
            } as unknown as SessionStore.SessionStore;
            return selector ? selector(state) : state;
        });

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

    it('should update elapsed time when listening', () => {
        mockUseSpeechRecognition.mockReturnValue({
            ...mockUseSpeechRecognition(),
            isListening: true,
        } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

        renderHook(() => useSessionLifecycle());

        // Advance time by 1 second
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(mockUpdateElapsedTime).toHaveBeenCalled();
    });

    it('should reset elapsed time when stopped (on mount)', () => {
        mockUseSpeechRecognition.mockReturnValue({
            ...mockUseSpeechRecognition(),
            isListening: false,
        } as unknown as ReturnType<typeof SpeechRecognitionHook.useSpeechRecognition>);

        renderHook(() => useSessionLifecycle());

        expect(mockUpdateElapsedTime).toHaveBeenCalledWith(0);
    });
});
