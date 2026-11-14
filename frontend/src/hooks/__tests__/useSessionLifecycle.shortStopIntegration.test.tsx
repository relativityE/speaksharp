// @vitest-environment jsdom
/**
 * G5 (#1861, live AHT-03 run 43585559387) — INTEGRATED: the page's Stop of a take under the five-second minimum must
 * not save a completed session.
 *
 * The page measures the take on the live clock and tells the user it is too short. Until the fix it then called the
 * controller's ordinary Stop, and the real controller completed the session. The hook-only tests mock the controller
 * and assert the message, so they could not see it. Here the hook drives the REAL SpeechRuntimeController (only its
 * engine and storage boundaries are mocked) and the persistence boundary is asserted at the five-second edge, plus the
 * external-stop path that must keep saving short takes.
 */
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
vi.mock('@/services/progress/recordProgress', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/progress/recordProgress')>()),
    wireProgressEvaluationOnSave: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/telemetry/fillerMeasurement', () => ({ emitFillerMeasurement: vi.fn() }));

// --- hook dep mocks (mirror useSessionLifecycle.reclamationIntegration.test.tsx: everything but the controller) ---
vi.mock('@/hooks/useProfile', () => ({ useProfile: vi.fn() }));
vi.mock('@/providers/useTranscriptionContext', () => ({ useTranscriptionContext: vi.fn(() => ({ service: { getTranscriptionService: vi.fn() } })) }));
vi.mock('@/providers/TranscriptionProvider', () => ({ TranscriptionProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ session: { access_token: 't' }, user: { id: 'u' } }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: vi.fn() }));
vi.mock('../useUsageLimit', () => ({ useUsageLimit: vi.fn(() => ({ data: { can_start: true, subscription_status: 'free', is_pro: false, streak_count: 0 }, isLoading: false, isError: false, error: null })) }));
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
import { completeSession } from '@/lib/storage';

// Synthetic fixture text: meaningful words, so the existing no-speech guard does NOT apply.
const SPOKEN = 'So um I want to make um three points um about the rollout plan';

type Priv = { state: string; initialized: boolean; isEngineReady: boolean; isEmissionsSafe: boolean; sessionId: string | null; service: unknown };

describe('G5 INTEGRATED — page Stop under the minimum → real controller → no completed session', () => {
    let controller: SpeechRuntimeController;
    let store: ReturnType<typeof createTestSessionStore>;

    /** A recording take that went live `ms` ago, on the page clock and the engine clock alike. */
    const recordingFor = (ms: number) => {
        const startedAt = Date.now() - ms;
        store = createTestSessionStore({ runtimeState: 'RECORDING', isListening: true, startTime: startedAt, elapsedTime: Math.floor(ms / 1000) });
        (useSessionStore as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(store);
        (useSessionStore as unknown as { getState: unknown }).getState = store.getState;
        (useSessionStore as unknown as { setState: unknown }).setState = store.setState;
        store.getState().updateTranscript(SPOKEN, '');
        Object.assign(controller as unknown as Priv, {
            state: 'RECORDING', initialized: true, isEngineReady: true, isEmissionsSafe: true, sessionId: 'test-sess',
            service: {
                getMode: vi.fn().mockReturnValue('private'),
                getStartTime: vi.fn().mockReturnValue(startedAt),
                stopTranscription: vi.fn(async () => ({ transcript: '', stats: { accuracy: 0.95, total_words: 13, filler_words: {} } })),
                destroy: vi.fn().mockResolvedValue(undefined),
                isServiceDestroyed: () => false,
                getState: vi.fn().mockReturnValue('RECORDING'),
                subscribe: vi.fn(() => vi.fn()),
                fsm: { is: vi.fn().mockReturnValue(false) },
            },
        });
        return renderHook(() => useSessionLifecycle(), { wrapper: ({ children }) => <TranscriptionProvider>{children}</TranscriptionProvider> });
    };
    const completions = (status: string) => vi.mocked(completeSession).mock.calls.filter((call) => call[1]?.status === status);
    /** Every status the page was shown during the stop, newest last (later page effects may overwrite the latest). */
    const statusesShown = () => vi.mocked(store.getState().setSTTStatus).mock.calls.map((call) => String(call[0]?.message ?? ''));

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        vi.mocked(useProfile).mockReturnValue({ profile: { id: 'u', subscription_status: 'free', email: 'e@e.com' }, isVerified: true } as never);
        controller = SpeechRuntimeController.getInstance();
    });

    afterEach(() => {
        (controller as unknown as Priv).service = null;
    });

    it.each([
        ['3 s', 3_000, 3],
        ['4.999 s', 4_999, 4],
    ])('a %s take is reported too short AND saved as no completed session', async (_label, ms, shownSeconds) => {
        const { result } = recordingFor(ms);
        await act(async () => { await result.current.handleStartStop(); });

        expect(statusesShown().some((m) => new RegExp(`too short \\(${shownSeconds}s\\)`, 'i').test(m)), 'the user is told the take is too short').toBe(true);
        expect(completions('completed'), 'the user was told the take is too short; nothing may be completed').toHaveLength(0);
        expect(completions('failed'), 'the row created at Start is resolved as failed').toHaveLength(1);
        expect(controller.getState()).toBe('READY');
        expect(store.getState().isTranscriptFinalizing).toBe(false);
        expect(store.getState().sessionSaved).toBe(false);
    });

    it('positive control: a 5 s take is not refused and is completed', async () => {
        const { result } = recordingFor(5_000);
        await act(async () => { await result.current.handleStartStop(); });

        expect(statusesShown().some((m) => /too short/i.test(m)), 'a 5 s take is not refused').toBe(false);
        expect(completions('completed')).toHaveLength(1);
        expect(completions('failed')).toHaveLength(0);
    });

    it('an external stop (a stop reason) still saves a take under the minimum, as before', async () => {
        const { result } = recordingFor(3_000);
        await act(async () => { await result.current.handleStartStop({ stopReason: 'Usage limit reached.' }); });

        expect(completions('completed')).toHaveLength(1);
        expect(completions('failed')).toHaveLength(0);
    });
});
