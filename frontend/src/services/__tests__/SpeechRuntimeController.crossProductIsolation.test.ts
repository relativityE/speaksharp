// @vitest-environment jsdom
/**
 * #1258 — CROSS-PRODUCT TAKE ISOLATION.
 *
 * Open Mic and Focus Points share one controller singleton. A user who finishes a take in one product
 * and starts the next take — in the other product, or again in the same one — must get a CLEAN first
 * take: no previous transcript, chunks, completed-session identity, settled review or Focus coverage,
 * and a progress mode that names the product the new take was started in.
 *
 * And the previous take's engine callbacks must not reach the new take. A callback that arrives late —
 * a final transcript, a status change, an error — from take A after take B has been admitted is
 * DROPPED, not merged into B.
 *
 * The journeys drive the REAL controller through start → stop → start. Only the service factory, the
 * network and the server are stubbed. Each late-callback casualty carries a POSITIVE CONTROL: B's own
 * callback, delivered through B's binding, does reach the store — otherwise "A was dropped" would also
 * pass on a controller that drops everything.
 *
 * Scope: controller isolation only. These tests do not prove the deployed Focus Edit / Retry /
 * Start-a-new-set controls, coaching render, or a real engine; those need the deployed journey.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import type { TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';
import { __resetRecordingIntentForTests } from '../recordingIntent';
import { SpeechRuntimeController } from '../SpeechRuntimeController';

const factory = vi.hoisted(() => ({
    queue: [] as unknown[],
    bound: [] as Array<Partial<TranscriptionServiceOptions>>,
}));

vi.mock('@/services/transcription/TranscriptionService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/transcription/TranscriptionService')>();
    return {
        ...actual,
        getTranscriptionService: vi.fn((callbacks: Partial<TranscriptionServiceOptions>) => {
            factory.bound.push(callbacks);
            const next = factory.queue.shift();
            if (!next) throw new Error('test harness: no service queued for this take');
            return next;
        }),
    };
});
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({
    finalizeObjectiveSessionOnSave: vi.fn().mockResolvedValue({ ok: true, coverage: [] }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    })),
}));

type Product = 'open_mic' | 'focus_points';

type PrivateController = {
    state: string;
    service: unknown;
    serviceGeneration: number;
    acceptedAttempt: { recordingId: string; service: unknown } | null;
    recordingProgressMode: { mode: string; brief?: { briefId: string } };
    startRecording: (policy: unknown, words: string[]) => Promise<unknown>;
    stopRecording: () => Promise<unknown>;
    hardResetAwaited: (reason: string) => Promise<void>;
};

const POLICY = {
    allowNative: false, allowCloud: false, allowPrivate: true,
    preferredMode: 'private', allowFallback: false, executionIntent: 'test',
};

const recordingService = (name: string) => ({
    name,
    isServiceDestroyed: vi.fn().mockReturnValue(false),
    warmUp: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue('private'),
    getStrategy: vi.fn().mockReturnValue(null),
    getState: vi.fn().mockReturnValue('RECORDING'),
    getMetadata: vi.fn().mockReturnValue({
        engineVersion: 'test-engine', modelName: 'test-model', deviceType: 'browser',
    }),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    getStartTime: vi.fn().mockReturnValue(Date.now() - 5_000),
    stopTranscription: vi.fn().mockResolvedValue({ success: true, transcript: '', stats: {} }),
    destroy: vi.fn().mockResolvedValue(undefined),
    setSessionId: vi.fn(),
    updateCallbacks: vi.fn(),
    fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
});

const BRIEF_A = { projectId: 'project-A', briefId: 'brief-A', points: ['Name the price'] };
const BRIEF_B = { projectId: 'project-B', briefId: 'brief-B', points: ['State the guarantee'] };

const enterProduct = (product: Product, brief: typeof BRIEF_A) => {
    useSessionStore.getState().setActiveObjectiveBrief(product === 'focus_points' ? { ...brief } : null);
};

const finalUpdate = (text: string) => ({ transcript: { final: text } });

/** Let queued controller commands and microtask-deferred store writes settle. */
const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const newController = () => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController;
};

/**
 * Run take A in `first`, end it, leave A's after-state on screen, switch to `second`, and admit take B.
 * Returns both bindings so a casualty can replay A's callbacks into B's lifecycle.
 */
const takeThenSwitch = async (first: Product, second: Product) => {
    const c = newController();
    c.state = 'READY';
    const serviceA = recordingService('A');
    const serviceB = recordingService('B');
    factory.queue.push(serviceA, serviceB);

    enterProduct(first, BRIEF_A);
    await c.startRecording(POLICY, []);
    const callbacksA = factory.bound[factory.bound.length - 1];
    expect(c.acceptedAttempt?.service, 'A was admitted on its own service').toBe(serviceA);
    const recordingIdA = c.acceptedAttempt!.recordingId;

    callbacksA.onTranscriptUpdate?.(finalUpdate('Alpha take words.') as never);
    await settle();
    expect(useSessionStore.getState().transcript.transcript, 'A reached the store').toContain('Alpha');

    await c.stopRecording();
    await settle();

    // A saved and its review is on screen when the user moves on.
    const store = useSessionStore.getState();
    store.setCompletedSessionId('session-A');
    store.setFinalizedAnalysis({ sessionId: 'session-A' } as never);
    store.setObjectiveCoverageResult([{ id: 'fp-0', label: 'Name the price', status: 'covered' }] as never);

    enterProduct(second, BRIEF_B);
    await c.startRecording(POLICY, []);
    await settle();
    const callbacksB = factory.bound[factory.bound.length - 1];

    return { c, serviceA, serviceB, callbacksA, callbacksB, recordingIdA };
};

const JOURNEYS: Array<[Product, Product]> = [
    ['open_mic', 'focus_points'],
    ['focus_points', 'open_mic'],
    ['open_mic', 'open_mic'],
    ['focus_points', 'focus_points'],
];

describe('#1258 — a take after a product switch (or a repeat) starts clean and owns its callbacks', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.bound.length = 0;
    });

    describe.each(JOURNEYS)('%s → %s', (first, second) => {
        it('CLEAN FIRST TAKE: B is admitted on a fresh binding with none of A\'s state', async () => {
            const { c, serviceA, serviceB, callbacksA, callbacksB, recordingIdA } = await takeThenSwitch(first, second);

            expect(c.acceptedAttempt, 'B was admitted; this is not a refusal').not.toBeNull();
            expect(c.acceptedAttempt!.service, 'B runs on its own service').toBe(serviceB);
            expect(c.acceptedAttempt!.recordingId, 'B has its own recording identity').not.toBe(recordingIdA);
            expect(callbacksB, 'B received a new callback binding').not.toBe(callbacksA);
            expect(serviceA.destroy, "A's engine was torn down at Stop").toHaveBeenCalled();

            const after = useSessionStore.getState();
            expect({
                transcript: after.transcript.transcript,
                chunks: after.chunks,
                completedSessionId: after.completedSessionId,
                finalizedAnalysis: after.finalizedAnalysis,
                objectiveCoverageResult: after.objectiveCoverageResult,
                finalizedWordCount: after.finalizedWordCount,
                sessionSaved: after.sessionSaved,
            }).toEqual({
                transcript: '',
                chunks: [],
                completedSessionId: null,
                finalizedAnalysis: null,
                objectiveCoverageResult: null,
                finalizedWordCount: null,
                sessionSaved: false,
            });

            // The progress mode is B's product, snapshotted at B's boundary — never A's.
            expect({
                mode: c.recordingProgressMode.mode,
                briefId: c.recordingProgressMode.brief?.briefId ?? null,
            }, "B's product and brief, not A's").toEqual(second === 'focus_points'
                ? { mode: 'focus_points', briefId: 'brief-B' }
                : { mode: 'open_mic', briefId: null });
        });

        it('LATE OLD CALLBACK: A\'s transcript, status and error after B\'s admission do not reach B', async () => {
            const { c, serviceB, callbacksA, callbacksB } = await takeThenSwitch(first, second);
            expect(c.acceptedAttempt?.service).toBe(serviceB);
            const statusBefore = useSessionStore.getState().sttStatus;

            callbacksA.onTranscriptUpdate?.(finalUpdate('Alpha late straggler.') as never);
            callbacksA.onStatusChange?.({ type: 'error', message: 'A late status' } as never);
            callbacksA.onError?.(new Error('A late engine failure'));
            await settle();

            const afterLate = useSessionStore.getState();
            expect(afterLate.transcript.transcript, "A's late final is dropped").toBe('');
            expect(afterLate.chunks, 'no A chunk lands in B').toEqual([]);
            expect(afterLate.sttStatus, "A's late status/error do not overwrite B's").toEqual(statusBefore);
            expect(c.state, 'B is still recording').toBe('RECORDING');
            expect(c.acceptedAttempt?.service, 'B still owns the take').toBe(serviceB);

            // POSITIVE CONTROL — B's own callback is delivered.
            callbacksB.onTranscriptUpdate?.(finalUpdate('Bravo take words.') as never);
            await settle();
            const afterB = useSessionStore.getState().transcript.transcript;
            expect(afterB).toContain('Bravo');
            expect(afterB).not.toContain('Alpha');
        });
    });
});
