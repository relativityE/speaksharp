// @vitest-environment jsdom
/** G5 diagnostic: real controller must not complete a three-second meaningful take. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '@/services/SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '@/hooks/useSpeechRecognition/useTranscriptionService';
import { completeSession } from '@/lib/storage';
import { countFillerWords } from '@/utils/fillerWordUtils';

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
}));
const fillerMeasurements = vi.hoisted(() => [] as Array<{ reportedFillers: number | null; detectorInputFillers: number }>);
vi.mock('@/services/telemetry/fillerMeasurement', () => ({
    emitFillerMeasurement: (input: { reportedFillers: number | null; detectorInputFillers: number }) => { fillerMeasurements.push(input); },
}));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) } })),
}));

const BEFORE_STOP = 'So um I want to make um three points um about the rollout plan';

describe('G5 short-Stop persistence reproduction', () => {
    let controller: SpeechRuntimeController;
    /** A batch engine; `trailing` is decoded during finalizing, after the Stop snapshot. */
    const engine = (trailing: string | null): ITranscriptionService => ({
        getMode: vi.fn().mockReturnValue('private'),
        getStartTime: vi.fn().mockReturnValue(Date.now() - 3_000),
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
    } as unknown as ITranscriptionService);

    /** The live counter as the page holds it the instant Stop is pressed. */
    const pressStopWith = (liveText: string) => {
        useSessionStore.getState().updateFillerData(countFillerWords(liveText));
    };

    beforeEach(() => {
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { isEngineReady: boolean }).isEngineReady = true;
        (controller as unknown as { isEmissionsSafe: boolean }).isEmissionsSafe = true;
        (controller as unknown as { sessionId: string | null }).sessionId = 'test-sess';
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().updateTranscript(BEFORE_STOP, '');
        vi.clearAllMocks();
        fillerMeasurements.length = 0;
    });
    afterEach(() => { (controller as unknown as { service: unknown }).service = null; });

    it('actual controller at 3s must not complete a meaningful take', async () => {
        pressStopWith(BEFORE_STOP);
        (controller as unknown as { service: unknown }).service = engine(null);
        await controller.stopRecording();
        const completions = vi.mocked(completeSession).mock.calls.filter(call => call[1].status === 'completed');
        console.log('G5_COMPLETION', JSON.stringify(completions.map(call => ({status:call[1].status, duration:call[1].duration}))));
        expect(completions).toHaveLength(0);
    });
});
