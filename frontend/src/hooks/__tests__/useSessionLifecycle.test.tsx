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

    it('does not stop an entitled recording when accumulated usage exceeds former limits', async () => {
        const mockElapsedTime = 31;
        const mockLimit: UsageLimitCheck = {
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

        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
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
        // The 10-minute technical safety cap is independent of commercial entitlement.
        const mockLimit: UsageLimitCheck = {
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
        const generousLimit: UsageLimitCheck = {
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

    it('ignores exhausted legacy sample fields for an entitled Private recording', async () => {
        const mockElapsedTime = 31;
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

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
    });

    it('does not show quota warnings for paid users above former accumulated limits', async () => {
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

        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(mockStore.getState().sttStatus).toEqual({ type: 'idle', message: 'Ready to record' });
        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
    });

    it('honors the canonical can_start=false entitlement result', async () => {
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
                can_start: false,
                subscription_status: 'free',
                is_pro: false,
                streak_count: 0,
                error: 'Your trial has ended'
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
            message: '⛔ Your trial has ended'
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
            await result.current.handleStartStop({ stopReason: 'Auto-stopped at the 10-minute recording cap.' });
        });

        // The warning + detail survive: neither the auto-stop stopReason nor the success copy replaced them.
        expect(mockStore.getState().sttStatus).toEqual(warning);
    });

    it('keeps a downgraded/Free user on Private (Private is universal — never a Browser downgrade)', async () => {
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
            // #1184: Free uses Private like everyone — a Free account is never downgraded to Browser/native.
            expect(mockStore.getState().sttMode).toBe('private');
        });
    });

    it('keeps Private as the only customer engine when entitlement is inactive', async () => {
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

    it('keeps Private selected for an active-trial user', async () => {
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
                trial_active: true,
                trial_seconds_remaining: 30 * 24 * 60 * 60,
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

    it('promotes a default-native session to Private (Private is the only engine — #1184)', async () => {
        // #1184: Private is the sole engine. A session still carrying the legacy 'native' default (not an
        // explicit user choice) is promoted to Private, so no user is left on a retired Browser engine.
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

        // #1184: a plain 'native' session is now promoted to Private (Private is the only engine), so
        // "native stays selectable" is no longer a real user state — the private-model gate above governs
        // the mic. Native persisting only happens under the E2E force-native bridge, covered separately.
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

// #1258 EFFECT-LEVEL regression for the foreground-return reload (not just the predicate): drives the real
// visibilitychange handler mounted by the hook. Reproduces the production condition (store sttMode === null →
// effective 'private') and proves the reload is tied to an ACTUAL controller-owned reclamation TOKEN — a mere
// tab switch (token unchanged) never reloads, and each real reclamation reloads exactly once.
describe('useSessionLifecycle - foreground-return reload after reclamation (#1258)', () => {
    const setVisibility = (state: 'visible' | 'hidden') => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    };
    // Simulate the controller-owned reclamation token advancing because a real idle reclamation happened.
    const setReclamationGen = (n: number) => {
        vi.mocked(speechRuntimeController.getIdleReclamationGeneration as Mock).mockReturnValue(n);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        setVisibility('visible');
        // The exact production condition: the store leaves sttMode UNSET (null).
        const mockStore = createTestSessionStore(); // sttMode defaults to null
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'u', subscription_status: 'free', email: 'e@e.com' } as UserProfile,
            isVerified: true,
        });
        setReclamationGen(0); // no reclamation has happened yet at mount
    });

    afterEach(() => setVisibility('visible'));

    const renderIt = () => renderHook(() => useSessionLifecycle(), {
        wrapper: ({ children }) => (<TranscriptionProvider>{children}</TranscriptionProvider>),
    });

    it('reloads with effective private mode after a REAL reclamation, even though the store sttMode is null', () => {
        renderIt(); // mount observes token=0
        vi.mocked(speechRuntimeController.warmUp).mockClear();

        setReclamationGen(1); // a genuine idle reclamation occurred while the tab was away
        setVisibility('visible'); // user returns

        expect(speechRuntimeController.warmUp).toHaveBeenCalledTimes(1);
        expect(speechRuntimeController.warmUp).toHaveBeenCalledWith('private');
    });

    it('does NOT reload on a quick tab switch that reclaimed nothing (token unchanged)', () => {
        renderIt();
        vi.mocked(speechRuntimeController.warmUp).mockClear();

        // Token stays 0 — no reclamation. A hide→show tab switch must not reload.
        setVisibility('hidden');
        setVisibility('visible');

        expect(speechRuntimeController.warmUp).not.toHaveBeenCalled();
    });

    it('issues EXACTLY ONE reload per reclamation across repeated visible events', () => {
        renderIt();
        vi.mocked(speechRuntimeController.warmUp).mockClear();

        setReclamationGen(1);
        setVisibility('visible'); // consumes token 1 → 1 reload
        setVisibility('visible'); // same token → no re-issue
        setVisibility('visible');

        expect(speechRuntimeController.warmUp).toHaveBeenCalledTimes(1);
    });

    it('reloads again only when a NEW reclamation advances the token', () => {
        renderIt();
        vi.mocked(speechRuntimeController.warmUp).mockClear();

        setReclamationGen(1);
        setVisibility('visible'); // reload for reclamation #1
        setReclamationGen(2);      // a second genuine reclamation
        setVisibility('visible'); // reload for reclamation #2

        expect(speechRuntimeController.warmUp).toHaveBeenCalledTimes(2);
    });
});
