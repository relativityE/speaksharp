// @vitest-environment jsdom
/**
 * G5 (#1880) — the queued Stop race. A Stop without the page's verdict (a lease revoke, a page leave) can be queued just
 * before the user's own short Stop. Before this fix that earlier Stop completed the take, the user's Stop was then a
 * no-op, and the page still said "Session too short" about a take that had been saved.
 *
 * Now the user's verdict is registered when its Stop is CALLED, and an earlier Stop that has not yet reached its save
 * decision honours it; every Stop call learns how the take was actually resolved, so the page reports a discard only
 * when the take was discarded. These tests drive the REAL controller (engine and storage boundaries mocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController, type StopTakeOutcome } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';
import { completeSession } from '../../lib/storage';

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

// Synthetic fixture text: meaningful words, so the no-speech guard does NOT apply and only the verdict can discard.
const BEFORE_STOP = 'So um I want to make um three points um about the rollout plan';

type Priv = {
    state: string; initialized: boolean; isEngineReady: boolean; isEmissionsSafe: boolean; sessionId: string | null; service: unknown;
    pendingDiscardSettlement: unknown; recordingStartedUnresolved: boolean; pendingAttributionRetry?: unknown; pendingFullSaveRetry?: unknown; capturedUserId?: string | null; rehydratedFor?: string | null;
    currentRecordingId: string | null; stopAcceptedForRecordingId: string | null;
    shortStopVerdictRecordingId: string | null; lastStopOutcome: unknown;
};

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
};

describe('G5 (#1880) — a short Stop queued behind an earlier Stop', () => {
    let controller: SpeechRuntimeController;
    const priv = () => controller as unknown as Priv;
    const completions = (status: string) => vi.mocked(completeSession).mock.calls.filter((call) => call[1]?.status === status);

    /** A batch engine started 3 s before Stop whose finalize decode waits on `finalize` when given. */
    const engine = (finalize: Promise<void> | null = null) => {
        const svc = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 3_000),
            stopTranscription: vi.fn(async () => {
                if (finalize) await finalize;
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

    beforeEach(() => {
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        Object.assign(priv(), {
            state: 'RECORDING', initialized: true, isEngineReady: true, isEmissionsSafe: true, sessionId: 'test-sess',
            pendingDiscardSettlement: null, recordingStartedUnresolved: false, capturedUserId: null, rehydratedFor: null,
            currentRecordingId: 'rec-1', stopAcceptedForRecordingId: null, shortStopVerdictRecordingId: null, lastStopOutcome: null,
            pendingAttributionRetry: null, pendingFullSaveRetry: null,
        });
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
        useSessionStore.getState().updateTranscript(BEFORE_STOP, '');
        vi.clearAllMocks();
    });
    afterEach(() => { priv().service = null; });

    it('a short Stop pressed while the earlier Stop is still finalizing discards the take, and both calls see the discard', async () => {
        const finalize = deferred();
        const svc = engine(finalize.promise);
        const outcomes: Record<string, StopTakeOutcome> = {};

        // The earlier Stop carries no verdict (a lease revoke or page leave) and is finalizing when the user stops.
        const earlier = controller.stopRecording({ onTakeOutcome: (o) => { outcomes.earlier = o; } });
        await vi.waitFor(() => expect(svc.stopTranscription).toHaveBeenCalled());
        const userShortStop = controller.stopRecording({ belowMinimumDuration: true, onTakeOutcome: (o) => { outcomes.user = o; } });
        finalize.resolve();
        await Promise.all([earlier, userShortStop]);

        expect(completions('completed'), 'the take the page calls too short is never completed').toHaveLength(0);
        expect(completions('failed')).toHaveLength(1);
        expect(String(completions('failed')[0]?.[1]?.reason)).toMatch(/minimum duration/i);
        expect(outcomes).toEqual({ earlier: 'discarded', user: 'discarded' });
        expect(useSessionStore.getState().sessionSaved).toBe(false);
        expect(controller.getState()).toBe('READY');
    });

    it('a short Stop that arrives after the earlier Stop already decided to save learns the take was completed', async () => {
        const saveHeld = deferred();
        vi.mocked(completeSession).mockImplementation(async (_id, opts) => {
            if (opts?.status === 'completed') await saveHeld.promise;
            return { success: true } as never;
        });
        engine();
        const outcomes: Record<string, StopTakeOutcome> = {};

        const earlier = controller.stopRecording({ onTakeOutcome: (o) => { outcomes.earlier = o; } });
        // The earlier Stop is past its save decision: its completed write is in flight when the user stops.
        await vi.waitFor(() => expect(completions('completed')).toHaveLength(1));
        const userShortStop = controller.stopRecording({ belowMinimumDuration: true, onTakeOutcome: (o) => { outcomes.user = o; } });
        saveHeld.resolve();
        await Promise.all([earlier, userShortStop]);

        expect(completions('failed'), 'a saved take is not then marked failed').toHaveLength(0);
        expect(outcomes, 'the page is told the take was saved, so it does not say too short').toEqual({ earlier: 'completed', user: 'completed' });
        vi.mocked(completeSession).mockImplementation(async () => ({ success: true }) as never);
    });

    it('an unconfirmed discard is reported as unsettled to the queued short Stop, not as discarded', async () => {
        const finalize = deferred();
        const svc = engine(finalize.promise);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        const outcomes: Record<string, StopTakeOutcome> = {};
        const armed: string[] = [];

        const earlier = controller.stopRecording();
        await vi.waitFor(() => expect(svc.stopTranscription).toHaveBeenCalled());
        const userShortStop = controller.stopRecording({
            belowMinimumDuration: true,
            onUnsettledDiscard: (id) => { armed.push(id); },
            onTakeOutcome: (o) => { outcomes.user = o; },
        });
        finalize.resolve();
        await Promise.all([earlier, userShortStop]);

        expect(completions('completed')).toHaveLength(0);
        expect(outcomes.user).toBe('discard_unsettled');
        expect(controller.pendingResolutionKind()).toBe('discard');
        // Codex P2 on 0610880d: the earlier Stop armed the slot, so the user's no-op Stop is told which take it is.
        expect(armed, "the user's Stop learns the take's armed discard session").toEqual(['test-sess']);
    });

    it("a short Stop that arms its own unsettled discard is told once, not twice", async () => {
        engine();
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        const armed: string[] = [];

        await controller.stopRecording({ belowMinimumDuration: true, onUnsettledDiscard: (id) => { armed.push(id); } });

        expect(armed).toEqual(['test-sess']);
        expect(controller.pendingResolutionKind()).toBe('discard');
    });

    it("a settled discard by the earlier Stop does not tell the user's Stop that anything was armed", async () => {
        const finalize = deferred();
        const svc = engine(finalize.promise);
        const armed: string[] = [];

        const earlier = controller.stopRecording();
        await vi.waitFor(() => expect(svc.stopTranscription).toHaveBeenCalled());
        const userShortStop = controller.stopRecording({ belowMinimumDuration: true, onUnsettledDiscard: (id) => { armed.push(id); } });
        finalize.resolve();
        await Promise.all([earlier, userShortStop]);

        expect(armed).toEqual([]);
        expect(controller.pendingResolutionKind()).toBeNull();
    });

    it("a verdict for an earlier take does not discard the next take's ordinary Stop", async () => {
        priv().shortStopVerdictRecordingId = 'rec-0';
        engine();
        const outcomes: Record<string, StopTakeOutcome> = {};
        await controller.stopRecording({ onTakeOutcome: (o) => { outcomes.ordinary = o; } });

        expect(completions('failed')).toHaveLength(0);
        expect(completions('completed')).toHaveLength(1);
        expect(outcomes.ordinary).toBe('completed');
    });

    it('a Stop with nothing recording reports an unknown outcome rather than a discard', async () => {
        priv().state = 'READY';
        priv().currentRecordingId = null;
        const outcomes: Record<string, StopTakeOutcome> = {};
        await controller.stopRecording({ belowMinimumDuration: true, onTakeOutcome: (o) => { outcomes.idle = o; } });

        expect(vi.mocked(completeSession)).not.toHaveBeenCalled();
        expect(outcomes.idle).toBe('unknown');
    });
});
