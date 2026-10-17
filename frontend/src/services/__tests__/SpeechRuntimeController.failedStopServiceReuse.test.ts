// @vitest-environment jsdom
/**
 * #1258 — A FAILED STOP MUST NOT HAND ITS SERVICE TO THE NEXT TAKE.
 *
 * Only the normal stop terminal destroys and detaches the service. A Stop whose engine stopped cleanly
 * but whose durable save then failed lands in the stop's failure catch, which publishes FAILED and arms
 * Retry Save — and leaves take A's service attached: not destroyed, its strategy kept, its FSM back in
 * READY. Once the user resolved A (Discard), the next Start found a live, undestroyed service and reused
 * it: no new callback binding, no new service generation. A's callbacks were therefore indistinguishable
 * from B's, and an emission from A's engine landed in B's transcript — in the other product or the same.
 *
 * The engine really is stopped on this path (`stopTranscription` resolved), so the page's prior-engine
 * check before Start finds nothing to retire; the controller is the only place this can be enforced.
 *
 * The journeys drive the REAL controller: Start A → Stop (completion fails) → Discard → Start B. Only
 * the service factory, the network and the server are stubbed — and the factory keeps the real one's
 * contract: like `SessionManager.getOrCreateService`, it hands back its cached service, rebinding the
 * caller's callbacks onto it, until that service is destroyed. An engine emits through whatever callbacks
 * its service currently holds, so "A's engine" below is `serviceA.live`. Each casualty carries a POSITIVE CONTROL — B's own
 * callback is delivered — so "A was dropped" cannot pass on a controller that drops everything.
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
const BRIEF_B = { projectId: 'project-B', briefId: 'brief-B', points: ['State the guarantee'] };

const enterProduct = (product: Product, brief: typeof BRIEF_A) => {
    useSessionStore.getState().setActiveObjectiveBrief(product === 'focus_points' ? { ...brief } : null);
};

const finalUpdate = (text: string) => ({ transcript: { final: text } });

const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const newController = () => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController;
};

/** Take A in `first`; its Stop fails at the durable save; the user discards A; then take B in `second`. */
const failedStopThenStart = async (
    first: Product,
    second: Product,
    arrangeA: (serviceA: ReturnType<typeof recordingService>) => void = () => undefined,
) => {
    const c = newController();
    c.state = 'READY';
    const serviceA = recordingService('A');
    const serviceB = recordingService('B');
    arrangeA(serviceA);
    factory.queue.push(serviceA, serviceB);

    enterProduct(first, BRIEF_A);
    await c.startRecording(POLICY, []);
    const callbacksA = serviceA.live;
    expect(c.acceptedAttempt?.service, 'A was admitted on its own service').toBe(serviceA);

    vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
    await expect(c.stopRecording(), "A's Stop fails at the durable save").rejects.toThrow('SESSION_COMPLETION_FAILED');
    await settle();
    expect(serviceA.stopTranscription, "A's engine stopped before the save failed").toHaveBeenCalled();
    expect(await c.discardUnresolvedRecording(), 'the user resolves A by discarding it')
        .toEqual(expect.objectContaining({ outcome: 'discarded' }));

    enterProduct(second, BRIEF_B);
    const startB = c.startRecording(POLICY, []);
    const startBOutcome = await startB.then(() => 'resolved', (e: Error) => e.message);
    await settle();
    const callbacksB = serviceB.live;

    return { startBOutcome, c, serviceA, serviceB, callbacksA, callbacksB };
};

const JOURNEYS: Array<[Product, Product]> = [
    ['open_mic', 'focus_points'],
    ['focus_points', 'open_mic'],
    ['open_mic', 'open_mic'],
    ['focus_points', 'focus_points'],
];

describe('#1258 — after a Stop whose save failed, the next take gets its own service', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset()
            .mockResolvedValueOnce({ status: 'saved', session: { id: 'session-A' } } as never)
            .mockResolvedValueOnce({ status: 'saved', session: { id: 'session-B' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    describe.each(JOURNEYS)('%s → %s', (first, second) => {
        it("B is admitted on a NEW service and binding, and A's service is retired", async () => {
            const { startBOutcome, c, serviceA, serviceB, callbacksA, callbacksB } = await failedStopThenStart(first, second);

            expect(startBOutcome, 'B started').toBe('resolved');
            expect(c.state, 'B is recording; the failed take did not block it').toBe('RECORDING');
            expect(c.acceptedAttempt?.service, "B does not run on A's service").toBe(serviceB);
            expect(callbacksB, 'B received a new callback binding').not.toBe(callbacksA);
            expect(serviceA.live, "B's binding was not installed on A's service").toBe(callbacksA);
            expect(serviceA.destroy, "A's service was destroyed, not left holding its strategy and microphone")
                .toHaveBeenCalled();
            expect(c.recordingProgressMode.mode, "B's product").toBe(second);
        });

        it("an emission from A's engine after B's admission does not reach B", async () => {
            const { c, serviceA, serviceB, callbacksB } = await failedStopThenStart(first, second);
            expect(c.acceptedAttempt?.service).toBe(serviceB);

            // A's engine emits through whatever its service now holds.
            serviceA.live.onTranscriptUpdate?.(finalUpdate('Alpha late straggler.') as never);
            await settle();
            expect(useSessionStore.getState().transcript.transcript, "A's late final is dropped").toBe('');

            // POSITIVE CONTROL — B's own engine is delivered.
            callbacksB.onTranscriptUpdate?.(finalUpdate('Bravo take words.') as never);
            await settle();
            const afterB = useSessionStore.getState().transcript.transcript;
            expect(afterB).toContain('Bravo');
            expect(afterB).not.toContain('Alpha');
        });
    });

    it("a previous service that cannot be retired refuses the next Start instead of running B on it", async () => {
        const { startBOutcome, c, serviceA, serviceB } = await failedStopThenStart('open_mic', 'focus_points', (a) => {
            a.destroy.mockImplementation(async () => { throw new Error('worker did not acknowledge'); });
        });

        expect(startBOutcome, 'B is refused with the real cause').toBe('PREVIOUS_TAKE_SERVICE_NOT_RETIRED');
        expect(c.acceptedAttempt, 'no take was admitted').toBeNull();
        expect(serviceB.startTranscription, 'no engine started for B').not.toHaveBeenCalled();
        expect(serviceA.startTranscription, "A's service was not started again").toHaveBeenCalledTimes(1);
    });
});

/**
 * #1258 — A RETIREMENT THAT COMPLETES AFTER A NEWER OWNER TOOK OVER.
 *
 * B's Start suspends while A's service terminates. Before that destruction completes, either a hard reset
 * (navigation, sign-out) cuts the lifecycle, or the user presses Start again. When A finally terminates, the
 * suspended Start must not resume as if it still owned the lifecycle, and the newer owner must neither run
 * on A's dying service nor hear A's engine.
 *
 * A's `destroy()` is held open here; like the real `TranscriptionService.destroy()` it is idempotent — a
 * second caller joins the same termination — and the service is terminal only once it resolves.
 */
const holdRetirement = (serviceA: ReturnType<typeof recordingService>) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let terminating: Promise<void> | null = null;
    serviceA.destroy.mockImplementation(() => {
        terminating ??= gate.then(() => { serviceA.destroyed = true; });
        return terminating;
    });
    return () => release();
};

/** Every channel A's engine can still speak through after it was superseded. */
const emitFromA = (callbacks: Partial<TranscriptionServiceOptions>) => {
    callbacks.onTranscriptUpdate?.(finalUpdate('Alpha late straggler.') as never);
    callbacks.onHistoryUpdate?.([{ text: 'Alpha history line.', isFinal: true }] as never);
    callbacks.onStatusChange?.({ type: 'error', message: 'Alpha engine status' } as never);
};

const outcomeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => e.message);

/** A failed and was discarded; B's Start is now suspended in A's (held) retirement. */
const suspendedInRetirement = async (first: Product, second: Product) => {
    const c = newController();
    c.state = 'READY';
    const serviceA = recordingService('A');
    const serviceB = recordingService('B');
    const releaseA = holdRetirement(serviceA);
    factory.queue.push(serviceA, serviceB);

    enterProduct(first, BRIEF_A);
    await c.startRecording(POLICY, []);
    vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
    await expect(c.stopRecording()).rejects.toThrow('SESSION_COMPLETION_FAILED');
    await settle();
    expect(await c.discardUnresolvedRecording()).toEqual(expect.objectContaining({ outcome: 'discarded' }));

    enterProduct(second, BRIEF_B);
    const staleStart = outcomeOf(c.startRecording(POLICY, []));
    await settle();
    expect(serviceA.destroy, "B's Start is waiting on A's termination").toHaveBeenCalled();
    expect(serviceA.destroyed, 'A has not terminated yet').toBe(false);

    // Whoever the factory hands a service to next: was the selection still locked at that moment?
    const lockedWhenBHandedOut: boolean[] = [];
    const bind = serviceB.updateCallbacks.getMockImplementation()!;
    serviceB.updateCallbacks.mockImplementation((callbacks) => {
        lockedWhenBHandedOut.push((c as unknown as SpeechRuntimeController).isEngineSelectionLocked());
        bind(callbacks);
    });

    return { c, serviceA, serviceB, releaseA, staleStart, lockedWhenBHandedOut };
};

describe('#1258 — a retirement superseded before it completes', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset()
            .mockResolvedValueOnce({ status: 'saved', session: { id: 'session-A' } } as never)
            .mockResolvedValueOnce({ status: 'saved', session: { id: 'session-C' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    describe.each(JOURNEYS)('%s → %s', (first, second) => {
        it('a hard reset during the retirement: the suspended Start never admits, and A reaches no one', async () => {
            const { c, serviceA, serviceB, releaseA, staleStart } = await suspendedInRetirement(first, second);

            (c as unknown as SpeechRuntimeController).reset('navigation');
            const liveAtReset = serviceA.live;
            releaseA();
            await settle();

            expect(await staleStart, 'the superseded Start reports that it did not record').not.toBe('resolved');
            expect(c.acceptedAttempt, 'nothing was admitted').toBeNull();
            expect(c.state, 'the suspended Start did not take the lifecycle back').not.toBe('RECORDING');
            expect(serviceB.startTranscription, 'no engine started for the superseded Start').not.toHaveBeenCalled();
            expect(serviceA.startTranscription, "A's service was never started again").toHaveBeenCalledTimes(1);
            expect((c as unknown as SpeechRuntimeController).isEngineSelectionLocked(),
                'the superseded Start left no lock behind').toBe(false);

            emitFromA(liveAtReset);
            emitFromA(serviceA.live);
            await settle();
            expect(useSessionStore.getState().transcript.transcript, "A's emissions are dropped").toBe('');
        });

        it('a reset, then a NEW Start while A is still terminating: the new take waits for its own service', async () => {
            const { c, serviceA, serviceB, releaseA, staleStart, lockedWhenBHandedOut } =
                await suspendedInRetirement(first, second);

            (c as unknown as SpeechRuntimeController).reset('navigation');
            enterProduct(second, BRIEF_B);
            const newerStart = outcomeOf(c.startRecording(POLICY, []));
            await settle();
            expect(c.acceptedAttempt, 'the newer Start is not admitted on the dying service').toBeNull();
            expect(serviceA.startTranscription, "A's dying service was not started for the newer take")
                .toHaveBeenCalledTimes(1);

            // A's engine speaks through whatever its service holds — including a binding handed to it meanwhile.
            emitFromA(serviceA.live);
            releaseA();
            await settle();

            expect(await staleStart, 'the superseded Start did not record').not.toBe('resolved');
            expect(await newerStart, 'the newer Start recorded').toBe('resolved');
            expect(c.acceptedAttempt?.service, 'the newer take runs on a fresh service').toBe(serviceB);
            expect(serviceB.startTranscription, 'exactly one engine start, for the newer take').toHaveBeenCalledTimes(1);
            expect(lockedWhenBHandedOut, 'engine selection stayed locked until the newer take owned its service')
                .toEqual([true]);
            expect(c.recordingProgressMode.mode, "the newer take's product").toBe(second);

            emitFromA(serviceA.live);
            await settle();
            expect(useSessionStore.getState().transcript.transcript, "A's emissions are dropped").toBe('');

            // POSITIVE CONTROL — the newer take's own engine is delivered.
            serviceB.live.onTranscriptUpdate?.(finalUpdate('Charlie take words.') as never);
            await settle();
            const after = useSessionStore.getState().transcript.transcript;
            expect(after).toContain('Charlie');
            expect(after).not.toContain('Alpha');
        });

        it('a second Start pressed during the retirement: only the newest Start records', async () => {
            const { c, serviceA, serviceB, releaseA, staleStart, lockedWhenBHandedOut } =
                await suspendedInRetirement(first, second);

            const newerStart = outcomeOf(c.startRecording(POLICY, []));
            releaseA();
            await settle();

            expect(await staleStart, 'the replaced Start did not record').not.toBe('resolved');
            expect(await newerStart, 'the newest Start recorded').toBe('resolved');
            expect(c.state).toBe('RECORDING');
            expect(c.acceptedAttempt?.service, 'the newest take runs on a fresh service').toBe(serviceB);
            expect(serviceB.startTranscription, 'exactly one engine start').toHaveBeenCalledTimes(1);
            expect(lockedWhenBHandedOut).toEqual([true]);

            emitFromA(serviceA.live);
            await settle();
            expect(useSessionStore.getState().transcript.transcript, "A's emissions are dropped").toBe('');
            serviceB.live.onTranscriptUpdate?.(finalUpdate('Charlie take words.') as never);
            await settle();
            expect(useSessionStore.getState().transcript.transcript).toContain('Charlie');
        });
    });
});

/**
 * #1258 RWT round 2 C (Sam 6218045990) — on a REAL failed Stop (not a hand-seeded retry slot), the take's words survive
 * the page purge in the bound retry payload, and Retry Save replays exactly that transcript for the same session.
 * The page clearing its live text is by design; the words a person spoke are not lost.
 */
describe('#1258 C — a real failed Stop keeps the take\'s words for Retry Save across the page purge', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset().mockResolvedValueOnce({ status: 'saved', session: { id: 'session-A' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    it('the failed completion\'s transcript is the one Retry Save replays, after the live text is purged', async () => {
        const c = newController();
        c.state = 'READY';
        const serviceA = recordingService('A');
        factory.queue.push(serviceA);
        enterProduct('open_mic', BRIEF_A);
        await c.startRecording(POLICY, []);

        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await expect(c.stopRecording()).rejects.toThrow('SESSION_COMPLETION_FAILED');
        await settle();
        const calls = vi.mocked(completeSession).mock.calls;
        type Args = { status?: string; finalTranscript?: string };
        const completedCalls = () => calls.filter((call) => (call[1] as Args | undefined)?.status === 'completed');
        // The failed attempt is the take's COMPLETED write (a later `status: failed` marker write carries no transcript).
        const failed = completedCalls()[completedCalls().length - 1];
        const original = (failed?.[1] as Args | undefined)?.finalTranscript;
        expect(original, 'the failed completion carried the take\'s words').toContain('Alpha take words');
        expect(useSessionStore.getState().pendingResolutionKind, 'a full-save recovery is pending').toBe('full_save');
        expect(useSessionStore.getState().transcript.transcript, 'the page purged its live text (by design)').toBe('');

        vi.mocked(completeSession).mockResolvedValueOnce({ success: true, transcriptOutcome: 'retained', transcriptRetained: true } as never);
        await (c as unknown as { retryRecordingSave: () => Promise<boolean> }).retryRecordingSave();
        const replay = completedCalls()[completedCalls().length - 1];
        expect(replay, 'Retry Save sent a new completed write').not.toBe(failed);
        expect(replay?.[0], 'the same session').toBe(failed?.[0]);
        expect((replay?.[1] as Args | undefined)?.finalTranscript, 'the identical words are replayed').toBe(original);
    });

    /**
     * #1258 RWT round 2 C root cause — A PENDING RETRY MUST NOT BE CLOSED BY ITS OWN FAILURE.
     *
     * The server closes a leased take for good once it is `failed` (#1476: "and then never revived"). The failed
     * Stop wrote that `failed` marker onto the very session it had just armed Retry Save for — once from the stop
     * catch and again from the FAILED transition — so every Retry Save was refused (`lease_revoked`). Only a
     * confirmed Discard may close a take whose save is still recoverable. POSITIVE CONTROL: Discard still does.
     */
    it('a failed save never marks its own session failed; only Discard does', async () => {
        const c = newController();
        c.state = 'READY';
        const serviceA = recordingService('A');
        factory.queue.push(serviceA);
        enterProduct('open_mic', BRIEF_A);
        await c.startRecording(POLICY, []);

        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await expect(c.stopRecording()).rejects.toThrow('SESSION_COMPLETION_FAILED');
        await settle();
        expect(useSessionStore.getState().pendingResolutionKind, 'a full-save recovery is pending').toBe('full_save');
        type Args = { status?: string };
        const failedMarkers = () => vi.mocked(completeSession).mock.calls
            .filter((call) => call[0] === 'session-A' && (call[1] as Args | undefined)?.status === 'failed');
        expect(failedMarkers(), 'the recoverable take was not closed by its own save failure').toHaveLength(0);

        await expect(c.discardUnresolvedRecording()).resolves.toMatchObject({ outcome: 'discarded', sessionId: 'session-A' });
        expect(failedMarkers(), 'a confirmed Discard is what closes it').toHaveLength(1);
    });
});

/**
 * #1258 RWT round 2 C (live 38991376690 / 38991893303) — A RECOVERED SAVE LICENSES THE REVIEW, AND NOTHING ELSE DOES.
 *
 * Only a successful Stop entered the saved-take review, so after a failed Stop and a successful Retry Save the page
 * never showed `Practice this again`. The controller now publishes `recoveredSaveSessionId` from its owner-fenced
 * full-save settlement, and settles the failed Stop's own status by identity. Controls: a failed, no-op or superseded
 * retry publishes nothing, and a status written after the failure (a microphone error) is never cleared.
 */
describe('#1258 C — a recovered save enters the review; nothing else does', () => {
    type Retrying = PrivateController & { retryRecordingSave: () => Promise<boolean>; lifecycleVersion: number };

    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset().mockResolvedValueOnce({ status: 'saved', session: { id: 'session-A' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    const failedStop = async (): Promise<Retrying> => {
        const c = newController() as Retrying;
        c.state = 'READY';
        factory.queue.push(recordingService('A'));
        enterProduct('open_mic', BRIEF_A);
        await c.startRecording(POLICY, []);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await expect(c.stopRecording()).rejects.toThrow('SESSION_COMPLETION_FAILED');
        await settle();
        expect(useSessionStore.getState().pendingResolutionKind, 'precondition: Retry Save is armed').toBe('full_save');
        expect(useSessionStore.getState().recoveredSaveSessionId, 'precondition: no review licence yet').toBeNull();
        return c;
    };

    it('a successful Retry Save publishes the recovered session and settles the failed Stop\'s own status', async () => {
        const c = await failedStop();
        const failedStatus = useSessionStore.getState().sttStatus;
        expect(['error', 'warning'], 'precondition: the failed save left a failure status').toContain(failedStatus.type);

        await expect(c.retryRecordingSave()).resolves.toBe(true);
        await settle();
        const st = useSessionStore.getState();
        expect(st.recoveredSaveSessionId, 'the page is licensed to review the recovered take').toBe('session-A');
        expect(st.completedSessionId).toBe('session-A');
        expect(st.sttStatus.type, 'the failed save no longer masks the review').toBe('info');
        expect(st.pendingResolutionKind).toBeNull();
    });

    it('a recovered save clears its own finalized recovery draft, as a first-pass save does', async () => {
        const drafts = await import('../sessionRecoveryDraft');
        const c = await failedStop();
        expect(drafts.getSessionRecoveryDraft()?.sessionId, 'precondition: the failed save kept a finalized draft').toBe('session-A');
        await expect(c.retryRecordingSave()).resolves.toBe(true);
        await settle();
        expect(drafts.getSessionRecoveryDraft(), 'no stale "not saved" draft survives the recovered save').toBeNull();
    });

    it('Codex P2 r4301349174: unreadable storage during draft cleanup cannot turn a saved retry into a failure', async () => {
        const c = await failedStop();
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
        try {
            await expect(c.retryRecordingSave(), 'the server saved the take: the retry succeeds').resolves.toBe(true);
            await settle();
        } finally {
            getItem.mockRestore();
        }
        const st = useSessionStore.getState();
        expect(st.pendingResolutionKind, 'the recovery is resolved and unlocked').toBeNull();
        expect(st.completedSessionId).toBe('session-A');
        expect(st.recoveredSaveSessionId, 'the review is still licensed').toBe('session-A');
        expect(document.documentElement.getAttribute('data-session-persisted')).toBe('true');
        expect(vi.mocked(completeSession).mock.calls.filter(([id, a]) => id === 'session-A' && (a as { status?: string })?.status === 'failed'),
            'no failed marker').toHaveLength(0);
    });

    it('CONTROL: a recovered save never deletes ANOTHER session\'s recovery draft', async () => {
        const drafts = await import('../sessionRecoveryDraft');
        const c = await failedStop();
        const own = drafts.getSessionRecoveryDraft();
        expect(own?.sessionId).toBe('session-A');
        drafts.saveSessionRecoveryDraft({ ...own!, sessionId: 'session-OTHER' });
        await expect(c.retryRecordingSave()).resolves.toBe(true);
        await settle();
        expect(drafts.getSessionRecoveryDraft()?.sessionId, 'the unrelated draft is kept').toBe('session-OTHER');
    });

    it('CONTROL: a status written after the failure (a microphone error) is never cleared by the recovery', async () => {
        const c = await failedStop();
        const micError = { type: 'error' as const, message: 'Microphone access is denied. Please grant permission in your browser settings.' };
        useSessionStore.getState().setSTTStatus(micError);

        await expect(c.retryRecordingSave()).resolves.toBe(true);
        await settle();
        expect(useSessionStore.getState().sttStatus, 'the genuine error stays').toBe(micError);
        expect(useSessionStore.getState().recoveredSaveSessionId).toBe('session-A');
    });

    it('CONTROL: a Retry Save that fails again publishes nothing and keeps the recovery and lock', async () => {
        const c = await failedStop();
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await expect(c.retryRecordingSave()).resolves.toBe(false);
        await settle();
        expect(useSessionStore.getState().recoveredSaveSessionId).toBeNull();
        expect(useSessionStore.getState().pendingResolutionKind, 'still recoverable').toBe('full_save');
    });

    it('CONTROL: a no-op Retry Save (nothing pending) returns true and publishes nothing', async () => {
        const c = newController() as Retrying;
        c.state = 'READY';
        await expect(c.retryRecordingSave()).resolves.toBe(true);
        expect(useSessionStore.getState().recoveredSaveSessionId, 'a true return alone is no licence').toBeNull();
    });

    it('CONTROL: a retry overtaken by a newer take mid-flight publishes no review for it', async () => {
        const c = await failedStop();
        vi.mocked(completeSession).mockImplementationOnce(async () => {
            c.lifecycleVersion += 1; // a successor take owns the lifecycle while A's completion is in flight
            return { success: true } as never;
        });
        await c.retryRecordingSave();
        await settle();
        expect(useSessionStore.getState().recoveredSaveSessionId, 'A\'s settlement cannot open a review over B').toBeNull();
    });
});

/**
 * #1258 RWT round 2 C (Codex P1 r4300891532, Sam 6228507737) — the recovered-review licence belongs to the recovered take
 * only until a newer Start is admitted: a newer take that is denied before any audio must show its own failed start.
 */
describe('#1258 C — a newer admitted Start retires the recovered-review licence', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset()
            .mockResolvedValueOnce({ status: 'saved', session: { id: 'session-A' } } as never)
            .mockResolvedValueOnce({ status: 'saved', session: { id: 'session-B' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    it('recovered A → Start B denied before audio: the licence is gone, A stays saved', async () => {
        const c = newController() as PrivateController & { retryRecordingSave: () => Promise<boolean> };
        c.state = 'READY';
        const serviceB = recordingService('B');
        serviceB.startTranscription.mockRejectedValue(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
        factory.queue.push(recordingService('A'), serviceB);
        enterProduct('open_mic', BRIEF_A);
        await c.startRecording(POLICY, []);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await expect(c.stopRecording()).rejects.toThrow('SESSION_COMPLETION_FAILED');
        await settle();
        await expect(c.retryRecordingSave()).resolves.toBe(true);
        await settle();
        expect(useSessionStore.getState().recoveredSaveSessionId, 'precondition: A is under review').toBe('session-A');
        const aCompleted = vi.mocked(completeSession).mock.calls.filter(([id, a]) => id === 'session-A' && (a as { status?: string })?.status === 'completed').length;

        await c.startRecording(POLICY, []).catch(() => { /* B's denied microphone is the subject */ });
        await settle();
        expect(useSessionStore.getState().recoveredSaveSessionId, 'B\'s Start retired A\'s review licence').toBeNull();
        const failedA = vi.mocked(completeSession).mock.calls.filter(([id, a]) => id === 'session-A' && (a as { status?: string })?.status === 'failed');
        expect(failedA, 'A stays saved: nothing closes it').toHaveLength(0);
        expect(vi.mocked(completeSession).mock.calls.filter(([id, a]) => id === 'session-A' && (a as { status?: string })?.status === 'completed'))
            .toHaveLength(aCompleted);
    });
});
