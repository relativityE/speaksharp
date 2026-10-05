// @vitest-environment jsdom
/**
 * #1258 (RWT run 36955422629, PO 2026-10-02) — the saved filler count is FINALIZED like the transcript.
 *
 * The run saved um=3 while its saved transcript held 4. The saved count was the live counter's stop-entry snapshot;
 * the saved transcript is the finalized text. PO: "the filler count needs to account for finalization just like the
 * transcript, before reporting final value." Asserted at the persistence boundary (`completeSession`), with the
 * #1429 C1 batch-engine harness: saved counts always agree with the saved transcript.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { completeSession } from '../../lib/storage';
import { countFillerWords } from '../../utils/fillerWordUtils';

vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
}));
const fillerMeasurements = vi.hoisted(() => [] as Array<{ reportedFillers: number | null; detectorInputFillers: number }>);
vi.mock('@/services/telemetry/fillerMeasurement', () => ({
    emitFillerMeasurement: (input: { reportedFillers: number | null; detectorInputFillers: number }) => { fillerMeasurements.push(input); },
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) } })),
}));

const BEFORE_STOP = 'So um I want to make um three points um about the rollout plan';
const DECODED_DURING_FINALIZING = 'and um that is why we should start next week';

describe('#1258 — the saved filler count is finalized like the transcript', () => {
    let controller: SpeechRuntimeController;
    const saved = () => {
        const calls = vi.mocked(completeSession).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        return calls[calls.length - 1][1] as { finalTranscript?: string; metrics?: { fillerCounts?: Record<string, number> } };
    };
    const umsIn = (text: string | undefined) => (text ?? '').match(/\bum\b/gi)?.length ?? 0;

    /** A batch engine; `trailing` is decoded during finalizing, after the Stop snapshot. */
    const engine = (trailing: string | null): ITranscriptionService => ({
        getMode: vi.fn().mockReturnValue('private'),
        getStartTime: vi.fn().mockReturnValue(Date.now() - 30_000),
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

    it('RED on b435be368: a filler decoded during finalizing is in the saved count (the run\'s 4 vs 3)', async () => {
        pressStopWith(BEFORE_STOP); // 3 um seen live
        (controller as unknown as { service: unknown }).service = engine(DECODED_DURING_FINALIZING);
        await controller.stopRecording();
        const row = saved();
        expect(umsIn(row.finalTranscript)).toBe(4);
        expect(row.metrics?.fillerCounts?.um).toBe(4);
    });

    it('no double count: a trailing filler already shown live (as an interim) is counted once', async () => {
        pressStopWith(`${BEFORE_STOP} ${DECODED_DURING_FINALIZING}`); // the live counter already showed all 4
        (controller as unknown as { service: unknown }).service = engine(DECODED_DURING_FINALIZING);
        await controller.stopRecording();
        expect(saved().metrics?.fillerCounts?.um).toBe(4);
    });

    it('finalized, not live: a filler the live preview showed but the finalized text does not hold is not saved', async () => {
        // The live preview showed 4 um; the finalized transcript holds 3. The saved count reports the finalized text.
        pressStopWith(`${BEFORE_STOP} um`);
        (controller as unknown as { service: unknown }).service = engine(null);
        await controller.stopRecording();
        const row = saved();
        expect(umsIn(row.finalTranscript)).toBe(3);
        expect(row.metrics?.fillerCounts?.um).toBe(3);
    });

    it('a live counter that lagged behind the text cannot under-report the saved value', async () => {
        pressStopWith('So um I want to make three points'); // the live counter had only reached 1
        (controller as unknown as { service: unknown }).service = engine(null);
        await controller.stopRecording();
        expect(saved().metrics?.fillerCounts?.um).toBe(umsIn(saved().finalTranscript));
    });

    it('nothing decoded during finalizing: the saved count equals the finalized transcript', async () => {
        pressStopWith(BEFORE_STOP);
        (controller as unknown as { service: unknown }).service = engine(null);
        await controller.stopRecording();
        expect(saved().metrics?.fillerCounts?.um).toBe(3);
    });

    it('telemetry reports the finalized count the product saved (#1558 Codex P1 r4186339473)', async () => {
        // `filler_measurement.reported_fillers` is "what the product REPORTED to the user and to session_saved".
        // With 3 um at Stop and a 4th decoded during finalizing, the product saves and shows 4. The report must say
        // 4 as well, not the stop-entry snapshot's 3.
        pressStopWith(BEFORE_STOP);
        (controller as unknown as { service: unknown }).service = engine(DECODED_DURING_FINALIZING);
        await controller.stopRecording();
        expect(saved().metrics?.fillerCounts?.um).toBe(4);
        expect(fillerMeasurements).toHaveLength(1);
        expect(fillerMeasurements[0].reportedFillers).toBe(4);
    });

    it('telemetry reports the finalized count when the live preview over-counted', async () => {
        pressStopWith(`${BEFORE_STOP} um`); // live showed 4; the finalized text holds 3
        (controller as unknown as { service: unknown }).service = engine(null);
        await controller.stopRecording();
        expect(saved().metrics?.fillerCounts?.um).toBe(3);
        expect(fillerMeasurements[0].reportedFillers).toBe(3);
    });
});
