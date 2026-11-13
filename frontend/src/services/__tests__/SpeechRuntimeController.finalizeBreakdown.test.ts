// @vitest-environment jsdom
/**
 * The Stop finalize breakdown (stop_finalize_wait / prep / decode) is emitted only for the stop that
 * still owns the shared surfaces.
 *
 * `window.__PRIVATE_TIMING__` is page-global and `stage_latency` rows join whatever journey is current,
 * so a stop superseded during `stopTranscription()` (#1431) would otherwise put its rows, or its
 * successor's summary, into the successor's journey. The CONTROL case proves the wiring emits at all,
 * so the CASUALTY's silence is the fence and not a dead call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { emitStageLatency } from '@/services/telemetry/journeyEvents';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
    })),
}));

vi.mock('@/services/telemetry/journeyEvents', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/telemetry/journeyEvents')>()),
    emitStageLatency: vi.fn(),
}));

const FINALIZE_STAGES = ['stop_finalize_wait', 'stop_finalize_prep', 'stop_finalize_decode'];
const breakdownRows = () => vi.mocked(emitStageLatency).mock.calls
    .filter(([stage]) => FINALIZE_STAGES.includes(stage))
    .map(([stage, ms]) => [stage, ms]);

describe('finalize breakdown is bound to the stop that owns the take', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();

        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { isEngineReady: boolean }).isEngineReady = true;
        (controller as unknown as { isEmissionsSafe: boolean }).isEmissionsSafe = true;
        (controller as unknown as { sessionId: string | null }).sessionId = 'test-sess';

        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().updateTranscript('a real take with real speech in it', '');

        delete (window as unknown as { __PRIVATE_TIMING__?: unknown }).__PRIVATE_TIMING__;
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete (window as unknown as { __PRIVATE_TIMING__?: unknown }).__PRIVATE_TIMING__;
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    /**
     * A Private service whose 3s stop publishes its own finalize summary, the way PrivateWhisper does,
     * and optionally lets a successor take over before it returns.
     */
    const privateService = (beforeReturn: () => void = () => undefined): ITranscriptionService => ({
        getMode: vi.fn().mockReturnValue('private'),
        getStartTime: vi.fn().mockReturnValue(Date.now() - 60_000),
        stopTranscription: vi.fn(() => new Promise((resolve) => {
            setTimeout(() => {
                (window as unknown as { __PRIVATE_TIMING__: unknown }).__PRIVATE_TIMING__ = {
                    finalizeWaitMs: 400,
                    finalizePrepMs: 0,
                    finalizeDecodeMs: 2_500,
                    updatedAtMs: performance.now(),
                };
                beforeReturn();
                resolve({ transcript: 'a real take with real speech in it' });
            }, 3_000);
        })),
        destroy: vi.fn().mockResolvedValue(undefined),
        isServiceDestroyed: () => false,
        getState: vi.fn().mockReturnValue('RECORDING'),
        subscribe: vi.fn(() => vi.fn()),
        fsm: { is: vi.fn().mockReturnValue(false) },
    } as unknown as ITranscriptionService);

    it('CONTROL: the owning stop sends its three intervals, measured zero included', async () => {
        (controller as unknown as { service: unknown }).service = privateService();

        const stopPromise = controller.stopRecording().catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(4_000);
        await stopPromise;

        expect(breakdownRows()).toEqual([
            ['stop_finalize_wait', 400], ['stop_finalize_prep', 0], ['stop_finalize_decode', 2_500],
        ]);
    });

    it('CASUALTY: a stop superseded during stopTranscription() sends none', async () => {
        // A reset hands the lifecycle to the next take while this stop is still inside its teardown.
        (controller as unknown as { service: unknown }).service = privateService(() => {
            (controller as unknown as { lifecycleVersion: number }).lifecycleVersion += 1;
        });

        const stopPromise = controller.stopRecording().catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(4_000);
        await stopPromise;

        expect(breakdownRows(), 'a superseded stop must not emit into its successor\'s journey').toEqual([]);
    });
});
