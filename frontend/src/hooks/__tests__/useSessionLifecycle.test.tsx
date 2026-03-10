import { renderHook, waitFor } from '../../../tests/support/test-utils';
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

vi.mock('@/contexts/AuthProvider', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/contexts/AuthProvider')>();
    return {
        ...actual,
        useAuthProvider: () => ({ session: { access_token: 'mock-token' }, user: { id: 'test-user' } }),
    };
});

// Redundant useUserProfile removed

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();
    return {
        ...actual,
        useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    };
});

import { createTestSessionStore } from '../../../tests/unit/factories/storeFactory';

vi.mock('@/stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));

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
}));

vi.mock('@/services/transcription/TranscriptionPolicy', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/transcription/TranscriptionPolicy')>();
    return {
        ...actual,
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
    };
});

vi.mock('@/config/env', () => ({
    MIN_SESSION_DURATION_SECONDS: 5
}));

describe('useSessionLifecycle - Auto-Stop Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Use factory for a fresh store each test
        (useSessionStore as unknown as Mock).mockImplementation(createTestSessionStore());

        // Ensure default is free for auto-stop tests
        vi.mocked(useProfile).mockReturnValue({
            id: 'test-user',
            subscription_status: 'free',
            email: 'test@example.com'
        } as unknown as UserProfile);
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
            is_pro: false
        };

        (useSessionStore as unknown as Mock).mockImplementation(createTestSessionStore({
            isListening: true, // AUTO-STOP logic requires isListening to be true
            elapsedTime: mockElapsedTime,
            startTime: Date.now() - (mockElapsedTime * 1000),
        }));

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

        // Verify it is indeed a Free user via isPro mock if necessary, 
        // but isPro(profile.subscription_status) handles it.

        renderHook(() => useSessionLifecycle());

        await waitFor(() => {
            expect(mockStopListening).toHaveBeenCalled();
        }, { timeout: 2000 });
    });

    it('should NOT trigger stop when time remains', () => {
        (useSessionStore as unknown as Mock).mockImplementation(createTestSessionStore({
            elapsedTime: 25,
            isListening: true,
            startTime: Date.now() - 25000,
        }));

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
                subscription_status: 'free',
                is_pro: false
            },
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        renderHook(() => useSessionLifecycle());

        expect(mockStopListening).not.toHaveBeenCalled();
    });
});
