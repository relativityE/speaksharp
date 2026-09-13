// @vitest-environment jsdom
/**
 * #1421 P1 — `recording_terminated` MUST MEAN THE RECORDING ACTUALLY STOPPED.
 *
 * F16 exists to measure the part of Stop that feels unresponsive: the gap between the user's click and
 * the moment capture really ends. The mark was being made in the `RECORDING -> STOPPING` transition
 * branch — the PRELIMINARY state change, before the controller calls and awaits
 * `service.stopTranscription()`. So it recorded termination at the moment the stop was merely
 * ACCEPTED, and every Stop-to-termination interval was short by the entire real teardown, which is
 * exactly the quantity F16 was added to expose.
 *
 * The two timings are separate concerns and stay separate: `recording_to_stop_intent` still measures
 * from the user's click to the runtime accepting the stop, and belongs in the transition branch.
 * `recording_terminated` belongs after the awaited teardown, because only then is its truth known.
 *
 * These cases pin the ORDERING, not the presence of the mark. A test that only asserted the mark
 * eventually appears passes just as well when it is made too early — which is how this shipped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { PRIV_STT } from '../transcription/sttConstants';
import { reachedStages, __resetCompletionStagesForTests } from '@/services/telemetry/completionStages';
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

const terminated = () => reachedStages().includes('recording_terminated');

describe('#1421 recording_terminated is marked after teardown, not at the transition', () => {
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

        __resetCompletionStagesForTests();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    /** A service whose decode takes a measurable, controllable amount of time. */
    const decodingService = (decodeMs: number): ITranscriptionService => ({
        getMode: vi.fn().mockReturnValue('private'),
        getStartTime: vi.fn().mockReturnValue(Date.now() - 300_000),
        stopTranscription: vi.fn(() => new Promise((resolve) => {
            setTimeout(() => resolve({ transcript: 'a real take with real speech in it' }), decodeMs);
        })),
        destroy: vi.fn().mockResolvedValue(undefined),
        isServiceDestroyed: () => false,
        getState: vi.fn().mockReturnValue('RECORDING'),
        subscribe: vi.fn(() => vi.fn()),
        fsm: { is: vi.fn().mockReturnValue(false) },
    } as unknown as ITranscriptionService);

    it('CASUALTY: not marked while the decode is still running', async () => {
        const DECODE_MS = 4_000;
        (controller as unknown as { service: unknown }).service = decodingService(DECODE_MS);

        const stopPromise = controller.stopRecording().catch((e: unknown) => e);

        // The synchronous stop entry has run: the controller has left RECORDING and latched
        // finalization, which is precisely the state in which the mark used to be made.
        await vi.advanceTimersByTimeAsync(0);
        expect(useSessionStore.getState().isTranscriptFinalizing,
            'genuinely inside finalization — the window where the premature mark happened').toBe(true);
        expect(terminated(),
            'recording has NOT stopped yet: the decode is still running').toBe(false);

        // Still mid-decode, well short of the ceiling.
        await vi.advanceTimersByTimeAsync(DECODE_MS - 1_000);
        expect(terminated(), 'still decoding, still not terminated').toBe(false);

        // The decode returns.
        await vi.advanceTimersByTimeAsync(2_000);
        await stopPromise;
        expect(terminated(), 'NOW the recording has actually stopped').toBe(true);
    });

    it('CONTROL: a teardown that never returns records no termination at all', async () => {
        /**
         * The mark is a claim about reality, so a hang must produce silence rather than a false
         * positive. An absent mark is a readable gap in the chain; a premature one is a wrong number
         * that nothing downstream can detect. Finalization is bounded, so this ends in the existing
         * recovery path — with no termination recorded.
         */
        (controller as unknown as { service: unknown }).service = {
            ...decodingService(1),
            stopTranscription: vi.fn(() => new Promise(() => { /* never settles */ })),
        } as unknown as ITranscriptionService;

        const stopPromise = controller.stopRecording().catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(PRIV_STT.FINALIZE_HARD_TIMEOUT_MS + 2_000);
        await stopPromise;

        expect(terminated(),
            'a decode that never returned cannot have terminated the recording').toBe(false);
    });
});
