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
        subscription_status: 'free',
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
    subscription_status: 'free',
    is_pro: false,
    streak_count: 0,
    private_sample_available: false,
    private_sample_limit_seconds: 300,
    private_sample_seconds_used: 0,
    private_sample_seconds_remaining: 300,
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
        mode: 'native',
        micWarning: null,
        micLevel: 0,
        hasSpeechActivity: false,
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
    isActiveTrialProfile: vi.fn(() => false),
    hasPaidProEntitlement: vi.fn(() => false),
    hasCloudSttEntitlement: vi.fn(() => false),
    getEffectiveSubscriptionStatus: vi.fn((usageStatus: string | undefined, profile: { subscription_status?: string } | null | undefined) => usageStatus ?? profile?.subscription_status ?? 'free'),
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
        delete window.__SS_E2E__;

        // Ensure default is Free for auto-stop tests
        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'free',
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
            subscription_status: 'free',
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
            mode: 'native',
            micWarning: null,
            micLevel: 0,
            hasSpeechActivity: false,
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: mockLimit,
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        // Verify it is indeed a Free user via isPro mock if necessary,
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

    it('caps a Private recording at 90s (auto-stops past the per-recording cap, independent of budget)', async () => {
        // #891 beta latency control. Generous usage budget so ONLY the 90s cap can trigger the stop.
        const mockLimit: UsageLimitCheck = {
            daily_remaining: 99999,
            daily_limit: 99999,
            monthly_remaining: 99999,
            monthly_limit: 99999,
            remaining_seconds: 99999,
            can_start: true,
            subscription_status: 'pro',
            is_pro: true,
            streak_count: 0,
        };
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: true,
            elapsedTime: 91, // past the 90s per-recording cap
            startTime: Date.now() - 91000,
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
            sttStatus: { type: 'recording', message: 'Speak now' },
            mode: 'private',
            micWarning: null,
            micLevel: 0,
            hasSpeechActivity: false,
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: mockLimit,
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
            mode: 'native',
            micWarning: null,
            micLevel: 0,
            hasSpeechActivity: false,
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                daily_remaining: 30,
                daily_limit: 3600,
                monthly_remaining: 90000,
                monthly_limit: 90000,
                remaining_seconds: 30,
                can_start: true,
                subscription_status: 'free',
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

    it('keeps enforcing the Private sample window (not the free daily limit) when availability flips false mid-recording', async () => {
        // Regression for the #770 HOLD: once `private_sample_session_id` is set, the
        // entitlement refetch returns private_sample_available=false while sample seconds
        // remain. The countdown/auto-stop must keep using the sample's remaining seconds,
        // NOT fall back to the free daily remaining (which would prematurely auto-stop the
        // sample and pop the daily sunset modal).
        const mockElapsedTime = 31; // past the 30s daily remaining, far under the 300s sample
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: true,
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
            mode: 'private',
            micWarning: null,
            micLevel: 0,
            hasSpeechActivity: false,
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                ...baseUsageLimit,
                can_start: true,
                subscription_status: 'free',
                is_pro: false,
                remaining_seconds: 30,
                daily_remaining: 30,
                private_sample_available: false,        // flips false once session_id is set
                private_sample_seconds_remaining: 300,  // sample still has the full window left
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

        // The daily sunset modal only fires for non-sample auto-stops. With the fix the
        // sample window (300s) governs, so at 31s elapsed nothing stops and the modal stays
        // closed. Pre-fix, sourceRemaining fell back to daily (30s) and popped it.
        expect(mockStore.getState().sunsetModal.open).toBe(false);

        // And it must not have auto-stopped the recording.
        await new Promise((resolve) => setTimeout(resolve, 50));
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
            mode: 'native',
            micWarning: null,
            micLevel: 0,
            hasSpeechActivity: false,
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

    it('should honor can_start=false for stale Pro or unavailable sample users', async () => {
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
                subscription_status: 'free',
                is_pro: false,
                streak_count: 0,
                error: 'Private sample unavailable'
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
            message: '⛔ Private sample unavailable'
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
            mode: 'native',
            micWarning: null,
            micLevel: 0,
            hasSpeechActivity: false,
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
                subscription_status: 'free',
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
                subscription_status: 'free',
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

    it('should ignore legacy future trial timestamps when the server says the Private sample is unavailable', async () => {
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: false,
            sttStatus: { type: 'error', message: 'Private allowed by stale client clock' },
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'free',
                email: 'test@example.com',
                trial_expires_at: '2999-01-01T00:00:00.000Z',
            } as UserProfile,
            isVerified: true
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                ...baseUsageLimit,
                can_start: false,
                subscription_status: 'free',
                is_pro: false,
                trial_active: false,
                trial_seconds_remaining: 0,
                private_sample_available: false,
                private_sample_seconds_remaining: 0,
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

    it('should allow a server-backed Private sample user to keep Private selected', async () => {
        // Option A: the default is the instant Native path, but a user with an
        // available Private sample who has SELECTED Private must not be forced
        // back to Native.
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: false,
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useProfile).mockReturnValue({
            profile: {
                id: 'test-user',
                subscription_status: 'free',
                email: 'test@example.com',
                trial_expires_at: '2024-01-01T00:00:00.000Z',
            } as UserProfile,
            isVerified: true
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                ...baseUsageLimit,
                can_start: true,
                subscription_status: 'free',
                is_pro: false,
                trial_active: false,
                trial_seconds_remaining: 0,
                private_sample_available: true,
                private_sample_limit_seconds: 300,
                private_sample_seconds_used: 0,
                private_sample_seconds_remaining: 300,
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

    it('should keep the implicit Native default for Pro users (Option A: no auto-promotion to Private)', async () => {
        // Option A first-use trust fix: a fresh Pro user stays on the instant Browser/
        // Native default and is NOT auto-promoted into the Private model-setup wall before
        // their first transcript. Private remains an explicit user-selected mode.
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
            expect(mockStore.getState().sttMode).toBe('native');
        });
    });

    it('should honor the E2E native-mode bridge even for Pro-capable users', async () => {
        window.__SS_E2E__ = {
            isActive: true,
            forceNativeMode: true,
        };

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
            expect(mockStore.getState().sttMode).toBe('native');
        });
    });
});
