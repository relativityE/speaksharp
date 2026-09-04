import { act, renderHook } from '@testing-library/react';
import { useSessionLifecycle } from '../useSessionLifecycle';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUsageLimit } from '../useUsageLimit';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TranscriptStats } from '../useSpeechRecognition/types';
import { SttStatus } from '@/types/transcription';

import type { UsageLimitCheck } from '../useUsageLimit';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import type { UserProfile } from '@/types/user';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';

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
        warmUp: vi.fn().mockResolvedValue(undefined), // real warmUp is async — the return-reload does `.catch()` on it
        getState: vi.fn(() => 'IDLE'),
        getIdleReclamationGeneration: vi.fn(() => 0),
        requestModeChange: vi.fn(() => ({ accepted: true })),
        updatePolicy: vi.fn(),
        syncForensicState: vi.fn(),
    },
}));

import { speechRuntimeController } from '@/services/SpeechRuntimeController';

// Global mock for useUsageLimit
const baseUsageLimit: UsageLimitCheck = {
    can_start: true,
    subscription_status: 'free',
    is_pro: false,
    streak_count: 0,
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
    getEffectiveSubscriptionStatus: vi.fn((usageStatus: string | undefined, profile: { subscription_status?: string } | null | undefined) => usageStatus ?? profile?.subscription_status ?? 'free'),
}));

vi.mock('@/services/transcription/TranscriptionPolicy', () => ({
    buildPolicyForUser: vi.fn(() => ({
        allowNative: false,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'private',
        allowFallback: false,
        executionIntent: 'test'
    })),
}));

vi.mock('@/config/env', () => ({
    MIN_SESSION_DURATION_SECONDS: 5
}));

/**
 * #1259 F01 — RECORDING INTENT, PROVED THROUGH THE REAL PRODUCER.
 *
 * The emitter's own tests (journeyEvents.test.ts) pass whether or not `handleStartStop` calls it, so
 * deleting a `reportIntent(...)` from the hook left them all green. That is the exact failure mode the
 * matrix calls out: a fixture authored to agree with the detector. These drive the hook itself, with
 * the store and dependency mocks the rest of this suite already uses, and assert on what reaches the
 * analytics boundary.
 *
 * The header above is shared verbatim with useSessionLifecycle.test.tsx: same mocks, same store
 * factory, so a path that works here works there.
 */
describe('#1259 F01 — every intent reaches analytics through the real hook', () => {
    const pushSpy = vi.spyOn(analyticsBuffer, 'push');

    const intents = () => pushSpy.mock.calls
        .filter((c) => c[0] === 'recording_intent')
        .map((c) => c[1] as Record<string, unknown>);

    const mountWith = (storeOverrides: Parameters<typeof createTestSessionStore>[0] = {}) => {
        const mockStore = createTestSessionStore(storeOverrides);
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        return renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        pushSpy.mockClear();
        delete window.__SS_E2E__;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'test-user', subscription_status: 'free', email: 'test@example.com' } as UserProfile,
            isVerified: true,
        });
        vi.mocked(useUsageLimit).mockReturnValue(mockUsageLimitQuery);
        vi.mocked(speechRuntimeController.startRecording).mockResolvedValue(undefined as never);
    });

    afterEach(() => pushSpy.mockClear());

    it('an ACCEPTED start reports its intent BEFORE startRecording is awaited', async () => {
        const { result } = mountWith({ runtimeState: 'READY' });
        await act(async () => { await result.current.handleStartStop(); });

        expect(intents()).toHaveLength(1);
        expect(intents()[0].intent_outcome).toBe('accepted');
        // Order matters: `session_started` is pushed only after startRecording RESOLVES, so a start
        // that hangs — the 113s and 126s waits Production shows — records nothing without this.
        const names = pushSpy.mock.calls.map((c) => c[0]);
        expect(names.indexOf('recording_intent')).toBeLessThan(names.indexOf('session_started'));
    });

    it('a SECOND click while the first is in flight is reported, not silently dropped', async () => {
        // The first start never resolves, so `isProcessingRef` is still held on the second click.
        let release: (() => void) | undefined;
        vi.mocked(speechRuntimeController.startRecording).mockImplementation(
            () => new Promise<void>((resolve) => { release = resolve; }) as never,
        );
        const { result } = mountWith({ runtimeState: 'READY' });

        await act(async () => {
            void result.current.handleStartStop();       // in flight, not awaited
            await result.current.handleStartStop();      // the second click
        });

        const outcomes = intents().map((i) => i.intent_outcome);
        // Before this change the second click returned with no log and no event, which made
        // "two clicks required" and "one click, silent wait" identical in the data.
        expect(outcomes).toContain('suppressed_in_flight');
        release?.();
    });

    it('a start refused because the previous take is still finalizing says so', async () => {
        const { result } = mountWith({ runtimeState: 'READY', isTranscriptFinalizing: true });
        await act(async () => { await result.current.handleStartStop(); });

        expect(intents()).toHaveLength(1);
        expect(intents()[0].intent_outcome).toBe('suppressed_finalizing');
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
    });

    it('a start refused by the usage limit is distinguishable from one refused for any other reason', async () => {
        vi.mocked(useUsageLimit).mockReturnValue({
            ...mockUsageLimitQuery,
            data: { ...baseUsageLimit, can_start: false, error: 'trial_expired' },
        } as never);
        const { result } = mountWith({ runtimeState: 'READY' });
        await act(async () => { await result.current.handleStartStop(); });

        expect(intents().map((i) => i.intent_outcome)).toEqual(['blocked_usage_limit']);
    });

    it('a start that THROWS reports a failed intent as well as recording_start_failed', async () => {
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValue(new Error('boom') as never);
        const { result } = mountWith({ runtimeState: 'READY' });
        await act(async () => { await result.current.handleStartStop(); });

        const outcomes = intents().map((i) => i.intent_outcome);
        // `accepted` is emitted before the await, so a throw leaves BOTH — which is correct: the intent
        // was accepted, and then it failed. Collapsing them would lose the fact that recording was
        // genuinely attempted.
        expect(outcomes).toEqual(['accepted', 'failed']);
    });

    it('carries the runtime state the machine was ACTUALLY in at the click', async () => {
        const { result } = mountWith({ runtimeState: 'ENGINE_INITIALIZING', isTranscriptFinalizing: true });
        await act(async () => { await result.current.handleStartStop(); });
        expect(intents()[0].runtime_state_at_intent).toBe('ENGINE_INITIALIZING');
        expect(intents()[0].model_ready).toBe(false);
    });
});
