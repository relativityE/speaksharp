import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessionLifecycle } from '../useSessionLifecycle';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
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

// #1120 S1 (review round-2) — DEDICATED operational falsification for the two hook-level P1 threads that the
// pre-S1 suite (useSessionLifecycle.test.tsx) pins to today's behavior and therefore does NOT exercise:
//   • #2  same-render stale-Cloud warm-up prevention — a stored 'cloud' the fail-closed gate denies must never
//         warm the Cloud engine, and the store is coerced to the safe default.
//   • #1/#4 persistent post-identify flag subscription — a session that mounts BEFORE PostHog flags resolve must
//         NOT latch a premature default, and MUST re-latch to the account-targeted default when a LATE
//         onSttFlagsReady callback fires (the AuthProvider identify→reloadFeatureFlags path).
// The flag surface is dynamic here (hoisted mutable state) so each test drives the exact gate/timing under test.
const s1 = vi.hoisted(() => ({
    privatePrimary: false,
    cloudEnabled: true,
    flagsReady: true,
    readyCbs: [] as Array<() => void>,
    unsubCalls: 0,
}));
vi.mock('@/config/sttHierarchyFlags', () => ({
    isPrivatePrimaryEnabled: () => s1.privatePrimary,
    isCloudSttEnabled: () => s1.cloudEnabled,
    isCloudSttGloballyVisible: () => s1.cloudEnabled,
    resolveDefaultSttMode: (p: boolean, c: boolean) => (p && c ? 'private' : 'native'),
    sttFlagsReadyInitial: () => s1.flagsReady,
    onSttFlagsReady: (cb: () => void) => { s1.readyCbs.push(cb); return () => { s1.unsubCalls += 1; }; },
    STT_HIERARCHY_FLAG_KEY: 'stt_private_primary_v1',
    CLOUD_STT_FLAG_KEY: 'cloud_stt_enabled',
}));

const analyticsPush = vi.hoisted(() => vi.fn());
vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: analyticsPush, flush: vi.fn() } }));

const asProUsage = (over: Partial<UsageLimitCheck> = {}) => ({
    data: { ...baseUsageLimit, subscription_status: 'pro', is_pro: true, ...over } as UsageLimitCheck,
    isLoading: false, isError: false, error: null, status: 'success',
}) as unknown as UseQueryResult<UsageLimitCheck, Error>;

const installStore = (init: Parameters<typeof createTestSessionStore>[0]) => {
    const store = createTestSessionStore(init);
    (useSessionStore as unknown as Mock).mockImplementation(store);
    (useSessionStore as unknown as { getState: typeof store.getState }).getState = store.getState;
    (useSessionStore as unknown as { setState: typeof store.setState }).setState = store.setState;
    return store;
};

describe('#1120 S1 — hook-level Cloud fail-closed + late-flag re-latch (operational falsification)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        s1.privatePrimary = false; s1.cloudEnabled = true; s1.flagsReady = true; s1.readyCbs = [];
        delete window.__SS_E2E__;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'test-user', subscription_status: 'pro', email: 'pro@example.com' } as UserProfile,
            isVerified: true,
        });
        vi.mocked(useUsageLimit).mockReturnValue(asProUsage());
    });

    it('#2 a stored Cloud selection the fail-closed gate DENIES never warms Cloud and is coerced to the default', async () => {
        // Pro user, Cloud env gate OFF → canUseCloudStt=false. The SPA store still holds a stale 'cloud'.
        s1.cloudEnabled = false;
        const store = installStore({ sttMode: 'cloud', isListening: false });

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });

        // The store is normalized away from the denied Cloud mode...
        await waitFor(() => {
            expect(store.getState().sttMode).toBe('native'); // private-primary OFF → default is 'native'
        }, { timeout: 2000 });
        // ...and warmUp('cloud') was NEVER invoked — no Cloud policy/engine, no token mint path opened.
        expect(speechRuntimeController.warmUp).not.toHaveBeenCalledWith('cloud');
    });

    it('#2 even with the env gate ON, a Pro user WITHOUT Cloud entitlement never warms Cloud', async () => {
        // canUseCloudStt = isCloudSttEnabled() && isProUser && hasCloudSttEntitlement(=false here).
        s1.cloudEnabled = true;
        const store = installStore({ sttMode: 'cloud', isListening: false });

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });

        await waitFor(() => {
            expect(store.getState().sttMode).toBe('native');
        }, { timeout: 2000 });
        expect(speechRuntimeController.warmUp).not.toHaveBeenCalledWith('cloud');
    });

    it('#1/#4 a session mounting BEFORE flags resolve does not latch; a LATE onSttFlagsReady re-latches to the account default', async () => {
        // Flags NOT ready at mount; store is unset. private-primary will resolve ON only after the late callback.
        s1.flagsReady = false;
        s1.privatePrimary = false;
        const store = installStore({ sttMode: null, isListening: false });

        renderHook(() => useSessionLifecycle(), {
            wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider>,
        });

        // Pre-resolution: the latch effect returns early (no premature default persisted), and nothing is warmed.
        await Promise.resolve();
        expect(store.getState().sttMode).toBeNull();
        expect(speechRuntimeController.warmUp).not.toHaveBeenCalled();
        // The hook actually subscribed for the post-identify assignment (persistent, not one-shot).
        expect(s1.readyCbs.length).toBeGreaterThan(0);

        // The account-targeted cohort arrives (Private-primary ON) and PostHog fires onFeatureFlags → our callback.
        s1.privatePrimary = true;
        act(() => { s1.readyCbs.forEach((cb) => cb()); });

        // Now the default resolves to 'private' (Pro ⇒ canUsePrivateStt) and the still-default session re-latches.
        await waitFor(() => {
            expect(store.getState().sttMode).toBe('private');
        }, { timeout: 2000 });
    });
});

// #1120 S1 (PR #1155) — FALLBACK SAFETY falsifications for the bounded 1.5s flag-readiness fail-safe.
// Timing is exercised with FAKE timers (no sleep-based flake). Covers all six required proofs.
describe('#1120 S1 — flag-readiness fallback safety (fake timers)', () => {
    const wrap = ({ children }: { children: React.ReactNode }) => <TranscriptionProvider>{children}</TranscriptionProvider>;
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        s1.privatePrimary = false; s1.cloudEnabled = true; s1.flagsReady = false; s1.readyCbs = []; s1.unsubCalls = 0;
        delete window.__SS_E2E__;
        vi.mocked(useProfile).mockReturnValue({
            profile: { id: 'test-user', subscription_status: 'pro', email: 'pro@example.com' } as UserProfile,
            isVerified: true,
        });
        vi.mocked(useUsageLimit).mockReturnValue(asProUsage());
    });
    afterEach(() => { vi.useRealTimers(); });

    it('#1/#2 uninitialized/pending flags fall back to the safe rollback default after the bounded timeout — no strand', () => {
        const store = installStore({ sttMode: null, isListening: false });
        renderHook(() => useSessionLifecycle(), { wrapper: wrap });
        // Before the timeout nothing is latched (waiting for flags).
        expect(store.getState().sttMode).toBeNull();
        act(() => { vi.advanceTimersByTime(1600); });
        // Fallback fired → safe resolved default (hierarchy OFF ⇒ 'native'); the session is no longer stranded.
        expect(store.getState().sttMode).toBe('native');
    });

    it('#3 a real ON result arriving while idle + default-owned resolves to Private (before the timeout)', () => {
        const store = installStore({ sttMode: null, isListening: false });
        renderHook(() => useSessionLifecycle(), { wrapper: wrap });
        s1.privatePrimary = true;
        act(() => { s1.readyCbs.forEach((cb) => cb()); });
        expect(store.getState().sttMode).toBe('private');
    });

    it('#4 a late ON result AFTER recording started never switches mode mid-recording', () => {
        const store = installStore({ sttMode: 'native', isListening: true, runtimeState: 'RECORDING' });
        renderHook(() => useSessionLifecycle(), { wrapper: wrap });
        s1.privatePrimary = true;
        act(() => { s1.readyCbs.forEach((cb) => cb()); vi.advanceTimersByTime(1600); });
        expect(store.getState().sttMode).toBe('native'); // unchanged while recording
    });

    it('#5 a persisted (non-default-owned) Browser choice is never overwritten by a late Private-primary result', () => {
        const store = installStore({ sttMode: 'native', isListening: false });
        renderHook(() => useSessionLifecycle(), { wrapper: wrap });
        s1.privatePrimary = true;
        act(() => { s1.readyCbs.forEach((cb) => cb()); vi.advanceTimersByTime(1600); });
        expect(store.getState().sttMode).toBe('native'); // preserved
    });

    it('#6 unmount clears the fallback timeout AND unsubscribes — no post-unmount latch or default telemetry', () => {
        installStore({ sttMode: null, isListening: false });
        const { unmount } = renderHook(() => useSessionLifecycle(), { wrapper: wrap });
        const unsubBefore = s1.unsubCalls;
        unmount();
        expect(s1.unsubCalls).toBe(unsubBefore + 1);
        analyticsPush.mockClear();
        act(() => { vi.advanceTimersByTime(3000); });
        expect(analyticsPush).not.toHaveBeenCalled();
    });

    it('#6 default telemetry is emitted at most once even when the fallback AND a late result both latch', () => {
        installStore({ sttMode: null, isListening: false });
        renderHook(() => useSessionLifecycle(), { wrapper: wrap });
        analyticsPush.mockClear();
        act(() => { vi.advanceTimersByTime(1600); });      // fallback latches the default → telemetry once
        s1.privatePrimary = true;
        act(() => { s1.readyCbs.forEach((cb) => cb()); });  // late result re-latches; must NOT re-emit
        const defaultApplied = analyticsPush.mock.calls.filter((c) => c[0] === 'stt_default_applied');
        expect(defaultApplied.length).toBe(1);
    });
});
