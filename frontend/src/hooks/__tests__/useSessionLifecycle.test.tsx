import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessionLifecycle } from '../useSessionLifecycle';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSpeechRecognition } from '../useSpeechRecognition';
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

import { useTranscriptionContext } from '@/providers/useTranscriptionContext';

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
        requestModeChange: vi.fn(() => ({ accepted: true })),
        updatePolicy: vi.fn(),
        syncForensicState: vi.fn(),
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
    hasActivePrivateSample: vi.fn((u: { private_sample_available?: boolean; private_sample_seconds_remaining?: number } | null | undefined) =>
        u?.private_sample_available === true && Math.max(0, u?.private_sample_seconds_remaining ?? 0) > 0),
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

// #1120 S1: pin TODAY's behavior (hierarchy OFF; Cloud available/fail-closed-but-enabled here) so these
// pre-S1 tests validate unchanged. S1-ON behavior is covered by dedicated S1 tests.
vi.mock('@/config/sttHierarchyFlags', () => ({
    isPrivatePrimaryEnabled: () => false,
    isCloudSttEnabled: () => true,
    isCloudSttGloballyVisible: () => true,
    resolveDefaultSttMode: (p: boolean, c: boolean) => (p && c ? 'private' : 'native'),
    sttFlagsReadyInitial: () => true,
    onSttFlagsReady: () => () => {},
    STT_HIERARCHY_FLAG_KEY: 'stt_private_primary_v1',
    CLOUD_STT_FLAG_KEY: 'cloud_stt_enabled',
}));describe('useSessionLifecycle - Auto-Stop Logic', () => {
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

    /**
     * #1089 review finding: `handleStartStop` is a TOGGLE. A backstop event arriving when nothing is
     * recording (a late frame during teardown) would fall into its START branch and create exactly the
     * stray recording this issue exists to eliminate. A stale event must be cleared, never toggled.
     */
    it('#1089: a stale capture-backstop event while Ready is cleared and NEVER starts a recording', async () => {
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: false,               // nothing is recording...
            runtimeState: 'READY',
            elapsedTime: 0,
            startTime: null,
            captureLimitReached: { bufferedSeconds: 900, limitSeconds: 900 }, // ...but the signal is set
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });

        await waitFor(() => {
            expect(mockStore.getState().captureLimitReached).toBeNull();
        }, { timeout: 2000 });

        expect(mockStartListening).not.toHaveBeenCalled();
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
    });

    it('caps a Private recording at 10 minutes / 600s (auto-stops past the per-recording cap, independent of budget)', async () => {
        // Beta recording length = 10 min (raised from 5; the old value assumed slow finalization, now measured
        // false at ~38.7s for a 5-min take on MT-WASM). Generous usage budget so ONLY the cap can trigger the stop.
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
            elapsedTime: 601, // past the 600s (10-min) per-recording cap
            startTime: Date.now() - 601000,
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

    /**
     * #1089 REGRESSION — the observed stray 9-second session.
     *
     * A Private take auto-stopped at the cap. The runtime FSM returned to READY while the
     * whole-utterance decode was still running, so the record control was live and labelled "Start".
     * The user reached for Stop and instead began a SECOND recording, which they then stopped —
     * producing a stray 9-second session and a "Ready to record" surface showing 00:09.
     *
     * Finalization is the authoritative gate: while it runs, no new recording may begin.
     */
    it('#1089: does NOT start a new recording while the previous take is still finalizing (stray-session repro)', async () => {
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: false,
            runtimeState: 'READY',            // FSM already back to READY...
            isTranscriptFinalizing: true,     // ...while the decode is still running
            elapsedTime: 0,
            startTime: null,
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });

        // The control must be non-interactive for the WHOLE finalization window, not just STOPPING.
        expect(result.current.isButtonDisabled).toBe(true);

        // Defence in depth: even a direct invocation (UI bypass) must not start a recording.
        await act(async () => {
            await result.current.handleStartStop();
        });
        expect(mockStartListening).not.toHaveBeenCalled();
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
    });

    /**
     * #1089 — the hard capture backstop. Reaching it means the engine has STOPPED accepting audio.
     * The old behaviour returned silently and kept showing "Recording" while the audio was discarded.
     * The app must instead perform a controlled stop so everything captured before the guard is
     * finalized and saved.
     */
    it('#1089: performs a controlled stop when the engine reports the capture backstop', async () => {
        // The file-level useUsageLimit default is remaining_seconds: 30, which would auto-stop at
        // elapsedTime 120 all on its own — the assertion would then pass with the backstop feature
        // deleted. Pin a generous budget so the ONLY reachable stop is the capture backstop.
        const generousLimit: UsageLimitCheck = {
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
        vi.mocked(useUsageLimit).mockReturnValue({
            data: generousLimit,
            isLoading: false,
            isError: false,
            error: null,
            status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: true,
            runtimeState: 'RECORDING',
            elapsedTime: 120,                 // well under the 600s cap — only the backstop can fire
            startTime: Date.now() - 120000,
            captureLimitReached: { bufferedSeconds: 900, limitSeconds: 900 },
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

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });

        await waitFor(() => {
            expect(speechRuntimeController.stopRecording).toHaveBeenCalled();
        }, { timeout: 2000 });

        // Provenance: the stop must be attributable to the CAPTURE BACKSTOP. Without this the test
        // passes for any stop route (budget, cap, VAD) and proves nothing about the feature.
        await waitFor(() => {
            expect(mockStore.getState().setSTTStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('maximum recording length'),
                }),
            );
        }, { timeout: 2000 });
        // One-shot: a single backstop signal must not produce repeated stops.
        expect(speechRuntimeController.stopRecording).toHaveBeenCalledTimes(1);

        // vitest has no mockReset here, so restore the file default rather than leaking this
        // generous budget into later tests (which would silently disable their 30s-limit stops).
        vi.mocked(useUsageLimit).mockReturnValue(
            mockUsageLimitQuery as unknown as UseQueryResult<UsageLimitCheck, Error>,
        );
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

    it('surfaces the sanitized engine-start leaf name on the recording_start_failed event (Decision 1C)', async () => {
        // Production shape: the controller throws the generic wrapper with the root leaf attached as
        // `cause`. The failure event must carry the leaf NAME (co-located with the failure) so it is
        // self-diagnosing without Sentry — name only, no message/stack.
        const pushSpy = vi.spyOn(analyticsBuffer, 'push');
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValueOnce(
            Object.assign(new Error('TRANSCRIPTION_START_DID_NOT_RECORD:FAILED'), {
                cause: Object.assign(new Error('Requested device in use'), { name: 'NotReadableError' }),
            })
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

        const failedCall = pushSpy.mock.calls.find(([event]) => event === 'recording_start_failed');
        expect(failedCall).toBeDefined();
        expect(failedCall?.[1]).toMatchObject({ start_leaf_name: 'NotReadableError' });
        // The wrapper's own name/message never leak the leaf; the leaf name is the extra diagnostic.
        expect(failedCall?.[1]).toMatchObject({ error_message: 'TRANSCRIPTION_START_DID_NOT_RECORD:FAILED' });
        pushSpy.mockRestore();
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

    it('P1: an AUTO-STOP (stopReason present) does NOT overwrite the controller metrics-persistence warning', async () => {
        // Real lifecycle path: stopRecording RESOLVES SUCCESSFULLY and the controller leaves a
        // warning (guardedStopStatus) because filler/metrics persistence failed. A non-empty stopReason
        // (auto-stop) must NOT replace that warning with success/stopReason info.
        const warning = {
            type: 'warning' as const,
            message: 'Session saved.',
            detail: 'some analysis metrics could not be updated yet.',
        };
        const mockStore = createTestSessionStore({
            isListening: true,
            elapsedTime: 301,
            startTime: Date.now() - 301000,
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript, chunks: [], interimTranscript: '',
            fillerData: { total: { count: 0, color: '' } },
            startListening: mockStartListening, stopListening: mockStopListening,
            isListening: true, isReady: true, isSupported: true, error: null, reset: mockReset,
            pauseMetrics: basePauseMetrics, modelLoadingProgress: null,
            sttStatus: { type: 'recording', message: 'Speak now' },
            mode: 'native', micWarning: null, micLevel: 0, hasSpeechActivity: false,
        });

        // stopRecording resolves a VALID result (truthy → not the empty-session path) and leaves the
        // controller warning, exactly as the real controller does on degraded persistence.
        vi.mocked(speechRuntimeController.stopRecording).mockImplementationOnce(async () => {
            mockStore.getState().setSTTStatus(warning);
            return { transcript: 'hello there', total_words: 2, accuracy: 100, duration: 301 } as TranscriptStats;
        });

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (
                <TranscriptionProvider>{children}</TranscriptionProvider>
            ),
        });

        await act(async () => {
            await result.current.handleStartStop({ stopReason: 'Auto-stopped: your 5-minute sample ended.' });
        });

        // The warning + detail survive: neither the auto-stop stopReason nor the success copy replaced them.
        expect(mockStore.getState().sttStatus).toEqual(warning);
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

    // #957 safety branch: mic start-ability is gated on the DURABLE privateModelStatus
    // (data-model-status), not the transient sttStatus. This is the exact logic whose absence
    // let an earlier fix regress returning users into a dead mic — so it is covered here directly.
    describe('isButtonDisabled — durable Private model gate (#957)', () => {
        afterEach(() => {
            document.documentElement.removeAttribute('data-model-status');
        });

        const renderWithModelStatus = (status: string, sttMode: 'private' | 'native', runtimeState: string) => {
            document.documentElement.setAttribute('data-model-status', status);
            // isButtonDisabled reads runtimeState from the transcription context, not the store.
            vi.mocked(useTranscriptionContext).mockReturnValue({
                service: { getTranscriptionService: vi.fn() },
                runtimeState,
            } as never);
            const mockStore = createTestSessionStore({ isListening: false, runtimeState, sttMode } as never);
            (useSessionStore as unknown as Mock).mockImplementation(mockStore);
            (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
            (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
            return renderHook(() => useSessionLifecycle(), {
                wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
            }).result;
        };

        it('keeps the mic ENABLED for a returning Private user at post-session idle (model cached)', () => {
            // The regression an earlier fix caused: gating on transient status locked this out. The
            // durable idle state (model still cached) must remain startable — no reload required.
            expect(renderWithModelStatus('idle', 'private', 'READY').current.isButtonDisabled).toBe(false);
        });

        it('keeps the mic ENABLED when the Private model is ready', () => {
            expect(renderWithModelStatus('ready', 'private', 'READY').current.isButtonDisabled).toBe(false);
        });

        it.each(['download-required', 'loading', 'init-failed', 'error'])(
            'BLOCKS start for a not-ready Private model status: %s',
            (status) => {
                expect(renderWithModelStatus(status, 'private', 'READY').current.isButtonDisabled).toBe(true);
            },
        );

        it('does not block Native mode regardless of data-model-status', () => {
            expect(renderWithModelStatus('download-required', 'native', 'READY').current.isButtonDisabled).toBe(false);
        });
    });
});

describe('useSessionLifecycle - engine-selection lock delegation (#1033 A)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const mockStore = createTestSessionStore({ sttMode: 'private' });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'u', subscription_status: 'free', email: 'e@e.com' } as UserProfile,
            isVerified: true,
        });
    });

    const renderIt = () => renderHook(() => useSessionLifecycle(), {
        wrapper: ({ children }) => (<TranscriptionProvider>{children}</TranscriptionProvider>),
    });

    it('setMode routes through requestModeChange and does NOT apply when the controller rejects (locked)', () => {
        vi.mocked(speechRuntimeController.requestModeChange).mockReturnValue({ accepted: false, reason: 'engine_selection_locked' });
        const { result } = renderIt();
        act(() => { result.current.setMode('native'); });
        // delegated to the single authoritative decision — and it did NOT independently mutate anything
        expect(speechRuntimeController.requestModeChange).toHaveBeenCalledWith('native', expect.objectContaining({ preferredMode: 'native' }));
        expect(speechRuntimeController.updatePolicy).not.toHaveBeenCalled(); // no direct policy write bypassing the gate
        expect(speechRuntimeController.syncForensicState).not.toHaveBeenCalled(); // early-returned before applying
    });

    it('setMode applies (syncForensicState) when the controller accepts', () => {
        vi.mocked(speechRuntimeController.requestModeChange).mockReturnValue({ accepted: true });
        const { result } = renderIt();
        act(() => { result.current.setMode('native'); });
        expect(speechRuntimeController.requestModeChange).toHaveBeenCalled();
        expect(speechRuntimeController.syncForensicState).toHaveBeenCalled();
    });
});
