// @vitest-environment jsdom
/**
 * #1476 — PM pre-push review of the 54576db9 correction: WHEN THE SESSION PAGE GOES AWAY, THE ENGINE IS RETIRED FOR REAL.
 *
 * The page's unmount routine (`releaseTakeLeaseOnUnmount`) drives the REAL controller and the REAL TranscriptionService,
 * with a controlled engine at the registry seam — the same harness as SpeechRuntimeController.oneClickRecording. Mocking
 * `getState()` cannot establish engine shutdown; these observe the engine itself: whether it starts, whether it is
 * terminated, and whether the account's lease is released only once it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Result } from '../transcription/modes/types';

type Store = typeof import('@/stores/useSessionStore').useSessionStore;
let useSessionStore: Store;
type IntentApi = typeof import('../recordingIntent');
let intentApi: IntentApi;

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
/** The account lease: held by this take; `release` is what another device waits on. */
const lease = vi.hoisted(() => ({ release: vi.fn(async () => undefined) }));
vi.mock('../recordingLease', () => ({
    acquireTakeLease: vi.fn(async () => ({ action: 'start', tookOver: false })),
    confirmTakeLease: vi.fn(async () => 'held'),
    startLeaseHeartbeat: vi.fn(),
    releaseTakeLease: () => lease.release(),
    currentTakeLeaseId: () => null,
}));

const POLICY = {
    allowNative: false, allowCloud: false, allowPrivate: true,
    preferredMode: 'private', allowFallback: false, executionIntent: 'test',
};

class ControlledEngine {
    public modelCached = false;
    public initCalls = 0;
    public startCalls = 0;
    public failStart: Error | null = null;
    public failInit: Error | null = null;
    /** False models a machine where the download never lands — preparation that cannot settle. */
    public downloadEnabled = true;

    /** `PrivateSTT` wraps this engine and forwards option updates to it. */
    updateOptions() { /* no-op */ }
    async checkAvailability() {
        return this.modelCached
            ? { isAvailable: true }
            : { isAvailable: false, reason: 'CACHE_MISS' as const, message: 'model not cached' };
    }
    /**
     * The first init on a cold machine DISCOVERS the miss and the download completes behind it; the
     * next init finds the model present. That two-step is the real cold sequence, and modelling it
     * inside the engine is what lets the test drive preparation through Production's own completion
     * authority instead of forcing a controller state.
     */
    async init(): Promise<Result<void, Error>> {
        this.initCalls += 1;
        if (!this.modelCached) {
            if (this.downloadEnabled) this.modelCached = true;   // the one-time download lands
            return {
                isOk: false,
                error: Object.assign(new Error('CACHE_MISS'), { code: 'CACHE_MISS' }),
            } as unknown as Result<void, Error>;
        }
        if (this.failInit) return { isOk: false, error: this.failInit } as unknown as Result<void, Error>;
        return { isOk: true, value: undefined } as unknown as Result<void, Error>;
    }
    async start() {
        this.startCalls += 1;
        if (this.failStart) throw this.failStart;
    }
    async stop() { /* no-op */ }
    async resume() { /* no-op */ }
    async pause() { /* no-op */ }
    public terminateCalls = 0;
    /** True models an engine whose termination never completes (a wedged worker). */
    public terminateHangs = false;
    async terminate() {
        this.terminateCalls += 1;
        if (this.terminateHangs) await new Promise(() => undefined);
    }
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

describe('#1476 — unmount retires the engine before the account lease is released', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;
    let releaseTakeLeaseOnUnmount: (wasListening: boolean) => Promise<boolean>;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();
        controller = (await import('../SpeechRuntimeController')).speechRuntimeController;
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE';
        priv.service = null;
        priv.isEngineReady = false;
        priv.recordingStartedUnresolved = false;
        priv.pendingAttributionRetry = null;
        priv.pendingFullSaveRetry = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
        ({ releaseTakeLeaseOnUnmount } = await import('@/hooks/useSessionLifecycle'));
    });
    afterEach(() => { vi.clearAllMocks(); lease.release.mockImplementation(async () => undefined); vi.useRealTimers(); });

    it('CASUALTY: unmount at the START of preparation (no engine yet) — the Start never becomes a recording and no engine is ever created', async () => {
        // The real cold path, unaided: the click drives the download and the held Start resumes when the model lands.
        const started = controller.startRecording(POLICY as never, []);
        const outcome: string[] = [];
        started.then(() => outcome.push('resolved'), (e: Error) => outcome.push(`rejected:${e.message}`));
        await Promise.resolve();
        expect(intentApi.pendingRecordingIntent(), 'precondition: a Start is waiting on preparation').not.toBeNull();

        await expect(releaseTakeLeaseOnUnmount(false)).resolves.toBe(true); // navigated away; never listening
        await settle(60); // preparation would complete here

        expect(engine.startCalls, 'no recording on a page that is gone').toBe(0);
        expect(engine.initCalls, 'no engine prepared after the page went away').toBe(0);
        expect(intentApi.pendingRecordingIntent()).toBeNull();
        expect(outcome).toEqual(['rejected:RECORDING_INTENT_RETIRED:navigated']);
        expect(controller.getState()).toBe('IDLE');
        expect(lease.release).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY: unmount while an engine is MID-PREPARATION — it is terminated before the lease is released, and the model landing starts nothing', async () => {
        engine.downloadEnabled = false; // an engine exists and is parked waiting on its model
        const started = controller.startRecording(POLICY as never, []);
        const outcome: string[] = [];
        started.then(() => outcome.push('resolved'), (e: Error) => outcome.push(`rejected:${e.message}`));
        await settle();
        expect(engine.initCalls, 'precondition: an engine instance exists').toBeGreaterThanOrEqual(1);
        expect((controller as unknown as { service: unknown }).service, 'precondition: the service holds it').not.toBeNull();

        const terminatedBefore = engine.terminateCalls;
        let terminatedAtRelease = -1;
        lease.release.mockImplementation(async () => { terminatedAtRelease = engine.terminateCalls; });
        await expect(releaseTakeLeaseOnUnmount(false)).resolves.toBe(true);
        engine.downloadEnabled = true; // the model lands after the page has gone
        await settle(60);

        expect(engine.startCalls, 'no recording on a page that is gone').toBe(0);
        expect(outcome).toEqual(['rejected:RECORDING_INTENT_RETIRED:navigated']);
        expect((controller as unknown as { service: unknown }).service).toBeNull();
        expect(lease.release).toHaveBeenCalledTimes(1);
        expect(terminatedAtRelease, 'the preparing engine was terminated BEFORE the lease was released').toBeGreaterThan(terminatedBefore);
    });

    it('CASUALTY: a stop that REJECTS with the engine still live — the engine is destroyed, the Retry Save kept, and only then the lease released', async () => {
        const started = controller.startRecording(POLICY as never, []);
        await settle(60);
        await started;
        expect(controller.getState(), 'precondition: recording').toBe('RECORDING');
        const terminatedBefore = engine.terminateCalls;
        let terminatedAtRelease = -1;
        lease.release.mockImplementation(async () => { terminatedAtRelease = engine.terminateCalls; });
        const retry = { sessionId: 'sess-retry', marker: 'durable-retry-save' };
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = retry;
        vi.spyOn(controller, 'stopRecording').mockRejectedValueOnce(new Error('stop failed before shutdown'));

        await expect(releaseTakeLeaseOnUnmount(true)).resolves.toBe(true);

        expect(controller.getState()).toBe('IDLE');
        expect((controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry, 'the durable Retry Save survives').toBe(retry);
        expect(lease.release).toHaveBeenCalledTimes(1);
        expect(terminatedAtRelease, 'the live engine was terminated — not merely waited on — BEFORE the lease was released').toBeGreaterThan(terminatedBefore);
    });

    it('CASUALTY (PM pre-push RETURN 2): stop AND destroy both REJECT — the lease is KEPT and unconfirmed is reported, never "done"', async () => {
        const started = controller.startRecording(POLICY as never, []);
        await settle(60);
        await started;
        expect(controller.getState(), 'precondition: recording').toBe('RECORDING');
        const service = (controller as unknown as { service: { destroy: () => Promise<void> } }).service;
        expect(service, 'precondition: a live service').not.toBeNull();
        vi.spyOn(controller, 'stopRecording').mockRejectedValueOnce(new Error('stop failed before shutdown'));
        vi.spyOn(service, 'destroy').mockRejectedValueOnce(new Error('destroy failed: engine may still run'));

        await expect(releaseTakeLeaseOnUnmount(true)).resolves.toBe(false);

        expect(lease.release, 'another device stays blocked while this engine may run').not.toHaveBeenCalled();
        expect(useSessionStore.getState().sttStatus).toEqual({
            type: 'error',
            message: "SpeakSharp could not confirm the last recording stopped, so this tab still holds your account's recording. Reload or close this tab to end it, or start on another device and take over.",
        });
    });

    it('CASUALTY: termination that cannot be confirmed KEEPS the lease and says so — never reported as cleaned up', async () => {
        const started = controller.startRecording(POLICY as never, []);
        await settle(60);
        await started;
        expect(controller.getState()).toBe('RECORDING');
        engine.terminateHangs = true; // a wedged worker: destroy never completes
        vi.spyOn(controller, 'stopRecording').mockRejectedValueOnce(new Error('stop failed before shutdown'));
        vi.useFakeTimers({ shouldAdvanceTime: true });

        const unmounted = releaseTakeLeaseOnUnmount(true);
        await vi.advanceTimersByTimeAsync(25_000);
        await expect(unmounted).resolves.toBe(false);

        expect(lease.release, 'another device stays blocked while this engine may run').not.toHaveBeenCalled();
        expect(useSessionStore.getState().sttStatus).toEqual({
            type: 'error',
            message: "SpeakSharp could not confirm the last recording stopped, so this tab still holds your account's recording. Reload or close this tab to end it, or start on another device and take over.",
        });
    });

    it('CONTROL: an idle page releases at once, touching no engine', async () => {
        const terminatedBefore = engine.terminateCalls;
        await expect(releaseTakeLeaseOnUnmount(false)).resolves.toBe(true);
        expect(engine.terminateCalls).toBe(terminatedBefore);
        expect(lease.release).toHaveBeenCalledTimes(1);
    });
});
