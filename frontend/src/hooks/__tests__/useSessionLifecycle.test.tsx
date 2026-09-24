import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessionLifecycle } from '../useSessionLifecycle';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSpeechRecognition } from '../useSpeechRecognition';
import { useUsageLimit } from '../useUsageLimit';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TranscriptStats } from '../useSpeechRecognition/types';
import { SttStatus } from '@/types/transcription';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

import type { UsageLimitCheck } from '../useUsageLimit';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import type { UserProfile } from '@/types/user';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { consumeModelComparisonTakeAuthorization } from '@/services/transcription/modelComparisonAuthorization';
import { authorizeProduction, resetAuthorization } from '@/services/transcription/__tests__/modelComparisonAuthorization.helper';

// Mock ALL hooks used inside useSessionLifecycle
// #1476: the account-wide recording lease. Granted by default so these suites exercise the Start flow beyond it;
// `leaseMock` lets a test script a refusal, a take-over or a revocation.
const leaseMock = vi.hoisted(() => ({
    acquire: vi.fn(async (_opts?: { force?: boolean }): Promise<import('@/services/recordingLeasePolicy').LeaseDecision> => ({ action: 'start', tookOver: false })),
    release: vi.fn(async () => undefined),
    heartbeat: vi.fn((_onRevoked: () => void) => undefined),
    confirm: vi.fn(async (): Promise<'held' | 'revoked' | 'unconfirmed'> => 'held'),
    /** The lease this tab holds now (a newer take replaces it). */
    current: null as string | null,
    issued: 0,
    /** Leases actually released (a release with nothing held makes no RPC in the real module). */
    releasedIds: [] as string[],
}));
// #1476: the server's per-session Progress obligations, loaded at Start. Answers "nothing owed" by default.
const obligationsMock = vi.hoisted(() => ({
    hydrate: vi.fn(async (_userId: string, _nowIso: string, _opts?: { isLive?: () => boolean }): Promise<{ ok: boolean; queued: number; authority: 'server' | 'unavailable'; failure?: 'unpersisted' | 'cancelled' }> => ({ ok: true, queued: 0, authority: 'server' })),
}));
vi.mock('@/services/progress/serverProgressObligations', () => ({
    hydrateServerProgressObligations: (userId: string, nowIso: string, _rpc?: unknown, opts?: { isLive?: () => boolean }) => obligationsMock.hydrate(userId, nowIso, opts),
}));
vi.mock('@/services/recordingLease', () => ({
    // Answers like the real module: a granted Start holds a lease (currentTakeLeaseId), a release clears it.
    acquireTakeLease: async (opts?: { force?: boolean }) => {
        const decision = await leaseMock.acquire(opts);
        if (decision.action === 'start') leaseMock.current = `lease-${++leaseMock.issued}`;
        return decision;
    },
    // Like recordingLease.releaseTakeLease: the held lease is forgotten synchronously, before the RPC is awaited.
    releaseTakeLease: async () => { const held = leaseMock.current; leaseMock.current = null; if (held !== null) leaseMock.releasedIds.push(held); await leaseMock.release(); },
    startLeaseHeartbeat: (onRevoked: () => void) => leaseMock.heartbeat(onRevoked),
    confirmTakeLease: () => leaseMock.confirm(),
    currentTakeLeaseId: () => leaseMock.current,
}));

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
import { enqueueProgressReconcile } from '@/services/progress/progressReconcileQueue';

vi.mock('@/stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));
vi.mock('@/services/SpeechRuntimeController', () => ({
    /**
     * #1431 P1 — the hook now distinguishes a controlled owner-fence refusal from a failed start, so
     * the mocked module must export the type. Without it the import is undefined and every
     * `instanceof` in the start catch throws before the behaviour under test is reached.
     */
    StartRefusedFinalizationError: class StartRefusedFinalizationError extends Error {
        constructor() {
            super('START_REFUSED_FINALIZATION_IN_PROGRESS');
            this.name = 'StartRefusedFinalizationError';
        }
    },
    speechRuntimeController: {
        startRecording: vi.fn(),
        retireEngineForUnmount: vi.fn(async (): Promise<'terminal' | 'unconfirmed'> => 'terminal'),
        isEngineTerminal: vi.fn((): boolean => true),
        confirmEngineShutdown: vi.fn(async (): Promise<'terminal' | 'unconfirmed'> => 'terminal'),
        whenStable: vi.fn(async (): Promise<void> => undefined),
        stopRecording: vi.fn(async () => ({ 
            transcript: '', 
            total_words: 0, 
            accuracy: 100, 
            duration: 0 
        } as TranscriptStats)),
        reset: vi.fn(),
        warmUp: vi.fn().mockResolvedValue(undefined), // real warmUp is async — the return-reload does `.catch()` on it
        // #1476: a displaced take resolves by discarding (its save is refused server-side).
        discardUnresolvedRecording: vi.fn(async () => ({ outcome: 'discarded' as const, sessionId: null })),
        getState: vi.fn(() => 'IDLE'),
        getIdleReclamationGeneration: vi.fn(() => 0),
        getSessionId: vi.fn(() => '22222222-2222-4222-8222-222222222222'),
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

    it('#1432 CASUALTY: emits the signed document and exact persisted-session binding on save', async () => {
        const pushSpy = vi.spyOn(analyticsBuffer, 'push');
        await authorizeProduction({
            nonce: 'binding-vector-123456',
            evidenceDocumentId: '11111111-1111-4111-8111-111111111111',
        });
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(true);

        const mockStore = createTestSessionStore({
            sttMode: 'private', isListening: true, runtimeState: 'RECORDING', elapsedTime: 10,
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        vi.mocked(useSpeechRecognition).mockReturnValue({
            transcript: baseTranscript, chunks: [], interimTranscript: '',
            fillerData: { total: { count: 0, color: '' } }, startListening: mockStartListening,
            stopListening: mockStopListening, isListening: true, isReady: true, isSupported: true,
            error: null, reset: mockReset, pauseMetrics: basePauseMetrics, modelLoadingProgress: null,
            sttStatus: { type: 'recording', message: 'Speak now' }, mode: 'private', micWarning: null,
            micLevel: 0, hasSpeechActivity: false,
        });

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });
        await act(async () => { await result.current.handleStartStop(); });

        const saved = pushSpy.mock.calls.find(([event]) => event === 'session_saved');
        expect(saved?.[1]).toMatchObject({
            comparison_nonce: 'binding-vector-123456',
            comparison_evidence_document_id: '11111111-1111-4111-8111-111111111111',
            comparison_session_binding_sha256: '79fb824b7746e990fce8913b12e004b18ea1f706ff69722a3da91fb25289e478',
        });
        // #1432 PM Option A — journey/attempt identity is the envelope's; the producer never supplies it.
        for (const envelopeKey of ['journey_id', 'attempt_id', 'attempt_seq', 'boot_id']) {
            expect(saved?.[1]).not.toHaveProperty(envelopeKey);
        }
        pushSpy.mockRestore();
        resetAuthorization();
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
    /**
     * #1431 — THE START GUARD ITSELF, not the boolean behind it.
     *
     * `isTranscriptFinalizing` exists to hold this guard closed: while a take is finalizing,
     * `handleStartStop` must refuse a start outright, so a second take cannot be admitted into a
     * session the first has not finished writing.
     *
     * My first casualty for this asserted the LATCH and claimed to assert the refusal. Codex was right
     * that it did not: a regression removing the check here would have left it green while take C was
     * admitted. This drives the real hook and asserts what the user's click actually does.
     */
    it('#1431: a start is REFUSED while a previous take is still finalizing', async () => {
        const mockStore = createTestSessionStore({
            sttMode: 'private',
            isListening: false,               // nothing is recording...
            runtimeState: 'READY',            // ...and the runtime looks ready...
            elapsedTime: 0,
            startTime: null,
            isTranscriptFinalizing: true,     // ...but the previous take is still finalizing.
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });

        await act(async () => { await result.current.handleStartStop(); });

        // The click is refused at the guard — no recording is started for a session still being written.
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        // And the control is not interactive, so the refusal is visible rather than silent.
        expect(result.current.isButtonDisabled).toBe(true);
    });

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

    it('CASUALTY: an owner-fence REFUSAL is not a failed start — no reset, no failure event, no status', async () => {
        /**
         * #1431 P1 — THE DEFECT WAS HERE, IN THIS CATCH.
         *
         * The controller's owner fence rejects a Start while a stop is still finalizing. This catch
         * treated EVERY rejection as an engine-acquisition failure: it emitted `recording_start_failed`,
         * overwrote `sttStatus`, and called `reset('start_failed')` — which detaches the current
         * service. That service belongs to the finalizing take, so the fence added to preserve its
         * transcript would have destroyed it here instead, by a longer route.
         *
         * The sibling test above is the CONTROL: an ordinary `NotAllowedError` must still reset and
         * still publish an error. The pair is what makes the distinction real rather than asserted.
         */
        const pushSpy = vi.spyOn(analyticsBuffer, 'push');
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValueOnce(
            Object.assign(new Error('START_REFUSED_FINALIZATION_IN_PROGRESS'), {
                name: 'StartRefusedFinalizationError',
            }),
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
            profile: { id: 'test-user', subscription_status: 'pro', email: 'test@example.com' } as UserProfile,
            isVerified: true,
        });
        vi.mocked(useUsageLimit).mockReturnValue({
            data: { can_start: true, subscription_status: 'pro', is_pro: true, streak_count: 0 },
            isLoading: false, isError: false, error: null, status: 'success',
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => (<TranscriptionProvider>{children}</TranscriptionProvider>),
        });

        await act(async () => { await result.current.handleStartStop(); });

        expect(speechRuntimeController.reset,
            "the finalizing take's service must not be detached").not.toHaveBeenCalledWith('start_failed');
        expect(pushSpy.mock.calls.map((c) => c[0]),
            'a refusal is not a start failure').not.toContain('recording_start_failed');
        expect(mockStore.getState().sttStatus.type,
            "the owner's session keeps its own status").not.toBe('error');
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
        // #1184/#1320: Private is the sole engine. A session still carrying the legacy 'native' default
        // (not an explicit user choice) is promoted to Private. 'native' is no longer a TranscriptionMode,
        // so it is cast here to simulate a stale persisted value the migration must clean up.
        const mockStore = createTestSessionStore({
            sttMode: 'native' as unknown as TranscriptionMode,
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

    it('#1428 F-15 settles initialization latency only when the controller reaches recording authority', async () => {
        // `idle` after a completed take is cached and immediately startable. Treating every status
        // other than `ready` as cold corrupts the returning-user distribution.
        document.documentElement.setAttribute('data-model-status', 'idle');
        let resolveStart!: () => void;
        const startPending = new Promise<void>((resolve) => { resolveStart = resolve; });
        vi.mocked(speechRuntimeController.startRecording).mockReturnValueOnce(startPending);
        const pushSpy = vi.spyOn(analyticsBuffer, 'push');
        const mockStore = createTestSessionStore({
            isListening: false,
            runtimeState: 'READY',
            sttMode: 'private',
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        vi.mocked(useUsageLimit).mockReturnValue({
            ...mockUsageLimitQuery,
            data: { ...baseUsageLimit, can_start: true },
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });
        let startAction!: Promise<void>;
        act(() => { startAction = result.current.handleStartStop(); });

        await waitFor(() => expect(speechRuntimeController.startRecording).toHaveBeenCalledTimes(1));
        expect(pushSpy.mock.calls.some(([event]) => event === 'session_start_latency_measured')).toBe(false);

        await act(async () => {
            vi.mocked(speechRuntimeController.getState).mockReturnValueOnce('RECORDING');
            resolveStart();
            await startAction;
        });
        const latency = pushSpy.mock.calls.find(([event]) => event === 'session_start_latency_measured');
        expect(latency?.[1]).toMatchObject({
            mode: 'private',
            outcome: 'recording_started',
            duration_ms: expect.any(Number),
            model_cache_state: 'cached',
        });
        expect(Number.isInteger((latency?.[1] as Record<string, unknown>)?.duration_ms)).toBe(true);
        pushSpy.mockRestore();
    });

    it('#1428 CASUALTY: a non-throwing start refusal never reports a recording start', async () => {
        vi.mocked(speechRuntimeController.startRecording).mockResolvedValueOnce(undefined);
        vi.mocked(speechRuntimeController.getState).mockReturnValueOnce('READY');
        const pushSpy = vi.spyOn(analyticsBuffer, 'push');
        const mockStore = createTestSessionStore({
            isListening: false,
            runtimeState: 'READY',
            sttMode: 'private',
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        vi.mocked(useUsageLimit).mockReturnValue({
            ...mockUsageLimitQuery,
            data: { ...baseUsageLimit, can_start: true },
        } as unknown as UseQueryResult<UsageLimitCheck, Error>);

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });
        await act(async () => { await result.current.handleStartStop(); });

        expect(pushSpy.mock.calls.find(([event]) => event === 'session_start_latency_measured')?.[1])
            .toMatchObject({ outcome: 'refused' });
        expect(pushSpy.mock.calls.some(([event]) => event === 'session_started')).toBe(false);
        pushSpy.mockRestore();
    });

    it('#1428 F-16 settles Stop latency only after the saved review decision is ready', async () => {
        let resolveStop!: (value: TranscriptStats) => void;
        const stopPending = new Promise<TranscriptStats>((resolve) => { resolveStop = resolve; });
        vi.mocked(speechRuntimeController.stopRecording).mockReturnValueOnce(stopPending);
        const pushSpy = vi.spyOn(analyticsBuffer, 'push');
        const mockStore = createTestSessionStore({
            isListening: true,
            runtimeState: 'RECORDING',
            elapsedTime: 30,
            startTime: Date.now() - 30_000,
            sttMode: 'private',
        });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;

        const { result } = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });
        let stopAction!: Promise<void>;
        act(() => { stopAction = result.current.handleStartStop(); });

        await waitFor(() => expect(speechRuntimeController.stopRecording).toHaveBeenCalledTimes(1));
        expect(pushSpy.mock.calls.some(([event]) => event === 'session_save_latency_measured')).toBe(false);
        expect(result.current.showAnalyticsPrompt).toBe(false);

        await act(async () => {
            resolveStop({ transcript: '', total_words: 0, accuracy: 100, duration: 30 });
            await stopAction;
        });
        expect(result.current.showAnalyticsPrompt).toBe(true);
        const latency = pushSpy.mock.calls.find(([event]) => event === 'session_save_latency_measured');
        expect(latency?.[1]).toMatchObject({
            mode: 'private',
            outcome: 'saved',
            duration_ms: expect.any(Number),
        });
        pushSpy.mockRestore();
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

        it.each(['loading', 'init-failed', 'error'])(
            'BLOCKS start for a not-ready Private model status: %s',
            (status) => {
                expect(renderWithModelStatus(status, 'private', 'READY').current.isButtonDisabled).toBe(true);
            },
        );

        // #1306 — `download-required` USED TO BE IN THE LIST ABOVE, AND THAT WAS THE PRODUCTION DEFECT.
        //
        // It belonged there while the cold control was a setup-only action force-enabled downstream:
        // "start" was genuinely unavailable, and a separate download button was what the user pressed.
        // #1415 made the cold press one activation that downloads AND records, and narrowed MicCard's
        // always-enabled branch to the retry action alone — so this flag became the only input left,
        // and it disabled the sole control that can leave the state. Every first-run account saw
        // "One-time download needed" above an unpressable button; the three-session production proof
        // failed on it twice, identically, before recording a single word.
        it('does NOT block start for download-required — the cold press is what leaves that state', () => {
            expect(renderWithModelStatus('download-required', 'private', 'READY').current.isButtonDisabled).toBe(false);
        });

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
        act(() => { result.current.setMode('private'); });
        // delegated to the single authoritative decision — and it did NOT independently mutate anything
        expect(speechRuntimeController.requestModeChange).toHaveBeenCalledWith('private', expect.objectContaining({ preferredMode: 'private' }));
        expect(speechRuntimeController.updatePolicy).not.toHaveBeenCalled(); // no direct policy write bypassing the gate
        expect(speechRuntimeController.syncForensicState).not.toHaveBeenCalled(); // early-returned before applying
    });

    it('setMode applies (syncForensicState) when the controller accepts', () => {
        vi.mocked(speechRuntimeController.requestModeChange).mockReturnValue({ accepted: true });
        const { result } = renderIt();
        act(() => { result.current.setMode('private'); });
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

    let mockStore: ReturnType<typeof createTestSessionStore>;

    beforeEach(() => {
        vi.clearAllMocks();
        setVisibility('visible');
        // The exact production condition: the store leaves sttMode UNSET (null).
        mockStore = createTestSessionStore(); // sttMode defaults to null
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'u', subscription_status: 'free', email: 'e@e.com' } as UserProfile,
            isVerified: true,
        });
        setReclamationGen(0); // no reclamation has happened yet at mount
        vi.mocked(speechRuntimeController.warmUp).mockResolvedValue(undefined); // reset any prior rejection impl
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

    it('surfaces the Private setup retry UI when the reload FAILS, and does not loop', async () => {
        vi.mocked(speechRuntimeController.warmUp).mockRejectedValueOnce(new Error('reload boom'));
        renderIt();
        vi.mocked(speechRuntimeController.warmUp).mockClear();
        vi.mocked(speechRuntimeController.warmUp).mockRejectedValue(new Error('reload boom'));

        setReclamationGen(1);
        await act(async () => {
            setVisibility('visible');   // triggers the (failing) reload
            await Promise.resolve();    // let the rejection .catch run
        });

        // Exactly one reload attempt (the consumed token prevents auto-looping)…
        expect(speechRuntimeController.warmUp).toHaveBeenCalledTimes(1);
        // …and the failure surfaces the existing Private retry UI instead of being swallowed.
        expect(mockStore.getState().setSTTStatus).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'init-failed' }),
        );

        // A repeat visible event with the SAME token must not retry automatically.
        setVisibility('visible');
        expect(speechRuntimeController.warmUp).toHaveBeenCalledTimes(1);
    });
});

/**
 * #1476 — ONE ACCOUNT, ONE AUTHORIZED ENGINE: what the user's Start actually does with the account-wide lease.
 * The server fence is proven in tests/db/one-active-engine-1476.integration.test.ts; these drive the real hook.
 */
describe('useSessionLifecycle - one account, one engine (#1476)', () => {
    const readyStore = () => {
        const mockStore = createTestSessionStore({ sttMode: 'private', isListening: false, runtimeState: 'READY', elapsedTime: 0, startTime: null });
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        return mockStore;
    };
    const render = () => renderHook(() => useSessionLifecycle(), {
        wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
    });
    const BLOCKED = { action: 'blocked' as const, holderLabel: 'this browser on MacIntel', startedAt: null,
        message: 'A recording is active on this browser on MacIntel. Stop it there, or press Start again to take over here — that stops the recording there, and what it recorded so far is saved.' };

    beforeEach(() => {
        vi.clearAllMocks();
        leaseMock.acquire.mockImplementation(async () => ({ action: 'start' as const, tookOver: false }));
        leaseMock.confirm.mockImplementation(async () => 'held' as const);
        leaseMock.current = null;
        leaseMock.releasedIds = [];
    });

    it('the lease is acquired BEFORE any engine preparation begins', async () => {
        readyStore();
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.acquire).toHaveBeenCalledTimes(1);
        expect(speechRuntimeController.startRecording).toHaveBeenCalled();
        expect(leaseMock.acquire.mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(speechRuntimeController.startRecording).mock.invocationCallOrder[0]);
        expect(leaseMock.heartbeat).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY: another live device BLOCKS the Start with truthful copy — no engine starts, nothing is taken over', async () => {
        const store = readyStore();
        leaseMock.acquire.mockImplementation(async () => BLOCKED);
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(leaseMock.acquire).toHaveBeenCalledWith({ force: false });
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({ type: 'error', message: BLOCKED.message });
    });

    it('a second Start while that notice shows is the explicit take-over (forced), and only then records', async () => {
        readyStore();
        leaseMock.acquire.mockImplementationOnce(async () => BLOCKED);
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.acquire).toHaveBeenLastCalledWith({ force: true });
        expect(speechRuntimeController.startRecording).toHaveBeenCalled();
    });

    it('CASUALTY: an unanswerable lease authority FAILS CLOSED — no Start', async () => {
        const store = readyStore();
        leaseMock.acquire.mockImplementation(async () => ({ action: 'error' as const, reason: 'no_response', message: 'Could not check your other devices. Please try again.' }));
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({ type: 'error', message: 'Could not check your other devices. Please try again.' });
    });

    it('CASUALTY: when another device takes over, this take stops and says so', async () => {
        const store = readyStore();
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        const onRevoked = leaseMock.heartbeat.mock.calls[0]?.[0] as (() => void) | undefined;
        expect(onRevoked, 'a heartbeat was started with a revoke handler').toBeTypeOf('function');
        await act(async () => { onRevoked?.(); });
        expect(speechRuntimeController.stopRecording, 'stops — and saves, like a normal Stop').toHaveBeenCalled();
        // PM directive on dae853fb: the displaced take is PRESERVED (the server accepts its save), never discarded.
        expect(speechRuntimeController.discardUnresolvedRecording).not.toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({
            type: 'info', message: 'This recording stopped because another device took over. What was recorded here is being saved.',
        });
    });

    it('CASUALTY (Codex P1 on dae853fb): unmounting the session page releases the lease, so no device stays blocked', async () => {
        readyStore();
        const { result, unmount } = render();
        await act(async () => { await result.current.handleStartStop(); });
        leaseMock.release.mockClear();
        unmount();
        await vi.waitFor(() => expect(leaseMock.release).toHaveBeenCalled());
    });

    it('CASUALTY (Codex P1 on dae853fb): Start loads the SERVER\'s obligations before any engine work, and an unanswerable server fails closed', async () => {
        const store = readyStore();
        obligationsMock.hydrate.mockImplementationOnce(async () => ({ ok: false, queued: 0, authority: 'server' as const }));
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(obligationsMock.hydrate).toHaveBeenCalled();
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(leaseMock.release, 'the held lease is released').toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({ type: 'error', message: 'Could not check your saved sessions. Please try again.' });
    });

    it('CASUALTY (Codex P1 on 040da46a): the heartbeat starts the moment the lease is held — BEFORE the obligation load', async () => {
        readyStore();
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.heartbeat.mock.invocationCallOrder[0]).toBeLessThan(obligationsMock.hydrate.mock.invocationCallOrder[0]);
    });

    it('CASUALTY (Codex P1 on 040da46a): a take-over that lands while obligations load aborts the Start — no engine is prepared', async () => {
        readyStore();
        obligationsMock.hydrate.mockImplementationOnce(async () => {
            (leaseMock.heartbeat.mock.calls[0]?.[0] as (() => void) | undefined)?.(); // revoked mid-check
            return { ok: true, queued: 0, authority: 'server' as const };
        });
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
    });

    it('CASUALTY (Codex P1 on 040da46a): a server that never answers fails the Start closed after a bounded wait, and releases the lease', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const store = readyStore();
            obligationsMock.hydrate.mockImplementationOnce(() => new Promise(() => undefined));
            const { result } = render();
            let settled = false;
            const start = act(async () => { await result.current.handleStartStop(); settled = true; });
            await vi.advanceTimersByTimeAsync(5_000);
            await start;
            expect(settled).toBe(true);
            expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
            expect(leaseMock.release).toHaveBeenCalled();
            expect(store.getState().setSTTStatus).toHaveBeenCalledWith({ type: 'error', message: 'Checking your saved sessions is taking longer than usual. Press Start again in a moment.' });
        } finally { vi.useRealTimers(); }
    });

    // #1476 Codex P1 on 4ceaccf44 (PM RETURN on 0200e7829): a Start still in its pre-engine checks when the page unmounts
    // is CANCELLED at every await — no engine, no heartbeat left running, no retained lease, no stale status published.
    type Gate = { resolve: () => void };
    const unmountDuring = async (step: 'acquire' | 'hydrate' | 'whenStable' | 'confirm') => {
        const store = readyStore();
        if (step === 'whenStable') store.setState({ runtimeState: 'ENGINE_INITIALIZING' } as never);
        const gate: Gate = { resolve: () => undefined };
        const held = <T,>(value: T) => () => new Promise<T>((resolve) => { gate.resolve = () => resolve(value); });
        if (step === 'acquire') leaseMock.acquire.mockImplementationOnce(held({ action: 'start' as const, tookOver: false }));
        if (step === 'hydrate') obligationsMock.hydrate.mockImplementationOnce(held({ ok: true, queued: 0, authority: 'server' as const }));
        if (step === 'whenStable') vi.mocked(speechRuntimeController.whenStable).mockImplementationOnce(held(undefined));
        if (step === 'confirm') leaseMock.confirm.mockImplementationOnce(held('held' as const));
        const { result, unmount } = render();
        let start: Promise<void> = Promise.resolve();
        await act(async () => { start = result.current.handleStartStop(); await Promise.resolve(); await Promise.resolve(); });
        const statusCallsAtUnmount = vi.mocked(store.getState().setSTTStatus).mock.calls.length;
        unmount();
        await act(async () => { gate.resolve(); await start; await Promise.resolve(); await Promise.resolve(); });
        return { store, statusCallsAtUnmount };
    };

    it.each(['acquire', 'hydrate', 'whenStable', 'confirm'] as const)(
        'CASUALTY (Codex P1 on 4ceaccf44): unmount while the Start awaits %s — no engine, the acquired lease is released, nothing stale is published',
        async (step) => {
            const { store, statusCallsAtUnmount } = await unmountDuring(step);
            expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(leaseMock.current, 'no lease is retained by the cancelled Start').toBeNull());
            expect(leaseMock.releasedIds, 'the acquired lease is released exactly once').toEqual([`lease-${leaseMock.issued}`]);
            expect(vi.mocked(store.getState().setSTTStatus).mock.calls.length, 'no status after unmount').toBe(statusCallsAtUnmount);
            // A Start cancelled before its lease was granted never starts a heartbeat; a later step's heartbeat stops with the release.
            expect(leaseMock.heartbeat).toHaveBeenCalledTimes(step === 'acquire' ? 0 : 1);
        },
    );

    it('CASUALTY (browser journey, exit transition): the person navigates away while the page is STILL MOUNTED (its exit animation) — a late answer starts nothing', async () => {
        const store = readyStore();
        let answer: () => void = () => undefined;
        leaseMock.acquire.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve({ action: 'start' as const, tookOver: false }); }));
        // The unit setup replaces window.location with a plain object (tests/setup.ts), so the route is set directly.
        const loc = window.location as unknown as { pathname: string };
        const original = loc.pathname;
        loc.pathname = '/session';
        const { result } = render();
        let start: Promise<void> = Promise.resolve();
        await act(async () => { start = result.current.handleStartStop(); await Promise.resolve(); await Promise.resolve(); });
        const statusCalls = vi.mocked(store.getState().setSTTStatus).mock.calls.length;
        loc.pathname = '/practice'; // the route changed; this hook has NOT unmounted
        await act(async () => { answer(); await start; });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(leaseMock.current).toBeNull();
        expect(leaseMock.releasedIds).toEqual([`lease-${leaseMock.issued}`]);
        expect(leaseMock.heartbeat, 'no heartbeat for a Start the person left').not.toHaveBeenCalled();
        expect(vi.mocked(store.getState().setSTTStatus).mock.calls.length).toBe(statusCalls);
        loc.pathname = original;
    });

    // Codex P1 on 0200e7829: a Start whose obligation check outlasts its 5 s wait says so truthfully, and when the check
    // later lands the gate and the message are reconciled — the person recovers without reloading.
    const slowStart = async (late: { ok: boolean; queued: number; authority: 'server'; failure?: 'unpersisted' }, queueDebt: boolean) => {
        const store = readyStore();
        let finish: () => void = () => undefined;
        obligationsMock.hydrate.mockImplementationOnce(() => new Promise((resolve) => {
            finish = () => {
                if (queueDebt) expect(enqueueProgressReconcile('sess-late', 'test-user', '2026-09-24T12:00:00.000Z').ok).toBe(true);
                resolve(late);
            };
        }));
        const { result } = render();
        const start = act(async () => { await result.current.handleStartStop(); });
        await vi.advanceTimersByTimeAsync(5_000);
        await start;
        return { store, finish };
    };

    it.each([
        ['succeeds with nothing owed', { ok: true, queued: 0, authority: 'server' as const }, false, { type: 'idle', message: 'Ready to record' }],
        ['fails', { ok: false, queued: 0, authority: 'server' as const }, false, { type: 'error', message: 'Could not check your saved sessions. Please try again.' }],
    ])('CASUALTY (Codex P1 on 0200e7829): a slow obligation check that later %s — truthful copy at the timeout, reconciled when it lands', async (_label, late, queueDebt, finalStatus) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const { store, finish } = await slowStart(late, queueDebt);
            expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
            expect(leaseMock.current, 'the Start\'s lease is released at the timeout').toBeNull();
            expect(store.getState().setSTTStatus).toHaveBeenLastCalledWith({ type: 'error', message: 'Checking your saved sessions is taking longer than usual. Press Start again in a moment.' });
            vi.mocked(store.getState().setProgressGate).mockClear();
            await act(async () => { finish(); await Promise.resolve(); await Promise.resolve(); });
            expect(store.getState().setProgressGate, 'the gate is rebuilt when the late answer lands').toHaveBeenCalled();
            expect(store.getState().setSTTStatus).toHaveBeenLastCalledWith(finalStatus);
        } finally { vi.useRealTimers(); }
    });

    it('CASUALTY (Codex P1 on 0200e7829): a slow check that later FINDS debt publishes a queued gate — the retry the notice promises can run', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const { store, finish } = await slowStart({ ok: true, queued: 1, authority: 'server' }, true);
            await act(async () => { finish(); await Promise.resolve(); await Promise.resolve(); });
            expect(store.getState().setProgressGate).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'sess-late', ownerId: 'test-user', state: 'queued' }));
        } finally { vi.useRealTimers(); localStorage.clear(); }
    });

    it('CONTROL: a late answer after the page went away changes no message', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const store = readyStore();
            let finish: () => void = () => undefined;
            obligationsMock.hydrate.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, queued: 0, authority: 'server' as const }); }));
            const { result, unmount } = render();
            const start = act(async () => { await result.current.handleStartStop(); });
            await vi.advanceTimersByTimeAsync(5_000);
            await start;
            unmount();
            const calls = vi.mocked(store.getState().setSTTStatus).mock.calls.length;
            await act(async () => { finish(); await Promise.resolve(); await Promise.resolve(); });
            expect(vi.mocked(store.getState().setSTTStatus).mock.calls.length).toBe(calls);
        } finally { vi.useRealTimers(); }
    });

    // The engine-level proof (preparation, rejected stop, wedged destroy — real controller and engine) is in
    // services/__tests__/unmountEngineRetirement1476.test.ts. These pin the page's side of the contract.
    it('CASUALTY (Codex P1 on 040da46a / PM pre-push review): unmount releases the lease only AFTER the engine is retired', async () => {
        readyStore();
        let finishRetire: (v: 'terminal') => void = () => undefined;
        vi.mocked(speechRuntimeController.retireEngineForUnmount).mockImplementationOnce(() => new Promise((resolve) => { finishRetire = resolve; }));
        const { unmount } = render();
        leaseMock.release.mockClear();
        unmount();
        await act(async () => { await Promise.resolve(); });
        expect(speechRuntimeController.retireEngineForUnmount).toHaveBeenCalledTimes(1);
        expect(leaseMock.release, 'not while the engine may still be recording, preparing or finalizing').not.toHaveBeenCalled();
        await act(async () => { finishRetire('terminal'); await Promise.resolve(); await Promise.resolve(); });
        await vi.waitFor(() => expect(leaseMock.release).toHaveBeenCalledTimes(1));
    });

    it('Codex P1 on 1414f0c89: a remount that acquires a new lease before the old retirement settles — the new lease is never released', async () => {
        readyStore();
        let finishRetire: (v: 'terminal') => void = () => undefined;
        vi.mocked(speechRuntimeController.retireEngineForUnmount).mockImplementationOnce(() => new Promise((resolve) => { finishRetire = resolve; }));
        leaseMock.current = 'lease-A';
        const { unmount } = render();
        leaseMock.release.mockClear();
        unmount();
        await act(async () => { await Promise.resolve(); });
        leaseMock.current = 'lease-B'; // the remounted page proved shutdown and acquired its own take's lease
        await act(async () => { finishRetire('terminal'); await Promise.resolve(); await Promise.resolve(); });
        expect(leaseMock.release, 'the retiring take must not release the new take\'s lease').not.toHaveBeenCalled();
        leaseMock.current = null;
    });

    it('Codex P1 on 1414f0c89: a take-over during the wait for an in-flight initialization — no startRecording, the Start is refused', async () => {
        const store = readyStore();
        store.setState({ runtimeState: 'ENGINE_INITIALIZING' } as never);
        vi.mocked(speechRuntimeController.whenStable).mockImplementationOnce(async () => {
            (leaseMock.heartbeat.mock.calls[0]?.[0] as (() => void) | undefined)?.(); // another device takes over now
        });
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.whenStable).toHaveBeenCalledTimes(1);
        expect(speechRuntimeController.startRecording, 'no engine starts after the lease was lost').not.toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({
            type: 'error',
            message: 'Recording could not start: another device is recording on this account. Press Start again to take over here.',
        });
    });

    it('Codex P1 on 1414f0c89: ownership is confirmed AFTER the in-flight wait, immediately before startRecording', async () => {
        const store = readyStore();
        store.setState({ runtimeState: 'INITIATING' } as never);
        leaseMock.confirm.mockImplementationOnce(async () => 'revoked' as const); // the server handed the lease away during the wait
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.confirm.mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(speechRuntimeController.whenStable).mock.invocationCallOrder[0]);
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
    });

    it('CASUALTY (PM pre-push review): unconfirmed termination KEEPS the lease and reports it — never presented as cleaned up', async () => {
        const store = readyStore();
        vi.mocked(speechRuntimeController.retireEngineForUnmount).mockImplementationOnce(async () => 'unconfirmed');
        const { unmount } = render();
        leaseMock.release.mockClear();
        unmount();
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(leaseMock.release, 'another device stays blocked while this engine may run').not.toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({
            type: 'error',
            message: "SpeakSharp could not confirm the last recording stopped, so this tab still holds your account's recording. Reload or close this tab to end it, or start on another device and take over.",
        });
    });

    it('CASUALTY (PM RETURN on 040da46a): an obligation load delayed past the 15 s lease window while device B takes the lease — ownership is revalidated and no engine is prepared', async () => {
        const store = readyStore();
        // The heartbeat saw nothing yet (network), but by the time the slow load returns the server has handed the lease
        // to device B. Only the revalidation immediately before engine work can see that.
        obligationsMock.hydrate.mockImplementationOnce(async () => ({ ok: true, queued: 0, authority: 'server' as const }));
        leaseMock.confirm.mockImplementationOnce(async () => 'revoked' as const);
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.confirm).toHaveBeenCalledTimes(1);
        expect(leaseMock.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(obligationsMock.hydrate.mock.invocationCallOrder[0]);
        expect(speechRuntimeController.startRecording, 'device A must not prepare a second engine').not.toHaveBeenCalled();
        // Nothing was recorded here: the copy says the Start did not happen (not "this recording stopped"), and offers
        // the explicit take-over — which the next press performs.
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({
            type: 'error', message: 'Recording could not start: another device is recording on this account. Press Start again to take over here.',
        });
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.acquire).toHaveBeenLastCalledWith({ force: true });
        expect(speechRuntimeController.startRecording).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY (PM RETURN on 54576db9): admission FAILS CLOSED — a lease the server cannot confirm prepares no engine and releases', async () => {
        const store = readyStore();
        leaseMock.confirm.mockImplementationOnce(async () => 'unconfirmed' as const);
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(leaseMock.release).toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({ type: 'error', message: 'Could not check your other devices. Please try again.' });
        // Not a take-over offer: the next press is an ordinary Start.
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.acquire).toHaveBeenLastCalledWith({ force: false });
    });

    it('CONTROL: a confirmed lease proceeds to engine preparation after the revalidation', async () => {
        readyStore();
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.confirm.mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(speechRuntimeController.startRecording).mock.invocationCallOrder[0]);
    });

    it('CASUALTY (PM RETURN on 040da46a): a server obligation this browser could not store keeps Start blocked with a truthful, retryable reason', async () => {
        const store = readyStore();
        obligationsMock.hydrate.mockImplementationOnce(async () => ({ ok: false, queued: 0, authority: 'server' as const, failure: 'unpersisted' as const }));
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(leaseMock.release).toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({
            type: 'error',
            message: 'Your earlier session still needs its Progress saved, and this browser could not store it (storage is full or blocked). Free up space or allow site storage, then press Start again.',
        });
        // Retryable: once storage is available again, the next Start proceeds.
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).toHaveBeenCalled();
    });

    // The engine-level proof (real TranscriptionService: held/rejected termination, a failed engine STOP) is in
    // services/__tests__/unmountEngineRetirement1476.test.ts. These pin the page's side: release only on PROOF.
    const endedTake = async () => {
        const store = readyStore();
        render();
        await act(async () => { store.setState({ runtimeState: 'RECORDING' } as never); });
        leaseMock.release.mockClear();
        return store;
    };

    it('CASUALTY (Codex P1 on c4fd77b2 / PM RETURN): a take that ends — failed, or stopped with an engine that did not stop — keeps the lease until the engine is PROVEN off', async () => {
        for (const endState of ['FAILED', 'READY'] as const) {
            vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
            let prove: (o: 'terminal' | 'unconfirmed') => void = () => undefined;
            vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementationOnce(() => new Promise((resolve) => { prove = resolve; }));
            const store = await endedTake();
            await act(async () => { store.setState({ runtimeState: endState } as never); });
            expect(speechRuntimeController.confirmEngineShutdown, `${endState}: a bounded attempt to prove it`).toHaveBeenCalled();
            expect(leaseMock.release, `${endState}: not before proof`).not.toHaveBeenCalled();
            await act(async () => { prove('terminal'); await Promise.resolve(); });
            expect(leaseMock.release, `${endState}: released once proven`).toHaveBeenCalledTimes(1);
            vi.mocked(speechRuntimeController.confirmEngineShutdown).mockClear();
        }
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(true);
    });

    it('PM RETURN: an engine that cannot be proven off KEEPS the lease and says so', async () => {
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementationOnce(async () => 'unconfirmed');
        const store = await endedTake();
        await act(async () => { store.setState({ runtimeState: 'FAILED' } as never); await Promise.resolve(); });
        expect(leaseMock.release).not.toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({
            type: 'error',
            message: "SpeakSharp could not confirm the last recording stopped, so this tab still holds your account's recording. Reload or close this tab to end it, or start on another device and take over.",
        });
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(true);
    });

    it('PM RETURN: a stale proof for lease A never releases lease B', async () => {
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        let prove: (o: 'terminal' | 'unconfirmed') => void = () => undefined;
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementationOnce(() => new Promise((resolve) => { prove = resolve; }));
        leaseMock.current = 'lease-A';
        const store = await endedTake();
        await act(async () => { store.setState({ runtimeState: 'FAILED' } as never); });
        leaseMock.current = 'lease-B'; // a newer take acquired its own lease before A's engine was proven off
        await act(async () => { prove('terminal'); await Promise.resolve(); });
        expect(leaseMock.release, 'A\'s late proof must not release B').not.toHaveBeenCalled();
        leaseMock.current = null;
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(true);
    });

    it('Codex P1 on 56cc5ad3: a Start that FAILS after engine work began releases the lease only on proof', async () => {
        readyStore();
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        let prove: (o: 'terminal' | 'unconfirmed') => void = () => undefined;
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementation(() => new Promise((resolve) => { prove = resolve; }));
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValueOnce(new Error('placeholder save rejected'));
        const { result } = render();
        // The Start guard proves the prior (none) quickly; make that first call resolve at once.
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValueOnce(true);
        leaseMock.release.mockClear();
        await act(async () => { await result.current.handleStartStop().catch(() => undefined); });
        expect(leaseMock.release, 'not while the failed take\'s engine may run').not.toHaveBeenCalled();
        await act(async () => { prove('terminal'); await Promise.resolve(); await Promise.resolve(); });
        expect(leaseMock.release).toHaveBeenCalledTimes(1);
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(true);
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementation(async () => 'terminal');
    });

    it('Codex P1 on 56cc5ad3: a new Start while the previous engine is UNCONFIRMED is refused and the kept lease is NOT released', async () => {
        const store = readyStore();
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementation(async () => 'unconfirmed');
        const { result } = render();
        leaseMock.release.mockClear();
        leaseMock.acquire.mockClear();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.acquire, 'no acquire — it would release the kept lease first').not.toHaveBeenCalled();
        expect(leaseMock.release).not.toHaveBeenCalled();
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        expect(store.getState().setSTTStatus).toHaveBeenCalledWith({
            type: 'error',
            message: "SpeakSharp could not confirm the last recording stopped, so this tab still holds your account's recording. Reload or close this tab to end it, or start on another device and take over.",
        });
        // Once the previous engine is proven off, the Start proceeds.
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementation(async () => 'terminal');
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.acquire).toHaveBeenCalled();
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(true);
    });

    it('CONTROL: a take that ends normally (RECORDING → STOPPING → IDLE) releases once it is at rest', async () => {
        const store = readyStore();
        render();
        await act(async () => { store.setState({ runtimeState: 'RECORDING' } as never); });
        leaseMock.release.mockClear();
        await act(async () => { store.setState({ runtimeState: 'STOPPING' } as never); });
        expect(leaseMock.release, 'STOPPING is still the take').not.toHaveBeenCalled();
        await act(async () => { store.setState({ runtimeState: 'IDLE' } as never); });
        expect(leaseMock.release).toHaveBeenCalledTimes(1);
    });

    it('CONTROL: server obligations are loaded BEFORE the engine starts, so the controller\'s durable-queue check sees them', async () => {
        readyStore();
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(obligationsMock.hydrate.mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(speechRuntimeController.startRecording).mock.invocationCallOrder[0]);
    });

    it('a Start the controller refuses holds no engine: the lease is released', async () => {
        readyStore();
        vi.mocked(speechRuntimeController.getState).mockReturnValue('READY');
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).toHaveBeenCalled();
        expect(leaseMock.release).toHaveBeenCalled();
    });
});
