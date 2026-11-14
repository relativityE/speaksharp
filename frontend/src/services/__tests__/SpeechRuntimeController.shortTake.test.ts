// @vitest-environment jsdom
/**
 * G5 (#1861, live AHT-03 run 43585559387) — a take stopped under the minimum duration is DISCARDED, never completed.
 *
 * The page measures the take on the live clock, finds it under the minimum and tells the user it is too short. It
 * then stopped the take with the ordinary Stop, and the real controller, whose only save guard was "no meaningful
 * words", completed the session (`completeSession({ status: 'completed', duration: 3 })`). The page now passes its
 * verdict; these tests drive the REAL controller (engine and storage boundaries mocked) and assert at the
 * persistence boundary that such a take is resolved by discard, with the runtime fully settled afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { completeSession, saveSession } from '../../lib/storage';

vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/services/telemetry/fillerMeasurement', () => ({ emitFillerMeasurement: vi.fn() }));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) } })),
}));

// Synthetic fixture text: meaningful words, so the existing no-speech guard does NOT apply.
const BEFORE_STOP = 'So um I want to make um three points um about the rollout plan';
const DECODED_DURING_FINALIZING = 'and um that is why we should start next week';

type Priv = { state: string; initialized: boolean; isEngineReady: boolean; isEmissionsSafe: boolean; sessionId: string | null; service: unknown };

describe('G5 — a take under the minimum duration is discarded by the real controller', () => {
    let controller: SpeechRuntimeController;
    const priv = () => controller as unknown as Priv;

    /** A batch engine started `secondsAgo` before Stop; `trailing` is decoded during finalizing, after Stop. */
    const engine = (secondsAgo: number, trailing: string | null = null) => {
        const svc = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - secondsAgo * 1000),
            stopTranscription: vi.fn(async () => {
                if (trailing !== null) {
                    (controller as unknown as { handleTranscriptUpdate: (u: unknown) => void })
                        .handleTranscriptUpdate({ transcript: { final: trailing, partial: '' } });
                }
                return { transcript: '', stats: { accuracy: 0.95, total_words: 20, filler_words: {} } };
            }),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        };
        priv().service = svc as unknown as ITranscriptionService;
        return svc;
    };
    const completions = (status: string) => vi.mocked(completeSession).mock.calls.filter((call) => call[1]?.status === status);

    beforeEach(() => {
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        Object.assign(priv(), { state: 'RECORDING', initialized: true, isEngineReady: true, isEmissionsSafe: true, sessionId: 'test-sess' });
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().updateTranscript(BEFORE_STOP, '');
        vi.clearAllMocks();
    });
    afterEach(() => { priv().service = null; });

    it('a 3 s meaningful take stopped as too short is marked failed, never completed, and the runtime settles', async () => {
        const svc = engine(3);
        const result = await controller.stopRecording({ belowMinimumDuration: true });

        expect(completions('completed'), 'no completed session for a take the user was told is too short').toHaveLength(0);
        expect(completions('failed')).toHaveLength(1);
        expect(vi.mocked(completeSession).mock.calls[0][0]).toBe('test-sess');
        expect(String(completions('failed')[0]?.[1]?.reason)).toMatch(/minimum duration/i);
        expect(String(useSessionStore.getState().sttStatus.message ?? ''), 'the page owns the too-short message').not.toMatch(/enough speech/i);
        expect(result, 'the stop reports no saved result').toBeNull();
        // Terminal cleanup: the engine is released and the take is resolved, not left finalizing or locked.
        expect(svc.destroy).toHaveBeenCalled();
        expect(controller.getState()).toBe('READY');
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false);
        expect(useSessionStore.getState().sessionSaved).toBe(false);
    });

    it('words decoded during finalization do not turn a too-short take into a saved one', async () => {
        engine(3, DECODED_DURING_FINALIZING);
        await controller.stopRecording({ belowMinimumDuration: true });

        expect(completions('completed')).toHaveLength(0);
        expect(completions('failed')).toHaveLength(1);
    });

    it('a too-short take with no row yet gets its row at Stop only to mark it failed (settling the lease obligation)', async () => {
        priv().sessionId = null;
        engine(3);
        const result = await controller.stopRecording({ belowMinimumDuration: true });

        // The late create binds the take's lease; marking that row failed is what settles the save obligation.
        expect(vi.mocked(saveSession)).toHaveBeenCalledTimes(1);
        expect(completions('completed')).toHaveLength(0);
        expect(completions('failed')).toHaveLength(1);
        expect(vi.mocked(completeSession).mock.calls[0]?.[0]).toBe('test-sess');
        expect(result).toBeNull();
        expect(controller.getState()).toBe('READY');
        expect(useSessionStore.getState().sessionSaved).toBe(false);
    });

    it('positive control: the same take stopped without the verdict is completed (the harness can see a save)', async () => {
        engine(5);
        await controller.stopRecording();

        const completed = completions('completed');
        expect(completed).toHaveLength(1);
        expect(completed[0]?.[1]?.duration).toBe(5);
        expect(completions('failed')).toHaveLength(0);
    });
});
