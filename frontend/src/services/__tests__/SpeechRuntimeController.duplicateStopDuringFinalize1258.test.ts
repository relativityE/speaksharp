// @vitest-environment jsdom
/**
 * #1258 R1 (PM 6134474736 / 6134479029) — A SECOND STOP THAT ARRIVES WHILE THE FIRST IS STILL FINALIZING.
 *
 * Alpha runs 38298685079 / 38304068207: the review's repeat action was pressed 97 / 87 ms after Stop, while the take was
 * STOPPING, and `handleStartStop` treated it as another Stop. PostHog then shows the take's save failing
 * (STOPPING→FAILED→FAILED_VISIBLE), the queued second Stop running (FAILED_VISIBLE→STOPPING→READY), and the next Start
 * refused. A 2026-10-06 save failure with NO second Stop shows the save failure is not caused by the duplicate.
 *
 * These drive the REAL controller (harness from SpeechRuntimeController.failedStopServiceReuse.test.ts; only the service
 * factory, network and server are stubbed) with the durable completion held open, so the second Stop is issued exactly
 * when Production issued it: while the controller is STOPPING. The single-Stop control fixes what correct looks like.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import type { TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';
import { completeSession, saveSession } from '../../lib/storage';
import { __resetRecordingIntentForTests } from '../recordingIntent';
import { SpeechRuntimeController } from '../SpeechRuntimeController';

type FakeService = {
    isServiceDestroyed: () => boolean;
    updateCallbacks: (callbacks: Partial<TranscriptionServiceOptions>) => void;
};

const factory = vi.hoisted(() => ({
    queue: [] as FakeService[],
    active: null as FakeService | null,
}));

vi.mock('@/services/transcription/TranscriptionService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/transcription/TranscriptionService')>();
    return {
        ...actual,
        // SessionManager's contract: reuse the cached service unless it is destroyed.
        getTranscriptionService: vi.fn((callbacks: Partial<TranscriptionServiceOptions>) => {
            if (factory.active && !factory.active.isServiceDestroyed()) {
                factory.active.updateCallbacks(callbacks);
                return factory.active;
            }
            const next = factory.queue.shift();
            if (!next) throw new Error('test harness: no service queued for this take');
            next.updateCallbacks(callbacks);
            factory.active = next;
            return next;
        }),
    };
});
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn(),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn(),
    updateSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({
    finalizeObjectiveSessionOnSave: vi.fn().mockResolvedValue({ ok: true, coverage: [] }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    })),
}));

type Product = 'open_mic' | 'focus_points';

type PrivateController = {
    state: string;
    service: unknown;
    serviceGeneration: number;
    acceptedAttempt: { recordingId: string; service: unknown } | null;
    recordingProgressMode: { mode: string };
    startRecording: (policy: unknown, words: string[]) => Promise<unknown>;
    stopRecording: () => Promise<unknown>;
    discardUnresolvedRecording: () => Promise<{ outcome: string }>;
};

const POLICY = {
    allowNative: false, allowCloud: false, allowPrivate: true,
    preferredMode: 'private', allowFallback: false, executionIntent: 'test',
};

/**
 * Shaped like the real service after a clean engine stop: READY, not destroyed, strategy kept. It is
 * destroyed — terminal — only once `destroy()` has resolved; `live` is the binding its engine emits through.
 */
const recordingService = (name: string) => {
    const svc = {
    name,
    destroyed: false,
    live: {} as Partial<TranscriptionServiceOptions>,
    isServiceDestroyed: vi.fn(() => svc.destroyed),
    warmUp: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue('private'),
    getStrategy: vi.fn().mockReturnValue(null),
    getState: vi.fn().mockReturnValue('RECORDING'),
    getMetadata: vi.fn().mockReturnValue({
        engineVersion: 'test-engine', modelName: 'test-model', deviceType: 'browser',
    }),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    getStartTime: vi.fn().mockReturnValue(Date.now() - 5_000),
    // The engine stopped and returned its final: the failure that follows is the SAVE, not the engine.
    stopTranscription: vi.fn().mockResolvedValue({
        success: true, transcript: 'Alpha take words.', stats: { total_words: 3, accuracy: 1 },
    }),
    // Terminal only AFTER an asynchronous engine termination, as `TranscriptionService.destroy()` is.
    destroy: vi.fn(async () => { await Promise.resolve(); svc.destroyed = true; }),
    setSessionId: vi.fn(),
    updateCallbacks: vi.fn((callbacks: Partial<TranscriptionServiceOptions>) => { svc.live = callbacks; }),
    fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
    };
    return svc;
};

const BRIEF_A = { projectId: 'project-A', briefId: 'brief-A', points: ['Name the price'] };

const enterProduct = (product: Product, brief: typeof BRIEF_A) => {
    useSessionStore.getState().setActiveObjectiveBrief(product === 'focus_points' ? { ...brief } : null);
};


const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const newController = () => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController;
};



/** Start a take, Stop it with the durable completion held open, optionally Stop again while STOPPING, then settle it. */
const stopWhileFinalizing = async (opts: { saveFails: boolean; secondStop: boolean }) => {
    const c = newController() as PrivateController & Record<string, unknown>;
    c.state = 'READY';
    factory.queue.push(recordingService('A'), recordingService('B'));
    enterProduct('open_mic', BRIEF_A);
    await c.startRecording(POLICY, []);

    let release: (value: unknown) => void = () => undefined;
    vi.mocked(completeSession).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }) as never);
    const first = c.stopRecording().then(() => 'resolved', (e: Error) => e.message);
    await vi.waitFor(() => expect(c.state).toBe('STOPPING'));
    expect(vi.mocked(completeSession), 'the first Stop is holding its durable completion').toHaveBeenCalledTimes(1);

    const second = opts.secondStop ? c.stopRecording().then((v) => (v === null ? 'noop' : 'resolved'), (e: Error) => e.message) : null;
    release(opts.saveFails ? { success: false } : { success: true });
    const firstOutcome = await first;
    const secondOutcome = second ? await second : null;
    await settle();
    const statuses = vi.mocked(completeSession).mock.calls.map(([, args]) => (args as { status?: string }).status);
    return { c, firstOutcome, secondOutcome, statuses };
};

describe('#1258 R1 — a Stop pressed while the take is finalizing', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset().mockResolvedValue({ status: 'saved', session: { id: 'session-A' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    it('CONTROL: a single Stop whose save fails leaves the failure VISIBLE with Retry Save armed', async () => {
        const { c, firstOutcome } = await stopWhileFinalizing({ saveFails: true, secondStop: false });
        expect(firstOutcome).toBe('SESSION_COMPLETION_FAILED');
        expect(c.state).toBe('FAILED_VISIBLE');
        expect(useSessionStore.getState().runtimeState).toBe('FAILED_VISIBLE');
        expect([c.recordingStartedUnresolved, Boolean(c.pendingFullSaveRetry)]).toEqual([true, true]);
    });

    it('CASUALTY: a second Stop during finalization must not hide a failed save (the 38298685079 sequence)', async () => {
        const { c, firstOutcome, secondOutcome } = await stopWhileFinalizing({ saveFails: true, secondStop: true });
        expect(firstOutcome).toBe('SESSION_COMPLETION_FAILED');
        expect(secondOutcome, 'the duplicate Stop does nothing').toBe('noop');
        expect(c.state, 'the failure stays visible, as with a single Stop').toBe('FAILED_VISIBLE');
        expect(useSessionStore.getState().runtimeState).toBe('FAILED_VISIBLE');
        expect([c.recordingStartedUnresolved, Boolean(c.pendingFullSaveRetry)], 'Retry Save stays armed').toEqual([true, true]);
    });

    it('a second Stop during a SUCCESSFUL finalization saves the take exactly once and changes nothing', async () => {
        const { c, firstOutcome, secondOutcome, statuses } = await stopWhileFinalizing({ saveFails: false, secondStop: true });
        expect(firstOutcome).toBe('resolved');
        expect(secondOutcome, 'the duplicate Stop never fails').not.toMatch(/FAILED|Error/);
        expect(statuses, 'one durable completion, no failure marking').toEqual(['completed']);
        expect(vi.mocked(saveSession)).toHaveBeenCalledTimes(1);
        expect(c.state).toBe('READY');
        expect(c.recordingStartedUnresolved).toBe(false);
    });
});
