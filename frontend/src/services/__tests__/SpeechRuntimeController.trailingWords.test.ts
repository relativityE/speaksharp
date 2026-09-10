// @vitest-environment jsdom
/**
 * #1429 C1 — an immediate Stop preserves the trailing words.
 *
 * The user says a last sentence and presses Stop on top of it. Private is a BATCH engine: the
 * whole-utterance decode lands through `onTranscriptUpdate` while the controller is already
 * finalizing, and `stopTranscription()` itself can resolve with nothing. Stop entry freezes the
 * visible transcript BEFORE that decode arrives, so anything that saves the frozen snapshot silently
 * truncates the take — the user watches their last sentence disappear between the live panel and the
 * saved review.
 *
 * The contract asserted here is at the save-selection boundary, not at the live panel: a final
 * emission that arrives AFTER stop is requested must be in the transcript that is selected for save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { completeSession } from '../../lib/storage';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
    })),
}));

const SPOKEN_BEFORE_STOP = 'I want to make three points about the rollout plan';
const SPOKEN_AS_STOP_IS_PRESSED = 'and that is why we should start next week';


describe('#1429 C1 — an immediate Stop preserves the trailing words', () => {
    let controller: SpeechRuntimeController;

    /**
     * The persistence boundary, not the nearest observable: `completeSession` carries the exact
     * finalized transcript bound at the recording boundary, and a save retry replays this object.
     */
    const persistedTranscript = (): string => {
        const calls = vi.mocked(completeSession).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        return (calls[calls.length - 1][1] as { finalTranscript?: string }).finalTranscript ?? '';
    };

    /** A batch engine that decodes the trailing words WHILE the controller is finalizing. */
    const batchServiceEmittingAtStop = (trailing: string | null, resultTranscript = ''): ITranscriptionService => ({
        getMode: vi.fn().mockReturnValue('private'),
        getStartTime: vi.fn().mockReturnValue(Date.now() - 30_000),
        stopTranscription: vi.fn(async () => {
            if (trailing !== null) {
                (controller as unknown as { handleTranscriptUpdate: (u: unknown) => void })
                    .handleTranscriptUpdate({ transcript: { final: trailing, partial: '' } });
            }
            return { transcript: resultTranscript, stats: { accuracy: 0.95, total_words: 12, filler_words: {} } };
        }),
        destroy: vi.fn().mockResolvedValue(undefined),
        isServiceDestroyed: () => false,
        getState: vi.fn().mockReturnValue('RECORDING'),
        subscribe: vi.fn(() => vi.fn()),
        fsm: { is: vi.fn().mockReturnValue(false) },
    } as unknown as ITranscriptionService);

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
        useSessionStore.getState().updateTranscript(SPOKEN_BEFORE_STOP, '');

        vi.clearAllMocks();
    });

    afterEach(() => {
        (controller as unknown as { service: unknown }).service = null;
    });

    it('keeps the words decoded after Stop was pressed in the transcript selected for save', async () => {
        (controller as unknown as { service: unknown }).service = batchServiceEmittingAtStop(SPOKEN_AS_STOP_IS_PRESSED);

        await controller.stopRecording();

        expect(persistedTranscript()).toContain('start next week');
        expect(persistedTranscript()).toContain('three points');
    });

    it('CASUALTY: saving the stop-entry snapshot would drop them — the frozen text is the shorter one', async () => {
        (controller as unknown as { service: unknown }).service = batchServiceEmittingAtStop(SPOKEN_AS_STOP_IS_PRESSED);

        await controller.stopRecording();

        // The frozen snapshot is taken BEFORE the trailing decode, so it is genuinely a different,
        // shorter string. If the two were equal this test would prove nothing about the ordering.
        const frozen = useSessionStore.getState().frozenTranscriptAtStop ?? '';
        expect(frozen).not.toContain('start next week');
        expect(persistedTranscript().length).toBeGreaterThan(frozen.length);
    });

    it('a service result that already carries the trailing words is used as-is, not duplicated', async () => {
        const whole = `${SPOKEN_BEFORE_STOP} ${SPOKEN_AS_STOP_IS_PRESSED}`;
        (controller as unknown as { service: unknown }).service = batchServiceEmittingAtStop(null, whole);

        await controller.stopRecording();

        expect(persistedTranscript()).toContain('start next week');
        expect(persistedTranscript().match(/start next week/g)).toHaveLength(1);
    });

    it('a take with no trailing decode still saves what was already committed', async () => {
        (controller as unknown as { service: unknown }).service = batchServiceEmittingAtStop(null);

        await controller.stopRecording();

        expect(persistedTranscript()).toContain('three points');
    });
});
