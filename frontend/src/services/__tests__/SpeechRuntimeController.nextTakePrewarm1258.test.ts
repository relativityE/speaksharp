// @vitest-environment jsdom
/**
 * #1258 PR A — PREPARE THE NEXT TAKE'S FRESH ENGINE WHILE THE REVIEW IS ON SCREEN (PM 6201047197).
 *
 * Drives the REAL controller with the same service-factory contract as the failed-stop reuse suite: the factory hands back
 * its cached service until that service is destroyed. Regression requirements: destroy proven terminal before the
 * replacement is created; one preparation for a concurrent Start (it joins); reset/owner change invalidates; a rejected
 * destroy or an unconfirmed engine-off stays fail-closed (nothing is created); a Start without preparation is unchanged.
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
    // What the REAL controller warm-up touches: the policy update and the queued subscription sync.
    updatePolicy: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => undefined),
    // #1258 finding A — the real service's background-preparation switch (publishes nothing while on).
    background: false,
    setBackgroundPreparation: vi.fn((on: boolean) => { svc.background = on; }),
    isBackgroundPreparation: vi.fn(() => svc.background),
    };
    return svc;
};

const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const newController = () => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController;
};

type Prewarm = PrivateController & {
    prepareNextTake: (mode: string) => Promise<void>;
    confirmEngineShutdown: (boundMs?: number) => Promise<'terminal' | 'unconfirmed'>;
    warmUp: (mode?: string) => Promise<void>;
    reset: (reason?: string) => void;
};

/** One normal take on service A (start → stop, save succeeds), leaving the controller at READY with A retired. */
const afterNormalTake = async () => {
    const c = newController() as unknown as Prewarm;
    c.state = 'READY';
    const serviceA = recordingService('A');
    const serviceB = recordingService('B');
    const serviceC = recordingService('C');
    factory.queue.push(serviceA, serviceB, serviceC);
    await c.startRecording(POLICY, []);
    await c.stopRecording();
    await settle();
    // The page prepares only once the take's Progress gate is clear (SessionPage trigger). The stubbed server never answers
    // the evaluation, so the harness establishes that precondition explicitly: no in-flight gate, no durable debt.
    useSessionStore.getState().setProgressGate(null);
    window.localStorage.clear();
    return { c, serviceA, serviceB, serviceC };
};

describe('#1258 PR A — next-take preparation', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset().mockResolvedValue({ status: 'saved', session: { id: 'session-x' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    it('after a normal take: proves the old engine off, then builds and warms exactly ONE fresh service, which the next Start uses', async () => {
        const { c, serviceA, serviceB, serviceC } = await afterNormalTake();
        expect(c.state).toBe('READY');
        const order: string[] = [];
        vi.spyOn(c, 'confirmEngineShutdown').mockImplementation(async () => { order.push('engine-proven-off'); return 'terminal'; });
        const warm = vi.spyOn(c, 'warmUp').mockImplementation(async () => { order.push('warm'); });

        await c.prepareNextTake('private');
        expect(c.service, 'a fresh service is attached').toBe(serviceB);
        expect(order, 'destroy-before-create: proof of engine-off precedes the build and warm-up').toEqual(['engine-proven-off', 'warm']);
        expect(warm).toHaveBeenCalledTimes(1);

        await c.startRecording(POLICY, []);
        expect(c.acceptedAttempt?.service, 'the next take runs on the prepared service').toBe(serviceB);
        expect(serviceC.updateCallbacks, 'no second service was built for the Start').not.toHaveBeenCalled();
        expect(serviceA.startTranscription).toHaveBeenCalledTimes(1);
    });

    it('#1258 finding A: the prepared service warms in the BACKGROUND (unpublished); the Start that uses it claims it', async () => {
        const { c, serviceB } = await afterNormalTake();
        vi.spyOn(c, 'confirmEngineShutdown').mockResolvedValue('terminal');
        let backgroundDuringWarm: boolean | null = null;
        vi.spyOn(c, 'warmUp').mockImplementation(async () => { backgroundDuringWarm = serviceB.background; });

        await c.prepareNextTake('private');
        expect(backgroundDuringWarm, 'its warm-up is not published to the page').toBe(true);
        expect(serviceB.background, 'still unclaimed while the review is on screen').toBe(true);

        await c.startRecording(POLICY, []);
        expect(c.acceptedAttempt?.service).toBe(serviceB);
        expect(serviceB.setBackgroundPreparation).toHaveBeenLastCalledWith(false);
        expect(serviceB.background, 'the Start claimed it: it publishes from here').toBe(false);
    });

    it('#1258 finding A: an explicit model download claims a background-prepared service (the user\'s download is shown)', async () => {
        const { c, serviceB } = await afterNormalTake();
        vi.spyOn(c, 'confirmEngineShutdown').mockResolvedValue('terminal');
        vi.spyOn(c, 'warmUp').mockResolvedValue(undefined);
        await c.prepareNextTake('private');
        expect(serviceB.background).toBe(true);
        (serviceB as unknown as { initiateDownload: (m: string) => Promise<void> }).initiateDownload = vi.fn().mockResolvedValue(undefined);
        await (c as unknown as { initiateModelDownload: (m: string) => Promise<void> }).initiateModelDownload('private');
        expect(serviceB.background).toBe(false);
    });

    it('a Start pressed during preparation JOINS it — one engine, not two', async () => {
        const { c, serviceB, serviceC } = await afterNormalTake();
        let release: () => void = () => undefined;
        vi.spyOn(c, 'confirmEngineShutdown').mockImplementation(() => new Promise((r) => { release = () => r('terminal'); }));
        vi.spyOn(c, 'warmUp').mockResolvedValue(undefined);

        const preparing = c.prepareNextTake('private');
        const starting = c.startRecording(POLICY, []);
        await settle();
        release();
        await preparing;
        await starting;
        expect(c.acceptedAttempt?.service).toBe(serviceB);
        expect(serviceC.updateCallbacks, 'the Start did not build its own engine alongside the prepared one').not.toHaveBeenCalled();
    });

    it('fail-closed: an engine not proven off builds nothing (the next Start keeps today\'s behaviour)', async () => {
        const { c, serviceB } = await afterNormalTake();
        vi.spyOn(c, 'confirmEngineShutdown').mockResolvedValue('unconfirmed');
        const warm = vi.spyOn(c, 'warmUp').mockResolvedValue(undefined);
        await c.prepareNextTake('private');
        expect(c.service, 'no replacement over a possibly-live engine').toBeNull();
        expect(serviceB.updateCallbacks).not.toHaveBeenCalled();
        expect(warm).not.toHaveBeenCalled();
    });

    it('a reset during preparation makes it stand down without building or publishing', async () => {
        const { c, serviceB } = await afterNormalTake();
        let release: () => void = () => undefined;
        vi.spyOn(c, 'confirmEngineShutdown').mockImplementation(() => new Promise((r) => { release = () => r('terminal'); }));
        const warm = vi.spyOn(c, 'warmUp').mockResolvedValue(undefined);
        const preparing = c.prepareNextTake('private');
        await settle();
        c.reset('manual');
        release();
        await preparing;
        expect(serviceB.updateCallbacks, 'nothing was built for a superseded lifecycle').not.toHaveBeenCalled();
        expect(warm).not.toHaveBeenCalled();
    });

    it('a spent service whose destroy fails is never replaced (fail-closed)', async () => {
        const c = newController() as unknown as Prewarm;
        c.state = 'READY';
        const spent = recordingService('spent');
        spent.destroy.mockImplementation(async () => { throw new Error('worker did not acknowledge'); });
        const fresh = recordingService('fresh');
        factory.queue.push(spent, fresh);
        // A take ran on `spent` and its save failed, leaving it attached (the failed-stop path).
        await c.startRecording(POLICY, []);
        vi.mocked(completeSession).mockResolvedValueOnce({ success: false } as never);
        await c.stopRecording().catch(() => undefined);
        await settle();
        await (c as unknown as { discardUnresolvedRecording: () => Promise<unknown> }).discardUnresolvedRecording().catch(() => undefined);
        c.state = 'READY';
        const warm = vi.spyOn(c, 'warmUp').mockResolvedValue(undefined);
        await c.prepareNextTake('private');
        expect(fresh.updateCallbacks, 'no replacement was built over an undestroyed spent service').not.toHaveBeenCalled();
        expect(warm).not.toHaveBeenCalled();
    });
});

/**
 * PM 6205858358 P1 — THE PRE-WARM / START QUEUE CYCLE, on the REAL controller warm-up. `warmUp` ends by queueing its
 * subscription sync on the command queue; a Start that waited for the preparation INSIDE its own queue slot would hold
 * that sync behind itself, and neither could finish. Nothing here mocks `controller.warmUp`: only the service's own
 * warm-up is deferred, so the controller's queued work is exercised as shipped.
 */
describe('#1258 PR A — a Start during the real warm-up joins outside the queue', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset().mockResolvedValue({ status: 'saved', session: { id: 'session-x' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    const within = <T,>(p: Promise<T>, ms: number) => Promise.race([
        p.then(() => 'settled' as const), new Promise<'stuck'>((r) => setTimeout(() => r('stuck'), ms)),
    ]);
    /** Preparation suspended inside the fresh service's own warm-up, with the controller's real queue live. */
    const suspendedInWarmUp = async () => {
        const ctx = await afterNormalTake();
        vi.spyOn(ctx.c, 'confirmEngineShutdown').mockResolvedValue('terminal');
        useSessionStore.getState().setIsBooting(false); // booting skips the sync and would hide the cycle
        // Only the PREPARATION's warm-up is held; the Start's own later warm-up of the same service resolves at once.
        let releaseWarm: () => void = () => undefined;
        const held = new Promise<void>((r) => { releaseWarm = r; });
        ctx.serviceB.warmUp = vi.fn().mockReturnValueOnce(held).mockResolvedValue(undefined);
        const preparing = ctx.c.prepareNextTake('private');
        await settle();
        expect(ctx.serviceB.warmUp, 'preparation is suspended inside the fresh service\'s warm-up').toHaveBeenCalledTimes(1);
        return { ...ctx, preparing, release: () => releaseWarm() };
    };

    it('Start pressed during the deferred warm-up: both settle, exactly one fresh service, one accepted take', async () => {
        const { c, serviceB, serviceC, preparing, release } = await suspendedInWarmUp();
        const starting = c.startRecording(POLICY, []);
        await settle();
        release();
        expect(await within(Promise.all([preparing, starting]), 2_000), 'no queue cycle: preparation and Start both finish').toBe('settled');
        expect(serviceB.subscribe, 'the preparation\'s queued subscription ran').toHaveBeenCalled();
        expect(c.acceptedAttempt?.service, 'the take runs on the one prepared service').toBe(serviceB);
        expect(serviceB.startTranscription).toHaveBeenCalledTimes(1);
        expect(serviceC.updateCallbacks, 'no second service').not.toHaveBeenCalled();
    });

    it('a reset at that suspension: the joined Start stands down — no take, no second service', async () => {
        const { c, serviceB, serviceC, preparing, release } = await suspendedInWarmUp();
        const starting = c.startRecording(POLICY, []);
        await settle();
        c.reset('manual');
        release();
        expect(await within(Promise.all([preparing.catch(() => undefined), starting.catch(() => undefined)]), 2_000)).toBe('settled');
        expect(serviceB.startTranscription, 'the superseded Start never recorded').not.toHaveBeenCalled();
        expect(c.acceptedAttempt).toBeNull();
        expect(serviceC.updateCallbacks).not.toHaveBeenCalled();
    });

    it('an owner change at that suspension: the joined Start stands down', async () => {
        const { c, serviceB, preparing, release } = await suspendedInWarmUp();
        const starting = c.startRecording(POLICY, []);
        await settle();
        (c as unknown as { capturedUserId: string | null }).capturedUserId = 'someone-else';
        release();
        expect(await within(Promise.all([preparing.catch(() => undefined), starting.catch(() => undefined)]), 2_000)).toBe('settled');
        expect(serviceB.startTranscription, 'a Start that belonged to the previous owner never recorded').not.toHaveBeenCalled();
    });

    it('no new preparation begins once a Start intent exists', async () => {
        const { c } = await afterNormalTake();
        const confirm = vi.spyOn(c, 'confirmEngineShutdown').mockResolvedValue('terminal');
        const starting = c.startRecording(POLICY, []);
        await c.prepareNextTake('private');
        expect(confirm, 'preparation did not start alongside the pending Start').not.toHaveBeenCalled();
        await starting;
    });
});
