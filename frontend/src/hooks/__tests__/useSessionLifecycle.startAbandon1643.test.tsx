/**
 * #1643 missing-Start (Sam, 2026-11-12) — the real hook settles a Start that ended before it recorded anything as an
 * ABANDONED Start, for exactly the lease that Start acquired, and keeps every other path on the ordinary release.
 * The server half (proof that no take exists, the permanent fence, both race orders) is
 * tests/db/recording-start-abandonment-realpg.test.mjs; the lease module half is recordingLeaseAbandon1643.test.ts.
 */
import { act, renderHook } from '@testing-library/react';
import { useSessionLifecycle } from '../useSessionLifecycle';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TranscriptStats } from '../useSpeechRecognition/types';
import { SttStatus } from '@/types/transcription';

import type { UsageLimitCheck } from '../useUsageLimit';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import type { UserProfile } from '@/types/user';

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
    /** Every settlement that reaches the server: a plain release of the held lease, or a failed Start's abandonment. */
    settled: [] as Array<{ kind: 'release' | 'abandon'; lease: string }>,
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
    // Like recordingLease.releaseTakeLease: a plain release forgets the held lease; a `startFailed` settlement forgets it
    // only when it is that exact lease. Every call is recorded with what it settles.
    releaseTakeLease: async (opts?: { startFailed?: string }) => {
        if (opts?.startFailed !== undefined) {
            if (leaseMock.current === opts.startFailed) leaseMock.current = null;
            leaseMock.settled.push({ kind: 'abandon', lease: opts.startFailed });
        } else {
            const held = leaseMock.current; leaseMock.current = null;
            if (held !== null) leaseMock.settled.push({ kind: 'release', lease: held });
        }
        await leaseMock.release();
    },
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

describe('useSessionLifecycle — a Start that never recorded settles its exact lease as abandoned (#1643)', () => {
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
    const abandoned = (lease: string) => ({ kind: 'abandon' as const, lease });
    const released = (lease: string) => ({ kind: 'release' as const, lease });

    beforeEach(() => {
        vi.clearAllMocks();
        leaseMock.acquire.mockImplementation(async () => ({ action: 'start' as const, tookOver: false }));
        leaseMock.confirm.mockImplementation(async () => 'held' as const);
        leaseMock.current = null;
        leaseMock.issued = 0;
        leaseMock.settled = [];
        obligationsMock.hydrate.mockImplementation(async () => ({ ok: true, queued: 0, authority: 'server' as const }));
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(true);
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementation(async () => 'terminal');
        vi.mocked(speechRuntimeController.retireEngineForUnmount).mockImplementation(async () => 'terminal');
        vi.mocked(useProfile).mockReturnValue({ profile: { id: 'test-user', subscription_status: 'pro' } as UserProfile, isVerified: true });
    });

    it('CASUALTY: admission the server cannot confirm abandons exactly the acquired lease — no engine, no plain release', async () => {
        readyStore();
        leaseMock.confirm.mockImplementationOnce(async () => 'unconfirmed' as const);
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(leaseMock.settled).toEqual([abandoned('lease-1')]));
        expect(leaseMock.current).toBeNull();
    });

    it('CASUALTY: a lease taken over before engine work is no longer held here, but its own identity is still settled', async () => {
        readyStore();
        // Like the real module: a revoked confirmation forgets the held lease before answering.
        leaseMock.confirm.mockImplementationOnce(async () => { leaseMock.current = null; return 'revoked' as const; });
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(leaseMock.settled).toEqual([abandoned('lease-1')]));
    });

    it('CASUALTY: a saved-session check that fails the Start abandons the acquired lease', async () => {
        readyStore();
        obligationsMock.hydrate.mockImplementationOnce(async () => ({ ok: false, queued: 0, authority: 'unavailable' as const }));
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(leaseMock.settled).toEqual([abandoned('lease-1')]));
    });

    it('CASUALTY: leaving while the Start awaits its checks settles that Start\'s lease as abandoned, even after the unmount released it', async () => {
        readyStore();
        let answer: () => void = () => undefined;
        obligationsMock.hydrate.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve({ ok: true, queued: 0, authority: 'server' as const }); }));
        const { result, unmount } = render();
        let start: Promise<void> = Promise.resolve();
        await act(async () => { start = result.current.handleStartStop(); await Promise.resolve(); await Promise.resolve(); });
        unmount();
        await act(async () => { answer(); await start; await Promise.resolve(); await Promise.resolve(); });
        expect(speechRuntimeController.startRecording).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(leaseMock.settled.length).toBeGreaterThan(0));
        expect(leaseMock.settled.filter((s) => s.kind !== 'abandon' || s.lease !== 'lease-1')).toEqual([]);
        expect(leaseMock.current).toBeNull();
    });

    it('CASUALTY: a Start that fails after engine work began abandons its lease only once the engine is proven off', async () => {
        readyStore();
        let prove: (o: 'terminal' | 'unconfirmed') => void = () => undefined;
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementation(() => new Promise((resolve) => { prove = resolve; }));
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValueOnce(new Error('model preparation failed'));
        const { result } = render();
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValueOnce(true); // the prior-engine check at Start
        await act(async () => { await result.current.handleStartStop().catch(() => undefined); });
        expect(leaseMock.settled, 'nothing while the engine may still run').toEqual([]);
        await act(async () => { prove('terminal'); await Promise.resolve(); await Promise.resolve(); });
        await vi.waitFor(() => expect(leaseMock.settled).toEqual([abandoned('lease-1')]));
    });

    it('CONTROL: an engine that cannot be proven off after a failed Start keeps the lease — nothing is abandoned or released', async () => {
        readyStore();
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockImplementation(async () => 'unconfirmed');
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValueOnce(new Error('model preparation failed'));
        const { result } = render();
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValueOnce(true);
        await act(async () => { await result.current.handleStartStop().catch(() => undefined); await Promise.resolve(); await Promise.resolve(); });
        expect(leaseMock.settled).toEqual([]);
        expect(leaseMock.current).toBe('lease-1');
    });

    it('CONTROL: a blocked Start acquired no lease, so nothing is settled', async () => {
        readyStore();
        leaseMock.acquire.mockImplementationOnce(async () => ({ action: 'blocked' as const, holderLabel: 'another browser', startedAt: null, message: 'blocked' }));
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(leaseMock.settled).toEqual([]);
    });

    it('CONTROL: leaving while a take is recording releases the lease the ordinary way, after retirement', async () => {
        const store = readyStore();
        vi.mocked(speechRuntimeController.getState).mockReturnValue('RECORDING' as never);
        const { result, unmount } = render();
        await act(async () => { await result.current.handleStartStop(); });
        expect(speechRuntimeController.startRecording).toHaveBeenCalledTimes(1);
        expect(leaseMock.settled, 'a Start that reached recording settles nothing').toEqual([]);
        await act(async () => { store.setState({ isListening: true, runtimeState: 'RECORDING' } as never); });
        unmount();
        await vi.waitFor(() => expect(leaseMock.settled).toEqual([released('lease-1')]));
        vi.mocked(speechRuntimeController.getState).mockReturnValue('IDLE' as never);
    });

    it('CONTROL: a Start the controller refused after engine work began is settled as a failed Start (server proves no take)', async () => {
        readyStore();
        vi.mocked(speechRuntimeController.getState).mockReturnValue('IDLE' as never);
        const { result } = render();
        await act(async () => { await result.current.handleStartStop(); });
        await vi.waitFor(() => expect(leaseMock.settled).toEqual([abandoned('lease-1')]));
    });
});
