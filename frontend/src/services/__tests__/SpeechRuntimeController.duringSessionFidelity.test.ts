// @vitest-environment jsdom
/**
 * #1429 B1/B2 — during-session fidelity at the emission boundary.
 *
 * B1 OPENING WORDS. The user speaks the moment they press Start, before React has attached its
 * subscriber. Callback delivery can legitimately wait; the user's words cannot. An emission that
 * arrives before the handshake must reach the visible store IMMEDIATELY and must still be delivered
 * to the subscriber once it attaches — queued, never dropped.
 *
 * B2 SILENCE CONTINUATION. A thinking pause is not the end of a take. A silent stretch far longer
 * than the interim cadence must not close the emission path, and the words spoken after it must
 * commit exactly as the words before it did.
 *
 * Both assert at the controller's emission boundary. What is finally PERSISTED is a different
 * boundary and is owned by `SpeechRuntimeController.trailingWords.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import type { TranscriptUpdate } from '@/types/transcription';

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

const OPENING_WORDS = 'good morning everyone thanks for joining today';
const AFTER_THE_PAUSE = 'so the second half of my point is about cost';

const finalUpdate = (text: string): TranscriptUpdate => ({ transcript: { final: text, partial: '' } });

describe('#1429 B1 — the opening words survive an unattached subscriber', () => {
    let controller: SpeechRuntimeController;
    let onTranscriptUpdate: ReturnType<typeof vi.fn>;

    const emit = (update: TranscriptUpdate) =>
        (controller as unknown as { handleTranscriptUpdate: (u: TranscriptUpdate) => void })
            .handleTranscriptUpdate(update);

    beforeEach(() => {
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { isEngineReady: boolean }).isEngineReady = true;
        (controller as unknown as { isEmissionsSafe: boolean }).isEmissionsSafe = true;
        (controller as unknown as { emissionQueue: TranscriptUpdate[] }).emissionQueue = [];

        // The subscriber has NOT attached yet — the state the first words arrive in.
        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = false;
        onTranscriptUpdate = vi.fn();
        (controller as unknown as { subscriberCallbacks: Record<string, unknown> }).subscriberCallbacks = {
            onTranscriptUpdate,
        };

        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
    });

    afterEach(() => {
        (controller as unknown as { emissionQueue: TranscriptUpdate[] }).emissionQueue = [];
        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = false;
    });

    it('renders the first words before the subscriber attaches, rather than making them wait', () => {
        emit(finalUpdate(OPENING_WORDS));

        expect(useSessionStore.getState().transcript.transcript).toContain('morning everyone thanks');
    });

    it('CASUALTY: they are queued for the subscriber, not delivered into the void and lost', () => {
        emit(finalUpdate(OPENING_WORDS));

        expect(onTranscriptUpdate).not.toHaveBeenCalled();
        expect((controller as unknown as { emissionQueue: TranscriptUpdate[] }).emissionQueue).toHaveLength(1);

        controller.confirmSubscriberHandshake();

        expect(onTranscriptUpdate).toHaveBeenCalledTimes(1);
        expect(onTranscriptUpdate.mock.calls[0][0]).toMatchObject({ transcript: { final: OPENING_WORDS } });
        expect((controller as unknown as { emissionQueue: TranscriptUpdate[] }).emissionQueue).toHaveLength(0);
    });

    it('CASUALTY: several opening emissions keep their spoken order through the handshake', () => {
        emit(finalUpdate('first sentence of the take'));
        emit(finalUpdate('second sentence of the take'));

        controller.confirmSubscriberHandshake();

        expect(onTranscriptUpdate.mock.calls.map(call => (call[0] as TranscriptUpdate).transcript.final))
            .toEqual(['first sentence of the take', 'second sentence of the take']);
    });
});

describe('#1429 B2 — a thinking pause does not end the take', () => {
    let controller: SpeechRuntimeController;

    const emit = (update: TranscriptUpdate) =>
        (controller as unknown as { handleTranscriptUpdate: (u: TranscriptUpdate) => void })
            .handleTranscriptUpdate(update);

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { isEngineReady: boolean }).isEngineReady = true;
        (controller as unknown as { isEmissionsSafe: boolean }).isEmissionsSafe = true;
        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = true;
        (controller as unknown as { subscriberCallbacks: Record<string, unknown> }).subscriberCallbacks = {
            onTranscriptUpdate: vi.fn(),
        };

        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('commits the words spoken after a long silent gap, keeping the words before it', async () => {
        emit(finalUpdate(OPENING_WORDS));
        expect(useSessionStore.getState().transcript.transcript).toContain('thanks for joining');

        // A pause far longer than any interim cadence, with no emissions at all.
        await vi.advanceTimersByTimeAsync(45_000);
        emit(finalUpdate(AFTER_THE_PAUSE));

        const committed = useSessionStore.getState().transcript.transcript;
        expect(committed).toContain('thanks for joining');
        expect(committed).toContain('second half of my point');
    });

    it('CASUALTY: the silence itself never moves the runtime out of RECORDING', async () => {
        emit(finalUpdate(OPENING_WORDS));

        await vi.advanceTimersByTimeAsync(45_000);

        expect((controller as unknown as { state: string }).state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
    });
});
