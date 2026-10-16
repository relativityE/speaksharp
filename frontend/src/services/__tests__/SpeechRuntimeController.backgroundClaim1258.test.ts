// @vitest-environment jsdom
/**
 * #1258 RWT round 2 finding A — PM CHANGES REQUESTED 6216298226: three focused controls on the changed ownership boundary,
 * driven through the REAL controller and the REAL TranscriptionService (only the engine and storage are stubbed).
 *
 * 1. A background strategy failure claimed by the queued Start: the Start settles exactly once and truthfully, a stale
 *    deferred FAILED never overrides an accepted recording, and an explicit retry then records.
 * 2. Destroy while `strategy.init` is still pending, then resolve AND reject the held init: nothing is published and the
 *    service never comes back to life.
 * 3. Strategy callbacks captured before disposal and invoked after it: no page publication, no lifecycle change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../transcription/modes/types';
import type { SttStatus } from '@/types/transcription';

type Store = typeof import('@/stores/useSessionStore').useSessionStore;
let useSessionStore: Store;

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/services/transcription/runtimeCandidateTakeGate', () => ({
    evaluateRuntimeCandidateTakeGate: () => ({ enabled: false, allowed: true }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
    })),
}));
vi.mock('../recordingLease', () => ({
    acquireTakeLease: vi.fn(async () => ({ action: 'start', tookOver: false })),
    confirmTakeLease: vi.fn(async () => 'held'),
    startLeaseHeartbeat: vi.fn(),
    releaseTakeLease: vi.fn(async () => undefined),
    currentTakeLeaseId: () => null,
}));

const POLICY = {
    allowNative: false, allowCloud: false, allowPrivate: true,
    preferredMode: 'private', allowFallback: false, executionIntent: 'test',
};

/** A cached-model engine whose init can be held, and which counts what the service asks of it. */
class ControlledEngine {
    public initCalls = 0;
    public startCalls = 0;
    public initGate: Promise<void> | null = null;
    public initFails: Error | null = null;
    updateOptions() { /* no-op */ }
    async checkAvailability() { return { isAvailable: true }; }
    async init(): Promise<Result<void, Error>> {
        this.initCalls += 1;
        if (this.initGate) await this.initGate;
        if (this.initFails) return { isOk: false, error: this.initFails } as unknown as Result<void, Error>;
        return { isOk: true, value: undefined } as unknown as Result<void, Error>;
    }
    async start() { this.startCalls += 1; }
    async stop() { /* no-op */ }
    async resume() { /* no-op */ }
    async pause() { /* no-op */ }
    async terminate() { /* no-op */ }
    async getTranscript() { return ''; }
    getLastHeartbeatTimestamp() { return Date.now(); }
    getEngineType() { return 'transformers-js'; }
}

const settle = async (turns = 12) => {
    for (let i = 0; i < turns; i += 1) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
};

type ServiceInternals = {
    strategyCallbacks: { onError: (e: Error) => void; onReady: () => void; onStatusChange: (s: SttStatus) => void; onModelLoadProgress: (p: number) => void };
    isBackgroundPreparation: () => boolean;
    isServiceDestroyed: () => boolean;
    destroy: () => Promise<void>;
    getState: () => string;
};
type ControllerInternals = {
    state: string;
    service: ServiceInternals | null;
    isEngineReady: boolean;
    recordingStartedUnresolved: boolean;
    pendingAttributionRetry: unknown;
    pendingFullSaveRetry: unknown;
    prepareNextTake: (mode: string) => Promise<void>;
    confirmEngineShutdown: (ms?: number) => Promise<'terminal' | 'unconfirmed'>;
};

describe('#1258 A — background preparation claim boundary, real controller + real service (PM 6216298226)', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let priv: ControllerInternals;
    let engine: ControlledEngine;
    const REVIEW = { type: 'idle', message: 'review on screen' } as SttStatus;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        (await import('../recordingIntent')).__resetRecordingIntentForTests();
        controller = (await import('../SpeechRuntimeController')).speechRuntimeController;
        priv = controller as unknown as ControllerInternals;
        priv.state = 'READY';
        priv.service = null;
        priv.isEngineReady = false;
        priv.recordingStartedUnresolved = false;
        priv.pendingAttributionRetry = null;
        priv.pendingFullSaveRetry = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        vi.spyOn(priv, 'confirmEngineShutdown').mockResolvedValue('terminal');
    });
    afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

    /** Prepare the next take in the background and return the prepared (still unclaimed) service. */
    const prepared = async (): Promise<ServiceInternals> => {
        await priv.prepareNextTake('private');
        await settle();
        const svc = priv.service;
        expect(svc, 'precondition: a prepared service is attached').not.toBeNull();
        expect(svc!.isBackgroundPreparation(), 'precondition: it is still in the background').toBe(true);
        useSessionStore.getState().setSTTStatus(REVIEW); // the review's own page state, which nothing may overwrite
        return svc!;
    };

    it('1. a background strategy failure is claimed by the queued Start: one truthful settlement, no stale FAILED over a recording; an explicit retry records', async () => {
        const svc = await prepared();
        const failure = new Error('worker crashed during warm-up');
        svc.strategyCallbacks.onError(failure); // the strategy fails while still in the background
        await settle();
        expect(useSessionStore.getState().sttStatus, 'not published while the review is on screen').toEqual(REVIEW);

        const settlements: string[] = [];
        const first = controller.startRecording(POLICY as never, []);
        first.then(() => settlements.push('resolved'), (e: Error) => settlements.push(`rejected:${e.message}`));
        await settle(60);
        expect(settlements, 'the claiming Start settles exactly once, rejected with the genuine preparation failure').toEqual(['rejected:PREPARED_SERVICE_FAILED']);
        expect(engine.startCalls, 'nothing records on the failed prepared service').toBe(0);
        expect(controller.getState(), 'the controller is not recording').not.toBe('RECORDING');
        expect(useSessionStore.getState().sttStatus.type, 'the genuine failure reached the page').toBe('error');
        expect(priv.service, 'the failed prepared service was retired').toBeNull();

        // The person's explicit retry builds a fresh engine and records; the earlier deferred failure never lands on it.
        const retry = controller.startRecording(POLICY as never, []);
        await settle(60);
        await retry;
        expect(controller.getState(), 'an explicit retry after the claimed failure records').toBe('RECORDING');
        expect(engine.startCalls).toBe(1);
        await settle(60);
        expect(controller.getState(), 'and no stale FAILED overrides that accepted recording').toBe('RECORDING');
    });

    it.each([
        ['resolves', false],
        ['rejects', true],
    ])('2. destroy while strategy.init is pending, then the held init %s: nothing published, no resurrection', async (_label, rejects) => {
        let release: () => void = () => undefined;
        engine.initGate = new Promise<void>((r) => { release = r; });
        if (rejects) engine.initFails = new Error('model load failed');
        const preparing = priv.prepareNextTake('private');
        await vi.waitFor(() => expect(engine.initCalls, 'precondition: init is in flight').toBe(1));
        const svc = priv.service!;
        expect(svc.isBackgroundPreparation()).toBe(true);
        useSessionStore.getState().setSTTStatus(REVIEW);
        useSessionStore.getState().setModelLoadingProgress(null);
        const onReady = vi.spyOn(svc.strategyCallbacks, 'onReady');

        await svc.destroy();
        release();
        await preparing.catch(() => undefined);
        await settle(30);

        expect(useSessionStore.getState().sttStatus, 'no status published').toEqual(REVIEW);
        expect(useSessionStore.getState().modelLoadingProgress, 'no progress published').toBeNull();
        expect(svc.isServiceDestroyed(), 'no resurrection').toBe(true);
        expect(svc.getState()).toBe('TERMINATED');
        expect(onReady, 'no ready delivered from a disposed preparation').not.toHaveBeenCalled();
        expect(controller.getState(), 'the controller lifecycle is untouched').toBe('READY');
    });

    it('3. strategy callbacks captured before disposal and invoked after it: no page publication, no lifecycle change', async () => {
        const svc = await prepared();
        const callbacks = svc.strategyCallbacks;
        await svc.destroy();
        useSessionStore.getState().setSTTStatus(REVIEW);
        useSessionStore.getState().setModelLoadingProgress(null);

        callbacks.onStatusChange({ type: 'error', message: 'late status' });
        callbacks.onModelLoadProgress(42);
        callbacks.onReady();
        callbacks.onError(new Error('late error'));
        await settle(30);

        expect(useSessionStore.getState().sttStatus).toEqual(REVIEW);
        expect(useSessionStore.getState().modelLoadingProgress).toBeNull();
        expect(svc.getState()).toBe('TERMINATED');
        expect(controller.getState()).toBe('READY');
    });
});
