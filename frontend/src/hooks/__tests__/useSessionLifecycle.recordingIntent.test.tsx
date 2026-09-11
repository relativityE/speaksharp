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
