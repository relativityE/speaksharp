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
import * as Sentry from '@sentry/react';
import { beginJourney, beginRecordingAttempt, currentAttemptId, currentAttemptSeq, currentBootId, currentJourneyId } from '@/services/telemetry/journeyIdentity';

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, withScope: vi.fn(actual.withScope), captureException: vi.fn(actual.captureException) };
});

// Mock ALL hooks used inside useSessionLifecycle
// #1476: the account-wide recording lease. Granted by default so these suites exercise the Start flow beyond it;
// `leaseMock` lets a test script a refusal, a take-over or a revocation.
const leaseMock = vi.hoisted(() => ({
    acquire: vi.fn(async (_opts?: { force?: boolean }): Promise<import('@/services/recordingLeasePolicy').LeaseDecision> => ({ action: 'start', tookOver: false })),
    release: vi.fn(async () => undefined),
    heartbeat: vi.fn((_onRevoked: () => void) => undefined),
    confirm: vi.fn(async (): Promise<'held' | 'revoked' | 'unconfirmed'> => 'held'),
}));
// #1476: the server's per-session Progress obligations, loaded at Start. Answers "nothing owed" by default.
const obligationsMock = vi.hoisted(() => ({
    hydrate: vi.fn(async (_userId: string, _nowIso: string): Promise<{ ok: boolean; queued: number; authority: 'server' | 'unavailable'; failure?: 'unpersisted' }> => ({ ok: true, queued: 0, authority: 'server' })),
}));
vi.mock('@/services/progress/serverProgressObligations', () => ({
    hydrateServerProgressObligations: (userId: string, nowIso: string) => obligationsMock.hydrate(userId, nowIso),
}));
vi.mock('@/services/recordingLease', () => ({
    acquireTakeLease: (opts?: { force?: boolean }) => leaseMock.acquire(opts),
    releaseTakeLease: () => leaseMock.release(),
    startLeaseHeartbeat: (onRevoked: () => void) => leaseMock.heartbeat(onRevoked),
    confirmTakeLease: () => leaseMock.confirm(),
    currentTakeLeaseId: () => null,
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

// Configurable per test: the retention observation reads the sessionHistory CACHE, and whether it reads
// the RIGHT account's entry is a P1 that a client without `getQueriesData` can never exercise.
const { queryCacheEntries } = vi.hoisted(() => ({ queryCacheEntries: { current: null as unknown[][] | null } }));
// The mock HONOURS `type: 'active'`. It did not, which is why the "read the right entry" P1 could not be
// exercised here at all: a double that returns every entry regardless of the filter cannot tell a test
// that the filter is missing from the code. Entries are [key, data] or [key, data, active]; active
// defaults to true so the existing cases keep their meaning.
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({
        invalidateQueries: vi.fn(),
        getQueriesData: queryCacheEntries.current === null
            ? undefined
            : (filters?: { type?: string }) => (queryCacheEntries.current ?? [])
                .filter((row) => (filters?.type === 'active' ? (row[2] ?? true) !== false : true))
                .map((row) => [row[0], row[1]]),
    }),
}));

import { createTestSessionStore } from '../../../tests/unit/factories/storeFactory';
import { __resetStartAttemptsForTests, beginStartAttempt, currentStartAttempt, isRetryCancelled, markRetryCancelled } from '@/services/startAttemptRegistry';

vi.mock('@/stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));
vi.mock('@/services/SpeechRuntimeController', () => ({
    /*
     * #1421 — THE MOCK MUST CARRY THE MODULE'S ERROR CLASSES, NOT ONLY ITS INSTANCE.
     *
     * `handleStartStop` narrows the rejection with
     * `err instanceof StartRefusedFinalizationError || err?.name === '...'`. The class arrived with
     * #1431, so once #1421 integrated `main` this mock no longer provided every export the hook
     * imports, and vitest failed the case before a single assertion ran — a STALE FIXTURE, not a
     * product defect. The hook's own comment anticipates the mocked-module case, which is exactly why
     * the name fallback sits beside the `instanceof`.
     *
     * Defined as a real class so `instanceof` is meaningful here rather than only the name fallback.
     */
    StartRefusedFinalizationError: class StartRefusedFinalizationError extends Error {
        constructor(message?: string) {
            super(message);
            this.name = 'StartRefusedFinalizationError';
        }
    },
    speechRuntimeController: {
        startRecording: vi.fn(),
        retireEngineForUnmount: vi.fn(async (): Promise<'terminal' | 'unconfirmed'> => 'terminal'),
        isEngineTerminal: vi.fn((): boolean => true),
        confirmEngineShutdown: vi.fn(async (): Promise<'terminal' | 'unconfirmed'> => 'terminal'),
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
        queryCacheEntries.current = null;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'test-user', subscription_status: 'free', email: 'test@example.com' } as UserProfile,
            isVerified: true,
        });
        vi.mocked(useUsageLimit).mockReturnValue(mockUsageLimitQuery);
        vi.mocked(speechRuntimeController.startRecording).mockResolvedValue(undefined as never);
    });

    afterEach(() => pushSpy.mockClear());

    it('CASUALTY: an UNOBSERVED history reports null, not zero — through the real stop path', async () => {
        // The emitter and the schema both accept null; what was untested is the CALL SITE. This harness's
        // query client has no `getQueriesData`, which IS the unobserved case, so the retention receipt must
        // say "we did not look" rather than "this user has no saved sessions". Asserting on the emitter
        // alone left `?? 0` in the hook free to reappear — and it did.
        const { result } = mountWith({ runtimeState: 'RECORDING', isListening: true, elapsedTime: 30 });
        await act(async () => { await result.current.handleStartStop(); });
        // The observation is emitted from a resolved promise after the refresh, so let microtasks drain.
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        const retention = pushSpy.mock.calls
            .filter((c) => c[0] === 'retention_observation')
            .map((c) => c[1] as Record<string, unknown>);
        expect(retention.length).toBeGreaterThan(0);
        expect(retention[0].content_free_history_count ?? null).toBeNull();
    });

    it('CASUALTY: the retention receipt reads THIS account\'s cache, not whichever is first', async () => {
        // `usePracticeHistory` keys as ['sessionHistory', user?.id, pagination], and a bare prefix lookup
        // matches EVERY cached account. After an auth-driven switch that skips the explicit signOut path,
        // the previous account's query stays cached — and taking "the first array" hands this user's
        // retention receipt the PREVIOUS person's counts and transcript states. A receipt attributed to
        // the wrong account is worse than a missing one, because it looks like data.
        queryCacheEntries.current = [
            // Another account's cache, deliberately FIRST.
            [['sessionHistory', 'someone-else', {}], [
                { transcript_state: 'available' }, { transcript_state: 'available' }, { transcript_state: 'available' },
            ]],
            // The active account: one saved session.
            [['sessionHistory', 'test-user', {}], [{ transcript_state: 'available' }]],
        ];

        const { result } = mountWith({ runtimeState: 'RECORDING', isListening: true, elapsedTime: 30 });
        await act(async () => { await result.current.handleStartStop(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        const retention = pushSpy.mock.calls
            .filter((c) => c[0] === 'retention_observation')
            .map((c) => c[1] as Record<string, unknown>);
        expect(retention.length).toBeGreaterThan(0);
        // One, from this account — not three, from the stranger's cache that happened to be first.
        expect(retention[0].content_free_history_count).toBe(1);
    });

    it('CASUALTY: the receipt reads the ACTIVE pagination entry, not a stale same-account one', async () => {
        // One account can hold several `sessionHistory` entries at once: a `{limit}` variant left behind by
        // a previous visit to Analytics alongside the Session page's own `{}`. Both match the account, and
        // React Query preserves insertion order — which is visit order, not relevance. The prefix
        // invalidation refetches only ACTIVE queries, so the leftover keeps its pre-save contents, and
        // reading it reports unchanged counts for a save that plainly succeeded.
        queryCacheEntries.current = [
            // Stale, inactive, and deliberately FIRST — exactly what insertion order hands you.
            [['sessionHistory', 'test-user', { limit: 20 }], [
                { transcript_state: 'available' }, { transcript_state: 'available' }, { transcript_state: 'available' },
            ], false],
            // The entry this page is actually reading.
            [['sessionHistory', 'test-user', {}], [{ transcript_state: 'available' }], true],
        ];

        const { result } = mountWith({ runtimeState: 'RECORDING', isListening: true, elapsedTime: 30 });
        await act(async () => { await result.current.handleStartStop(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        const retention = pushSpy.mock.calls
            .filter((c) => c[0] === 'retention_observation')
            .map((c) => c[1] as Record<string, unknown>);
        expect(retention.length).toBeGreaterThan(0);
        // One, from the active entry — not three, from the stale one that happened to be first.
        expect({ count: retention[0].content_free_history_count }).toEqual({ count: 1 });
    });

    it('CASUALTY: two ACTIVE entries for one account report nothing rather than a guess', async () => {
        // If two are active we cannot tell which one this page is reading. Picking either would be a guess
        // presented as an observation — the same failure as reading the stale one, without the excuse.
        queryCacheEntries.current = [
            [['sessionHistory', 'test-user', {}], [{ transcript_state: 'available' }], true],
            [['sessionHistory', 'test-user', { limit: 20 }], [{ transcript_state: 'available' }], true],
        ];

        const { result } = mountWith({ runtimeState: 'RECORDING', isListening: true, elapsedTime: 30 });
        await act(async () => { await result.current.handleStartStop(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        const retention = pushSpy.mock.calls
            .filter((c) => c[0] === 'retention_observation')
            .map((c) => c[1] as Record<string, unknown>);
        expect(retention.length).toBeGreaterThan(0);
        expect(retention[0].content_free_history_count ?? null).toBeNull();
    });

    it('an ACCEPTED start reports its intent BEFORE startRecording is awaited', async () => {
        /**
         * THE START MUST ACTUALLY SUCCEED FOR THIS ORDERING CLAIM TO MEAN ANYTHING.
         *
         * Integrating #1428 added a refused-start early return: if the controller has not reached
         * RECORDING after `startRecording` resolves, the latency timer settles `refused` and the hook
         * returns WITHOUT pushing `session_started` — correctly, since a start that never began is not
         * a started session and reporting one would fabricate it.
         *
         * The controller mock defaults to `IDLE`, so this test was asserting an ordering against a
         * `session_started` that no longer exists (`indexOf` returning -1). Making the mock report
         * RECORDING, as a successful start does, is what the assertion always assumed and never stated.
         */
        vi.mocked(speechRuntimeController.getState).mockReturnValue('RECORDING' as never);
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

    it('#1258 R1: a Stop pressed while the take is already STOPPING is suppressed — no second Stop, no status overwrite', async () => {
        // Runs 38298685079 / 38304068207: the review's repeat action landed 87–97 ms after Stop, during STOPPING. The hook
        // took it as a second Stop, which also reaches the "too short" branch and replaces the status the user sees.
        const { result } = mountWith({ runtimeState: 'STOPPING' });
        const statusBefore = useSessionStore.getState().sttStatus;
        await act(async () => { await result.current.handleStartStop(); });

        expect(intents().map((i) => [i.intent_kind, i.intent_outcome])).toEqual([['stop', 'suppressed_finalizing']]);
        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
        expect(useSessionStore.getState().sttStatus, 'the visible status is left alone').toEqual(statusBefore);
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

    it('captures the failed accepted take in Sentry even if ambient telemetry advances while setup is pending', async () => {
        const tags = new Map<string, string>();
        const scope = { setTag: (key: string, value: string) => tags.set(key, value), setContext: vi.fn() };
        const scopeSpy = vi.mocked(Sentry.withScope).mockImplementation(
            ((callback: (value: unknown) => unknown) => callback(scope)) as typeof Sentry.withScope,
        );
        const capture = vi.mocked(Sentry.captureException).mockReturnValue('synthetic-event-id');
        let rejectStart!: (error: Error) => void;
        vi.mocked(speechRuntimeController.startRecording).mockImplementation(() => new Promise((_, reject) => { rejectStart = reject; }));
        const { result } = mountWith({ runtimeState: 'READY' });
        let pending!: Promise<void>;
        await act(async () => { pending = result.current.handleStartStop(); });
        const expected = { boot_id: currentBootId(), journey_id: currentJourneyId(), attempt_id: currentAttemptId(), attempt_seq: String(currentAttemptSeq()) };
        expect(expected.attempt_id).not.toBeNull();
        beginJourney();
        beginRecordingAttempt();
        expect(currentAttemptId()).not.toBe(expected.attempt_id);
        await act(async () => { rejectStart(new Error('Synthetic engine setup failure')); await pending; });
        expect(Object.fromEntries([...tags].filter(([key]) => key in expected))).toEqual(expected);
        expect(tags.get('surface')).toBe('recording_start');
        expect(capture).toHaveBeenCalledOnce();
        scopeSpy.mockRestore();
        capture.mockRestore();
    });

    it('carries the runtime state the machine was ACTUALLY in at the click', async () => {
        const { result } = mountWith({ runtimeState: 'ENGINE_INITIALIZING', isTranscriptFinalizing: true });
        await act(async () => { await result.current.handleStartStop(); });
        expect(intents()[0].runtime_state_at_intent).toBe('ENGINE_INITIALIZING');
        expect(intents()[0].model_ready).toBe(false);
    });
});

/**
 * #1258 C10 (PM 6207105255 item 1) — THE START ATTEMPT IS THE AUTHORITY, ON THE REAL HOOK. The controller's start is held
 * open (deferred), as a slow warm-up holds it; the presentation wait is cleared underneath it, as the controller's
 * TERMINATED does. Only the hook call actually returning settles the attempt.
 */
describe('#1258 C10 — start-attempt identity through the real hook', () => {
    const mountWith = (storeOverrides: Parameters<typeof createTestSessionStore>[0] = {}) => {
        const mockStore = createTestSessionStore(storeOverrides);
        (useSessionStore as unknown as Mock).mockImplementation(mockStore);
        (useSessionStore as unknown as { getState: typeof mockStore.getState }).getState = mockStore.getState;
        (useSessionStore as unknown as { setState: typeof mockStore.setState }).setState = mockStore.setState;
        return { store: mockStore, ...renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        }) };
    };
    const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(speechRuntimeController.startRecording).mockReset().mockResolvedValue(undefined as never);
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(true);
        vi.mocked(speechRuntimeController.retireEngineForUnmount).mockResolvedValue('terminal');
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockResolvedValue('terminal');
        __resetStartAttemptsForTests();
        delete window.__SS_E2E__;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'test-user', subscription_status: 'free', email: 'test@example.com' } as UserProfile,
            isVerified: true,
        });
        vi.mocked(useUsageLimit).mockReturnValue(mockUsageLimitQuery);
        vi.mocked(speechRuntimeController.getState).mockReturnValue('IDLE' as never);
    });

    it('a still-busy old invocation stays UNSETTLED even after the presentation wait is cleared; it settles only on return', async () => {
        let release: (() => void) | undefined;
        vi.mocked(speechRuntimeController.startRecording).mockImplementation(() => new Promise<void>((r) => { release = r; }) as never);
        const { result, store } = mountWith({ runtimeState: 'READY' });
        let call: Promise<void> | undefined;
        await act(async () => { call = result.current.handleStartStop(); await flush(); });
        const attempt = currentStartAttempt();
        expect(attempt, 'the press registered its attempt').not.toBeNull();
        expect(attempt!.isSettled()).toBe(false);
        act(() => { store.getState().setStartupWaitStartedAt(null); }); // the controller's TERMINATED clears the wait
        expect(attempt!.isSettled(), 'the wait clearing is not the old call returning').toBe(false);
        await act(async () => { release?.(); await call; });
        expect(attempt!.isSettled()).toBe(true);
    });

    it('an OLDER invocation returning never clears a successor attempt\'s wait', async () => {
        let release: (() => void) | undefined;
        vi.mocked(speechRuntimeController.startRecording).mockImplementation(() => new Promise<void>((r) => { release = r; }) as never);
        const { result, store } = mountWith({ runtimeState: 'READY' });
        let call: Promise<void> | undefined;
        await act(async () => { call = result.current.handleStartStop(); await flush(); });
        const successor = beginStartAttempt().attempt; // a newer accepted press owns the page now
        act(() => { store.getState().setStartupWaitStartedAt(424_242); });
        await act(async () => { release?.(); await call; });
        expect(currentStartAttempt()?.id).toBe(successor.id);
        expect(store.getState().startupWaitStartedAt, 'the successor\'s wait survives').toBe(424_242);
    });

    it('the deliberate-cancel quiet path applies ONLY to the attempt it names', async () => {
        const retired = new Error('RECORDING_INTENT_RETIRED:superseded');
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValue(retired as never);
        const { result, store } = mountWith({ runtimeState: 'READY' });
        act(() => { markRetryCancelled('start-attempt-some-other'); });
        await act(async () => { await result.current.handleStartStop(); });
        expect(store.getState().sttStatus.type, 'a marker for another attempt does not quiet this one').toBe('error');
    });

    it('Codex r4291244682: a Try-again cancel that timed out — the late RECORDING_INTENT_RETIRED stays quiet (no failure, no reset) and clears its own marker', async () => {
        let reject: ((e: Error) => void) | undefined;
        vi.mocked(speechRuntimeController.startRecording).mockImplementation(() => new Promise<void>((_r, j) => { reject = j; }) as never);
        const { result, store } = mountWith({ runtimeState: 'READY' });
        let call: Promise<void> | undefined;
        await act(async () => { call = result.current.handleStartStop(); await flush(); });
        const attempt = currentStartAttempt()!;
        // Try again cancelled this attempt; its unwind timed out, so the marker is retained (startupRetry) and the
        // unwind-failed message is on screen.
        act(() => {
            markRetryCancelled(attempt.id);
            store.getState().setSTTStatus({ type: 'error', message: 'unwind-failed' });
        });
        vi.mocked(speechRuntimeController.reset).mockClear();
        await act(async () => { reject?.(new Error('RECORDING_INTENT_RETIRED:superseded')); await call; });
        expect(speechRuntimeController.reset, 'no start_failed reset can reach the controller').not.toHaveBeenCalled();
        expect(store.getState().sttStatus.message, 'the unwind message is not replaced by a start failure').toBe('unwind-failed');
        expect(isRetryCancelled(attempt.id), 'the attempt\'s own settlement clears its mark').toBe(false);
        expect(attempt.isSettled()).toBe(true);
    });

    it('PM 6209560600 remount isolation: an old mount\'s timed-out cancelled Start rejecting late never resets or reports into the NEW mount\'s Start', async () => {
        let rejectA: ((e: Error) => void) | undefined;
        vi.mocked(speechRuntimeController.startRecording)
            .mockImplementationOnce(() => new Promise<void>((_r, j) => { rejectA = j; }) as never)
            .mockImplementationOnce(async () => { useSessionStore.getState().setRuntimeState('RECORDING'); });
        const first = mountWith({ runtimeState: 'READY' });
        let callA: Promise<void> | undefined;
        await act(async () => { callA = first.result.current.handleStartStop(); await flush(); });
        const a = currentStartAttempt()!;
        act(() => { markRetryCancelled(a.id); }); // Try again cancelled A; its unwind timed out, so A keeps its mark
        first.unmount(); // the user leaves and returns to /session: a NEW mount over the singleton controller
        const second = renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });
        await act(async () => { await second.result.current.handleStartStop(); });
        const b = currentStartAttempt()!;
        expect(b.id).not.toBe(a.id);
        const waitB = first.store.getState().startupWaitStartedAt;
        expect(waitB, 'B is waiting for real frames').not.toBeNull();
        vi.mocked(speechRuntimeController.reset).mockClear();
        await act(async () => { rejectA?.(new Error('RECORDING_INTENT_RETIRED:superseded')); await callA; });
        expect(speechRuntimeController.reset, 'A\'s late rejection cannot reset B').not.toHaveBeenCalled();
        expect(first.store.getState().sttStatus.type, 'no start failure is reported into B').not.toBe('error');
        expect(first.store.getState().startupWaitStartedAt, 'B\'s wait survives').toBe(waitB);
        expect(currentStartAttempt()?.id).toBe(b.id);
        expect(isRetryCancelled(a.id), 'A\'s own settlement ended its mark').toBe(false);
    });

    it('Browser PM navigation RED: pending Start then leave is deliberate cancellation without a Try-again marker', async () => {
        let rejectA!: (error: Error) => void;
        vi.mocked(speechRuntimeController.startRecording).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectA = reject; }) as never);
        const first = mountWith({ runtimeState: 'READY' });
        let callA: Promise<void> | undefined;
        await act(async () => { callA = first.result.current.handleStartStop(); await flush(); });
        expect(speechRuntimeController.startRecording).toHaveBeenCalledTimes(1);
        const a = currentStartAttempt()!;
        expect(isRetryCancelled(a.id), 'navigation is not a Try-again cancellation marker').toBe(false);
        first.unmount();
        vi.mocked(speechRuntimeController.reset).mockClear();
        vi.mocked(analyticsBuffer.push).mockClear();
        await act(async () => { rejectA(new Error('RECORDING_INTENT_RETIRED:page-left')); await callA; await flush(); });
        expect(speechRuntimeController.reset, 'a departed attempt cannot reset the shared controller').not.toHaveBeenCalled();
        expect(vi.mocked(analyticsBuffer.push).mock.calls.filter((c) => c[0] === 'recording_start_failed'), 'navigation is not a setup failure').toHaveLength(0);
        expect(first.store.getState().sttStatus.type).not.toBe('error');
    });

    it('Browser PM navigation RED: late retired A cannot reset, report error into, or release the lease of successor B', async () => {
        let rejectA!: (error: Error) => void;
        vi.mocked(speechRuntimeController.startRecording)
            .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectA = reject; }) as never)
            .mockImplementationOnce(async () => { useSessionStore.getState().setRuntimeState('RECORDING'); });
        const first = mountWith({ runtimeState: 'READY' });
        let callA: Promise<void> | undefined;
        await act(async () => { callA = first.result.current.handleStartStop(); await flush(); });
        const a = currentStartAttempt()!;
        first.unmount();
        const second = renderHook(() => useSessionLifecycle(), { wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider> });
        await act(async () => { await second.result.current.handleStartStop(); await flush(); });
        const b = currentStartAttempt()!;
        expect(b.id).not.toBe(a.id);
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockResolvedValue('unconfirmed');
        vi.mocked(speechRuntimeController.reset).mockClear();
        leaseMock.release.mockClear();
        vi.mocked(analyticsBuffer.push).mockClear();
        await act(async () => { rejectA(new Error('RECORDING_INTENT_RETIRED:superseded')); await callA; await flush(); });
        const observed = { resets: vi.mocked(speechRuntimeController.reset).mock.calls.length,
            failures: vi.mocked(analyticsBuffer.push).mock.calls.filter((c) => c[0] === 'recording_start_failed').length,
            releases: leaseMock.release.mock.calls.length, status: first.store.getState().sttStatus.type };
        expect(observed).toEqual({ resets: 0, failures: 0, releases: 0, status: expect.not.stringMatching(/^error$/) });
        expect(currentStartAttempt()?.id).toBe(b.id);
        second.unmount();
    });

    it('Browser PM navigation control: genuine current setup failure remains an error and requests reset', async () => {
        vi.mocked(speechRuntimeController.startRecording).mockRejectedValueOnce(new Error('genuine model initialization failure') as never);
        const live = mountWith({ runtimeState: 'READY' });
        vi.mocked(speechRuntimeController.reset).mockClear();
        await act(async () => { await live.result.current.handleStartStop(); await flush(); });
        expect(live.store.getState().sttStatus.type).toBe('error');
        expect(speechRuntimeController.reset).toHaveBeenCalledWith('start_failed');
    });

    it('Browser PM navigation control: unconfirmed shutdown does not release the account lease', async () => {
        let rejectA!: (error: Error) => void;
        vi.mocked(speechRuntimeController.startRecording).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectA = reject; }) as never);
        const live = mountWith({ runtimeState: 'READY' });
        let callA: Promise<void> | undefined;
        await act(async () => { callA = live.result.current.handleStartStop(); await flush(); });
        expect(speechRuntimeController.startRecording).toHaveBeenCalledTimes(1);
        vi.mocked(speechRuntimeController.isEngineTerminal).mockReturnValue(false);
        vi.mocked(speechRuntimeController.retireEngineForUnmount).mockResolvedValue('unconfirmed');
        vi.mocked(speechRuntimeController.confirmEngineShutdown).mockResolvedValue('unconfirmed');
        leaseMock.release.mockClear();
        live.unmount();
        await act(async () => { rejectA(new Error('RECORDING_INTENT_RETIRED:page-left')); await callA; await flush(); });
        expect(speechRuntimeController.retireEngineForUnmount).toHaveBeenCalled();
        expect(leaseMock.release, 'lack of stop proof must retain the fence').not.toHaveBeenCalled();
    });

    it('PM 6207494433: Start resolves at RECORDING without real frames — the hook SETTLES while the capture wait stays on', async () => {
        // The controller's Start resolves when the FSM reaches RECORDING; real frames have not arrived (captureLive false).
        vi.mocked(speechRuntimeController.startRecording).mockImplementation(async () => {
            useSessionStore.getState().setRuntimeState('RECORDING');
        });
        vi.mocked(speechRuntimeController.getState).mockReturnValue('RECORDING' as never);
        const { result, store } = mountWith({ runtimeState: 'READY', captureLive: false });
        await act(async () => { await result.current.handleStartStop(); });
        const attempt = currentStartAttempt();
        expect(attempt?.isSettled(), 'the hook call returned').toBe(true);
        expect(store.getState().startupWaitStartedAt, 'the capture wait is still on — Try again must stay usable').not.toBeNull();
        expect(store.getState().captureLive).toBe(false);
    });

    it('CI 38852128235 regression: the minimum-duration guard reads the LIVE clock, not a lagging tick — 5.3 s live saves; 3 s live is too short', async () => {
        // The clock is re-based at the live moment; the last 1 Hz tick can still read one second short (4 for 5.3 s).
        const live = mountWith({ runtimeState: 'RECORDING', isListening: true, elapsedTime: 4, startTime: Date.now() - 5_300 });
        await act(async () => { await live.result.current.handleStartStop(); });
        expect(String(live.store.getState().sttStatus.message ?? ''), 'a 5.3 s live take is not refused as too short').not.toMatch(/too short/i);
        live.unmount();

        const short = mountWith({ runtimeState: 'RECORDING', isListening: true, elapsedTime: 4, startTime: Date.now() - 3_000 });
        await act(async () => { await short.result.current.handleStartStop(); });
        expect(String(short.store.getState().sttStatus.message ?? '')).toMatch(/too short \(3s\)/i);
    });

    it('a Start-only call never stops a recording', async () => {
        const { result } = mountWith({ runtimeState: 'RECORDING', isListening: true, elapsedTime: 30 });
        await act(async () => { await result.current.handleStartStop({ startOnly: true }); });
        expect(speechRuntimeController.stopRecording).not.toHaveBeenCalled();
    });
});
