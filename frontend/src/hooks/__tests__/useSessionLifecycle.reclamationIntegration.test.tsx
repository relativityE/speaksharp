// @vitest-environment jsdom
// #1258 INTEGRATED proof: unlike the effect test (which hand-mocks the token), this drives the REAL
// SpeechRuntimeController through an ACTUAL five-minute idle reclamation on fake timers, then returns the page
// to visible and asserts the hook issues EXACTLY ONE warm-up — real timer → real reset → real reclamation
// token → foreground → one reload. The controller is NOT mocked; only its heavy leaf deps and the hook's other
// hooks are.
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- controller leaf-dep mocks (so the REAL controller loads + runs in jsdom without real IO) ---
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 's' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
    updateSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u' } } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: { attributed: true }, error: null }) },
    })),
}));
vi.mock('@/services/progress/recordProgress', () => ({ wireProgressEvaluationOnSave: vi.fn().mockResolvedValue(undefined) }));

// --- hook dep mocks (mirror useSessionLifecycle.test.tsx, MINUS the controller mock) ---
vi.mock('@/hooks/useProfile', () => ({ useProfile: vi.fn() }));
vi.mock('@/providers/useTranscriptionContext', () => ({ useTranscriptionContext: vi.fn(() => ({ service: { getTranscriptionService: vi.fn() } })) }));
vi.mock('@/providers/TranscriptionProvider', () => ({ TranscriptionProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ session: { access_token: 't' }, user: { id: 'u' } }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: vi.fn() }));
vi.mock('../useUsageLimit', () => ({ useUsageLimit: vi.fn(() => ({ data: { can_start: true, subscription_status: 'free', is_pro: false, streak_count: 0 }, isLoading: false, isError: false, error: null, status: 'success' })) }));
vi.mock('../useSpeechRecognition', () => ({
    useSpeechRecognition: vi.fn(() => ({
        transcript: { transcript: '', total_words: 0, accuracy: 100, duration: 0 }, chunks: [], interimTranscript: '',
        fillerData: { total: { count: 0, color: '' } }, startListening: vi.fn(), stopListening: vi.fn(), isListening: false,
        isReady: true, isSupported: true, error: null, reset: vi.fn(), pauseMetrics: {}, modelLoadingProgress: null,
        sttStatus: { type: 'ready', message: 'Ready' }, mode: 'private', micWarning: null, micLevel: 0, hasSpeechActivity: false,
    })),
}));
vi.mock('../useVocalAnalysis', () => ({ useVocalAnalysis: () => ({ pauseMetrics: {}, processAudioFrame: vi.fn(), reset: vi.fn() }) }));
vi.mock('../useSessionManager', () => ({ useSessionManager: () => ({ saveSession: vi.fn(async () => ({ session: { id: 's' }, error: null })) }) }));
vi.mock('../useSessionMetrics', () => ({ useSessionMetrics: () => ({ wpm: 0, clarityScore: 0, fillerCount: 0 }) }));
vi.mock('../useStreak', () => ({ useStreak: () => ({ updateStreak: vi.fn(() => ({ isNewDay: false, currentStreak: 1 })) }) }));
vi.mock('../useUserFillerWords', () => ({ useUserFillerWords: () => ({ userFillerWords: [] }) }));
vi.mock('@/constants/subscriptionTiers', () => ({
    isPro: vi.fn((s?: string) => s === 'pro'), isActiveTrialProfile: vi.fn(() => false), hasPaidProEntitlement: vi.fn(() => false),
    getEffectiveSubscriptionStatus: vi.fn((u?: string, p?: { subscription_status?: string } | null) => u ?? p?.subscription_status ?? 'free'),
}));
vi.mock('@/config/env', () => ({ MIN_SESSION_DURATION_SECONDS: 5 }));

import { useSessionLifecycle } from '../useSessionLifecycle';
import { useProfile } from '@/hooks/useProfile';
import { useSessionStore } from '@/stores/useSessionStore';
import { TranscriptionProvider } from '@/providers/TranscriptionProvider';
import { createTestSessionStore } from '../../../tests/unit/factories/storeFactory';
import { SpeechRuntimeController } from '@/services/SpeechRuntimeController';

const IDLE_RECLAMATION_MS = 5 * 60 * 1000;
type Priv = { state: string; isEngineReady: boolean; service: unknown; startIdleTimer: () => void };

const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

describe('#1258 INTEGRATED — real timer → reclamation → token → foreground → one reload', () => {
    let controller: SpeechRuntimeController;
    let priv: Priv;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        setVisibility('visible');
        const store = createTestSessionStore(); // sttMode null (production condition)
        (useSessionStore as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(store);
        (useSessionStore as unknown as { getState: unknown }).getState = store.getState;
        (useSessionStore as unknown as { setState: unknown }).setState = store.setState;
        vi.mocked(useProfile).mockReturnValue({ profile: { id: 'u', subscription_status: 'free', email: 'e@e.com' }, isVerified: true } as never);

        controller = SpeechRuntimeController.getInstance();
        priv = controller as unknown as Priv;
        (controller as unknown as { initialized: boolean }).initialized = true;
        // Stub the heavy teardown/reload so the REAL timer→guard→token path runs without real IO. The token
        // increment itself is REAL (fires in the controller's own `.then` after reset resolves).
        vi.spyOn(controller, 'reset').mockReturnValue(undefined); // reset() is synchronous (void)
        vi.spyOn(controller, 'warmUp').mockResolvedValue(undefined);
        // A ready Private engine.
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'private' } as never;
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        setVisibility('visible');
    });

    it('advances the real token via a background reclamation and reloads exactly once on return', async () => {
        setVisibility('hidden'); // backgrounded before mount

        renderHook(() => useSessionLifecycle(), { wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider> });
        vi.mocked(controller.warmUp).mockClear();
        const genBefore = controller.getIdleReclamationGeneration();

        // Drive the REAL five-minute idle timer to a real reclamation while backgrounded.
        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);
        expect(controller.getIdleReclamationGeneration()).toBe(genBefore + 1); // real token advanced

        // Return to the foreground → exactly one explicit reload, tied to that real reclamation.
        setVisibility('visible');
        expect(controller.warmUp).toHaveBeenCalledTimes(1);
        expect(controller.warmUp).toHaveBeenCalledWith('private');

        // A repeat visible with no new reclamation must not reload again.
        setVisibility('visible');
        expect(controller.warmUp).toHaveBeenCalledTimes(1);
    });
});
