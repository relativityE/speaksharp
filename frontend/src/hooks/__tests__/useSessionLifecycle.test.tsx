// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { useSessionLifecycle } from '../useSessionLifecycle';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSpeechRecognition } from '../useSpeechRecognition';
import { useUsageLimit } from '../useUsageLimit';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TranscriptStats } from '../useSpeechRecognition/types';
import type { SttStatus } from '@/services/transcription/TranscriptionService';
import type { UsageLimitCheck } from '../useUsageLimit';
import type { PauseMetrics } from '@/services/audio/pauseDetector';

// Mock ALL hooks used inside useSessionLifecycle
vi.mock('@/contexts/AuthProvider', () => ({
    useAuthProvider: () => ({ session: { access_token: 'mock-token' }, user: { id: 'test-user' } }),
}));

vi.mock('../useUserProfile', () => ({
    useUserProfile: () => ({ data: { subscription_status: 'free' }, isLoading: false }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/stores/useSessionStore', () => ({
    useSessionStore: vi.fn(() => ({ updateElapsedTime: vi.fn(), elapsedTime: 0 })),
}));

// Global mock for useUsageLimit
const baseUsageLimit: UsageLimitCheck = {
    can_start: true,
    remaining_seconds: 30,
    limit_seconds: 3600,
    subscription_status: 'free',
    is_pro: false,
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

vi.mock('../useSpeechRecognition', () => ({
    useSpeechRecognition: vi.fn(() => ({
        transcript: baseTranscript,
        chunks: [],
        interimTranscript: '',
        fillerData: {},
        startListening: vi.fn(),
        stopListening: vi.fn(),
        isListening: false,
        isReady: true,
        isSupported: true,
        error: null,
        reset: vi.fn(),
        pauseMetrics: basePauseMetrics,
        modelLoadingProgress: 0,
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
}));

vi.mock('@/services/transcription/TranscriptionPolicy', () => ({
    buildPolicyForUser: vi.fn(),
}));

vi.mock('@/config/env', () => ({
    MIN_SESSION_DURATION_SECONDS: 5
}));

describe('useSessionLifecycle - Auto-Stop Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should trigger handleStartStop when elapsed time exceeds limit', () => {
        const mockElapsedTime = 31;
        const mockLimit: UsageLimitCheck = {
            remaining_seconds: 30,
            can_start: true,
            limit_seconds: 3600,
            subscription_status: 'free',
            is_pro: false
        };

        vi.mocked(useSessionStore).mockReturnValue({
            updateElapsedTime: vi.fn(),
            elapsedTime: mockElapsedTime,
        });

        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript,
            chunks: [],
            interimTranscript: '',
            fillerData: {},
            startListening: vi.fn(),
            stopListening: vi.fn(),
            isListening: true,
            isReady: true,
            isSupported: true,
            error: null,
            reset: vi.fn(),
            pauseMetrics: basePauseMetrics,
            modelLoadingProgress: 0,
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

        renderHook(() => useSessionLifecycle());

        const { stopListening } = useSpeechRecognition();
        expect(stopListening).toHaveBeenCalled();
    });

    it('should NOT trigger stop when time remains', () => {
        vi.mocked(useSessionStore).mockReturnValue({
            updateElapsedTime: vi.fn(),
            elapsedTime: 29,
        });

        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript,
            chunks: [],
            interimTranscript: '',
            fillerData: {},
            startListening: vi.fn(),
            stopListening: vi.fn(),
            isListening: true,
            isReady: true,
            isSupported: true,
            error: null,
            reset: vi.fn(),
            pauseMetrics: basePauseMetrics,
            modelLoadingProgress: 0,
            sttStatus: { type: 'ready', message: 'Recording' },
            mode: 'native'
        });

        vi.mocked(useUsageLimit).mockReturnValue({
            data: {
                remaining_seconds: 30,
                can_start: true,
                limit_seconds: 3600,
                subscription_status: 'free',
                is_pro: false
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        renderHook(() => useSessionLifecycle());

        const { stopListening } = useSpeechRecognition();
        expect(stopListening).not.toHaveBeenCalled();
    });
});
