import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessionLifecycle } from '../useSessionLifecycle';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSpeechRecognition } from '../useSpeechRecognition';
import { useUsageLimit } from '../useUsageLimit';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TranscriptStats } from '../useSpeechRecognition/types';
import { SttStatus } from '@/types/transcription';

import type { UsageLimitCheck } from '../useUsageLimit';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import type { UserProfile } from '@/types/user';

// Mock ALL hooks used inside useSessionLifecycle
vi.mock('@/hooks/useProfile', () => ({
    useProfile: vi.fn(() => ({
        id: 'test-user',
        subscription_status: 'basic',
        email: 'test@example.com'
    })),
}));

import { useProfile } from '@/hooks/useProfile';
import { TranscriptionProvider } from '@/providers/TranscriptionProvider';

vi.mock('@/providers/useTranscriptionContext', () => ({
    useTranscriptionContext: vi.fn(() => ({
        service: {
            getTranscriptionService: vi.fn(),
        },
    })),
}));

vi.mock('@/providers/TranscriptionProvider', () => ({
    TranscriptionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/AuthProvider', () => ({
    useAuthProvider: () => ({ session: { access_token: 'mock-token' }, user: { id: 'test-user' } }),
}));

// Redundant useUserProfile removed

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { createTestSessionStore } from '../../../tests/unit/factories/storeFactory';

vi.mock('@/stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));
vi.mock('@/services/SpeechRuntimeController', () => ({
    speechRuntimeController: {
        startRecording: vi.fn(),
        stopRecording: vi.fn(async () => ({ 
            transcript: '', 
            total_words: 0, 
            accuracy: 100, 
            duration: 0 
        } as TranscriptStats)),
        reset: vi.fn(),
        warmUp: vi.fn(),
    },
}));

import { speechRuntimeController } from '@/services/SpeechRuntimeController';

// Global mock for useUsageLimit
const baseUsageLimit: UsageLimitCheck = {
    can_start: true,
    daily_remaining: 30,
    daily_limit: 3600,
    monthly_remaining: 90000,
    monthly_limit: 90000,
    remaining_seconds: 30,
    subscription_status: 'basic',
    is_pro: false,
    streak_count: 0
};

const mockUsageLimitQuery = {
    data: baseUsageLimit,
    isLoading: false,
    isError: false,
    error: null,
    status: 'success',
} as unknown as UseQueryResult<UsageLimitCheck, Error>;

vi.mock('../useUsageLimit', () => ({
    useUsageLimit: vi.fn(() => mockUsageLimitQuery),
}));

// Global mock for useSpeechRecognition
const baseTranscript: TranscriptStats = {
    transcript: '',
    total_words: 0,
    accuracy: 100,
    duration: 0,
};

const basePauseMetrics: PauseMetrics = {
    totalPauses: 0,
    averagePauseDuration: 0,
    longestPause: 0,
    pausesPerMinute: 0,
    silencePercentage: 0,
    transitionPauses: 0,
    extendedPauses: 0,
};

const baseSttStatus: SttStatus = {
    type: 'ready',
    message: 'Ready',
};

// Shared mocks for useSpeechRecognition to ensure reference equality in tests
const mockStartListening = vi.fn();
const mockStopListening = vi.fn();
const mockReset = vi.fn();

vi.mock('../useSpeechRecognition', () => ({
    useSpeechRecognition: vi.fn(() => ({
        transcript: baseTranscript,
        chunks: [],
        interimTranscript: '',
        fillerData: { total: { count: 0, color: '' } },
        startListening: mockStartListening,
        stopListening: mockStopListening,
        isListening: false,
        isReady: true,
        isSupported: true,
        error: null,
        reset: mockReset,
        pauseMetrics: basePauseMetrics,
        modelLoadingProgress: null,
        sttStatus: baseSttStatus,
        mode: 'native'
    })),
}));

vi.mock('../useVocalAnalysis', () => ({
    useVocalAnalysis: () => ({
        pauseMetrics: basePauseMetrics,
        processAudioFrame: vi.fn(),
        reset: vi.fn()
    }),
}));

vi.mock('../useSessionManager', () => ({
    useSessionManager: () => ({ saveSession: vi.fn(async () => ({ session: { id: 'test-session' }, error: null })) }),
}));

vi.mock('@/components/session/ClarityScoreCard', () => ({
    ClarityScoreCard: (props: { clarityScore: number }) => <div data-testid="clarity-score-card">Clarity: {props.clarityScore}</div>,
}));

vi.mock('@/components/session/SpeakingRateCard', () => ({
    SpeakingRateCard: (props: { wpm: number }) => <div data-testid="speaking-rate-card">WPM: {props.wpm}</div>,
}));

vi.mock('../useSessionMetrics', () => ({
    useSessionMetrics: () => ({ wpm: 0, clarityScore: 0, fillerCount: 0 }),
}));

vi.mock('../useStreak', () => ({
    useStreak: () => ({ updateStreak: vi.fn(() => ({ isNewDay: false, currentStreak: 1 })) }),
}));

vi.mock('../useUserFillerWords', () => ({
    useUserFillerWords: () => ({ userFillerWords: [] }),
}));

vi.mock('@/constants/subscriptionTiers', () => ({
    isPro: vi.fn((status: string | undefined) => status === 'pro'),
    hasPaidProEntitlement: vi.fn(() => false),
    getEffectiveSubscriptionStatus: vi.fn((usageStatus: string | undefined, profile: { subscription_status?: string } | null | undefined) => usageStatus ?? profile?.subscription_status ?? 'basic'),
}));

vi.mock('@/services/transcription/TranscriptionPolicy', () => ({
    buildPolicyForUser: vi.fn(() => ({
        allowNative: true,
        allowCloud: false,
        allowPrivate: false,
        preferredMode: 'native',
        allowFallback: false,
        executionIntent: 'test'
    })),
    TranscriptionMode: {
        NATIVE: 'native',
        CLOUD: 'cloud',
    },
}));

vi.mock('@/config/env', () => ({
    MIN_SESSION_DURATION_SECONDS: 5
}));

describe('useSessionLifecycle - Auto-Stop Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Use factory for a fresh store each test
        const mockStore = createTestSessionStore();
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        // Ensure default is basic for auto-stop tests
        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'basic',
                email: 'test@example.com'
            } as UserProfile,
            isVerified: true
        });
    });

    it('should trigger handleStartStop when elapsed time exceeds limit', async () => {
        const mockElapsedTime = 31;
        const mockLimit: UsageLimitCheck = {
            daily_remaining: 30,
            daily_limit: 3600,
            monthly_remaining: 90000,
            monthly_limit: 90000,
            remaining_seconds: 30,
            can_start: true,
            subscription_status: 'basic',
            is_pro: false,
            streak_count: 0
        };

        const mockStore = createTestSessionStore({
            isListening: true, // AUTO-STOP logic requires isListening to be true
            elapsedTime: mockElapsedTime,
            startTime: Date.now() - (mockElapsedTime * 1000),
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript,
            chunks: [],
            interimTranscript: '',
            fillerData: { total: { count: 0, color: '' } },
            startListening: mockStartListening,
            stopListening: mockStopListening,
            isListening: true,
            isReady: true,
            isSupported: true,
            error: null,
            reset: mockReset,
            pauseMetrics: basePauseMetrics,
            modelLoadingProgress: null,
            sttStatus: { type: 'ready', message: 'Recording' },
            mode: 'native'
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: mockLimit,
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        // Verify it is indeed a Basic user via isPro mock if necessary,
        // but isPro(profile.subscription_status) handles it.

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        await waitFor(() => {
            expect(speechRuntimeController.stopRecording).toHaveBeenCalled();
        }, { timeout: 2000 });
    });

    it('should NOT trigger stop when time remains', () => {
        const mockStore = createTestSessionStore({
            elapsedTime: 25,
            isListening: true,
            startTime: Date.now() - 25000,
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript,
            chunks: [],
            interimTranscript: '',
            fillerData: { total: { count: 0, color: '' } },
            startListening: mockStartListening,
            stopListening: mockStopListening,
            isListening: true,
            isReady: true,
            isSupported: true,
            error: null,
            reset: mockReset,
            pauseMetrics: basePauseMetrics,
            modelLoadingProgress: null,
            sttStatus: { type: 'ready', message: 'Recording' },
            mode: 'native'
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                daily_remaining: 30,
                daily_limit: 3600,
                monthly_remaining: 90000,
                monthly_limit: 90000,
                remaining_seconds: 30,
                can_start: true,
                subscription_status: 'basic',
                is_pro: false,
                streak_count: 0
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
    });

    it('should warn pro users when they are within five minutes of their daily practice limit', async () => {
        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'pro',
                email: 'test@example.com'
            } as UserProfile,
            isVerified: true
        });

        const mockStore = createTestSessionStore({
            elapsedTime: 1,
            isListening: true,
            startTime: Date.now() - 1000,
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript,
            chunks: [],
            interimTranscript: '',
            fillerData: { total: { count: 0, color: '' } },
            startListening: mockStartListening,
            stopListening: mockStopListening,
            isListening: true,
            isReady: true,
            isSupported: true,
            error: null,
            reset: mockReset,
            pauseMetrics: basePauseMetrics,
            modelLoadingProgress: null,
            sttStatus: { type: 'ready', message: 'Recording' },
            mode: 'native'
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                daily_remaining: 300,
                daily_limit: 7200,
                monthly_remaining: 180000,
                monthly_limit: 180000,
                remaining_seconds: -1,
                can_start: true,
                subscription_status: 'pro',
                is_pro: true,
                streak_count: 0
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        await waitFor(() => {
            expect(mockStore.getState().sttStatus).toEqual({
                type: 'info',
                message: "⚠️ Great practice! 5 minutes remaining for today's Pro practice limit."
            });
        });
    });

    it('should honor can_start=false for stale Pro or expired trial users', async () => {
        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'pro',
                email: 'test@example.com'
            } as UserProfile,
            isVerified: true
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                daily_remaining: 0,
                daily_limit: 7200,
                monthly_remaining: 0,
                monthly_limit: 180000,
                remaining_seconds: 0,
                can_start: false,
                subscription_status: 'basic',
                is_pro: false,
                streak_count: 0,
                error: 'Trial access expired'
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        const mockStore = createTestSessionStore({
            isListening: false,
            runtimeState: 'READY',
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        await act(async () => {
            await result.current.handleStartStop();
        });

        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(mockStore.getState().sttStatus).toEqual({
            type: 'error',
            message: '⛔ Trial access expired'
        });
    });

    it('resets runtime state after a recording start failure so the UI cannot remain active', async () => {
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValueOnce(
            Object.assign(new Error('mic_stream_unavailable'), { name: 'NotAllowedError' })
        );

        const mockStore = createTestSessionStore({
            isListening: false,
            runtimeState: 'READY',
            sttMode: 'private',
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'pro',
                email: 'test@example.com'
            } as UserProfile,
            isVerified: true
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                daily_remaining: 7200,
                daily_limit: 7200,
                monthly_remaining: 180000,
                monthly_limit: 180000,
                remaining_seconds: -1,
                can_start: true,
                subscription_status: 'pro',
                is_pro: true,
                streak_count: 0,
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        await act(async () => {
            await result.current.handleStartStop();
        });

        expect(speechRuntimeController.reset).toHaveBeenCalledWith('start_failed');
        expect(mockStore.getState().sttStatus).toEqual({
            type: 'error',
            message: '⚠️ Microphone access is blocked. Allow microphone access and try again.'
        });
    });

    it('should not show saved success when stopRecording discards an empty session', async () => {
        vi.mocked(speechRuntimeController.stopRecording).mockResolvedValueOnce(null);

        const mockStore = createTestSessionStore({
            isListening: true,
            elapsedTime: 30,
            startTime: Date.now() - 30000,
            sttStatus: {
                type: 'warning',
                message: "We didn't detect enough speech to save this session.",
                detail: 'Try recording again and speak for at least a few seconds.'
            },
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript,
            chunks: [],
            interimTranscript: '',
            fillerData: { total: { count: 0, color: '' } },
            startListening: mockStartListening,
            stopListening: mockStopListening,
            isListening: true,
            isReady: true,
            isSupported: true,
            error: null,
            reset: mockReset,
            pauseMetrics: basePauseMetrics,
            modelLoadingProgress: null,
            sttStatus: {
                type: 'warning',
                message: "We didn't detect enough speech to save this session.",
                detail: 'Try recording again and speak for at least a few seconds.'
            },
            mode: 'native'
        });

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        await act(async () => {
            await result.current.handleStartStop();
        });

        expect(result.current.showAnalyticsPrompt).toBe(false);
        expect(mockStore.getState().sttStatus).toEqual({
            type: 'warning',
            message: "We didn't detect enough speech to save this session.",
            detail: 'Try recording again and speak for at least a few seconds.'
        });
    });

    it('should force downgraded users back to native mode and clear stale private errors', async () => {
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: false,
            sttStatus: { type: 'error', message: 'Error occurred' },
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'basic',
                email: 'test@example.com'
            } as UserProfile,
            isVerified: true
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                daily_remaining: 3600,
                daily_limit: 3600,
                monthly_remaining: 3600,
                monthly_limit: 3600,
                remaining_seconds: 3600,
                can_start: true,
                subscription_status: 'basic',
                is_pro: false,
                streak_count: 0,
                trial_active: false,
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        await waitFor(() => {
            expect(mockStore.getState().sttMode).toBe('native');
            expect(mockStore.getState().sttStatus).toEqual({
                type: 'ready',
                message: 'Ready to record'
            });
        });
    });

    it('should promote an implicit native default to private when profile resolves as Pro', async () => {
        const mockStore = createTestSessionStore({
            sttMode: 'native',
            isListening: false,
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'pro',
                email: 'test@example.com'
            } as UserProfile,
            isVerified: true
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                daily_remaining: 7200,
                daily_limit: 7200,
                monthly_remaining: 180000,
                monthly_limit: 180000,
                remaining_seconds: -1,
                can_start: true,
                subscription_status: 'pro',
                is_pro: true,
                streak_count: 0,
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>
                    {children}
                </TranscriptionProvider>
            )
        });

        await waitFor(() => {
            expect(mockStore.getState().sttMode).toBe('private');
        });
    });
});
