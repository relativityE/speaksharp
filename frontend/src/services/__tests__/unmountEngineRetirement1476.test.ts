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
import React from 'react';
import { act, render } from '@testing-library/react';
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
// Read-only account/query boundaries for the actual lifecycle hook + MicCard probe below.
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ session: null, user: null }) }));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: null, isVerified: false }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(), getQueriesData: () => [] }) }));
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => ({ data: { can_start: true, subscription_status: 'free' } }) }));
vi.mock('@/hooks/useStreak', () => ({ useStreak: () => ({ updateStreak: vi.fn() }) }));
vi.mock('@/hooks/useUserFillerWords', () => ({ useUserFillerWords: () => ({ userFillerWords: [] }) }));
vi.mock('@/providers/useTranscriptionContext', () => ({ useTranscriptionContext: () => ({ runtimeState: useSessionStore((s) => s.runtimeState) }) }));
vi.mock('@/hooks/useSpeechRecognition', () => ({ useSpeechRecognition: () => ({
    transcript: { transcript: '', partial: '', total_words: 0, duration: 0, accuracy: 100 }, chunks: [], fillerData: {},
    isReady: false, modelLoadingProgress: null, mode: 'private', pauseMetrics: null, micLevel: 0, hasSpeechActivity: false,
}) }));
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
    public initGate: Promise<void> | null = null;

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
        if (this.initGate) await this.initGate;
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
    /** True models an engine whose stop REJECTS while it may still be running. */
    public stopRejects = false;
    async stop() {
        if (this.stopRejects) throw new Error('engine did not stop');
    }
    async resume() { /* no-op */ }
    async pause() { /* no-op */ }
    public terminateCalls = 0;
    /** True models an engine whose termination never completes (a wedged worker). */
    public terminateHangs = false;
    /** When set, termination waits on this promise (held, then resolved or rejected by the test). */
    public terminateGate: Promise<void> | null = null;
    async terminate() {
        this.terminateCalls += 1;
        if (this.terminateHangs) await new Promise(() => undefined);
        if (this.terminateGate) await this.terminateGate;
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
        // Wait on the precondition itself (a fixed number of ticks was too few on a slower CI runner).
        await vi.waitFor(() => expect(engine.initCalls, 'precondition: an engine instance exists').toBeGreaterThanOrEqual(1), { timeout: 5_000 });
        await settle();
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

    it.each(Array.from({ length: 5 }, (_, repeat) => (['initializing', 'download-required'] as const).map((phase) => ({ repeat, phase }))).flat())('case4 causal probe: $phase repetition $repeat publishes idle while its runtime still blocks Start', async ({ phase, repeat }) => {
        engine.downloadEnabled = false;
        // A real visit warms the page shell before its Start; retain that resolved infrastructure promise across return.
        await controller.warmUp('private');
        const initialCalls = engine.initCalls;
        let finishInit: () => void = () => undefined;
        if (phase === 'initializing') engine.initGate = new Promise<void>((resolve) => { finishInit = resolve; });
        const started = controller.startRecording(POLICY as never, []);
        void started.catch(() => undefined);
        await vi.waitFor(() => expect(engine.initCalls).toBeGreaterThan(initialCalls), { timeout: 5_000 });
        await settle();
        let finishTermination!: () => void;
        engine.terminateGate = new Promise<void>((resolve) => { finishTermination = resolve; });
        const retiring = releaseTakeLeaseOnUnmount(false);
        let unmountView: (() => void) | undefined;
        try {
            await vi.waitFor(() => expect(engine.terminateCalls).toBeGreaterThan(0));
            await settle();
            const beforeReturn = {
                model: document.documentElement.getAttribute('data-model-status'),
                controller: controller.getState(), runtime: useSessionStore.getState().runtimeState,
                finalizing: useSessionStore.getState().isTranscriptFinalizing,
                engineTerminal: controller.isEngineTerminal(),
            };
            // Returning mounts this warm-up path; it must not be mistaken for proof that retirement completed.
            await controller.warmUp('private');
            expect(document.documentElement.getAttribute('data-model-status')).toBe('idle');
            expect(beforeReturn).toEqual({ model: 'idle', controller: phase === 'initializing' ? 'ENGINE_INITIALIZING' : 'DOWNLOAD_REQUIRED', runtime: phase === 'initializing' ? 'ENGINE_INITIALIZING' : 'DOWNLOAD_REQUIRED', finalizing: false, engineTerminal: true });
            expect(['IDLE', 'READY', 'RECORDING', 'FAILED', 'FAILED_VISIBLE', 'TERMINATED']).not.toContain(useSessionStore.getState().runtimeState);
            const { useSessionLifecycle } = await import('@/hooks/useSessionLifecycle');
            const { MicCard } = await import('@/components/session/MicCard');
            const ReturnedCard = () => {
                const lifecycle = useSessionLifecycle();
                return React.createElement(MicCard, { onStart: () => undefined, privateModelStatus: lifecycle.privateModelStatus, disabled: lifecycle.isButtonDisabled });
            };
            const view = render(React.createElement(ReturnedCard));
            unmountView = view.unmount;
            expect(view.getByTestId('mic-card').getAttribute('data-model-status')).toBe('idle');
            expect(view.getByTestId('mic-start').getAttribute('aria-label')).toBe('Start recording');
            expect((view.getByTestId('mic-start') as HTMLButtonElement).disabled).toBe(true);
            expect(view.getByTestId('mic-status-row').textContent).toContain('Mic ready on this device');
            if (repeat === 0) {
                // The live caller waits two seconds after model idle before navigating back; this signature survives it.
                await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
            }
            expect((view.getByTestId('mic-start') as HTMLButtonElement).disabled).toBe(true);
        } finally {
            await act(async () => {
                finishTermination();
                finishInit();
                await retiring;
                await settle();
            });
        }
        expect(controller.getState()).toBe('IDLE');
        expect(useSessionStore.getState().runtimeState).toBe('IDLE');
        expect(controller.isEngineTerminal()).toBe(true);
        expect((document.querySelector('[data-testid="mic-start"]') as HTMLButtonElement).disabled).toBe(false);
        unmountView?.();
    });

    it.each(['initializing', 'download-required'] as const)('case4 causal timeout: %s remains blocked even AFTER late termination succeeds', async (phase) => {
        engine.downloadEnabled = false;
        await controller.warmUp('private');
        const initialCalls = engine.initCalls;
        let finishInit: () => void = () => undefined;
        if (phase === 'initializing') engine.initGate = new Promise<void>((resolve) => { finishInit = resolve; });
        const started = controller.startRecording(POLICY as never, []);
        void started.catch(() => undefined);
        await vi.waitFor(() => expect(engine.initCalls).toBeGreaterThan(initialCalls));
        await settle();
        let finishTermination!: () => void;
        engine.terminateGate = new Promise<void>((resolve) => { finishTermination = resolve; });
        // The production default is 10s. Scale only the explicit bound, not any lifecycle state or cleanup result.
        expect(await controller.retireEngineForUnmount(100)).toBe('unconfirmed');
        const stuckState = phase === 'initializing' ? 'ENGINE_INITIALIZING' : 'DOWNLOAD_REQUIRED';
        expect(controller.getState()).toBe(stuckState);
        finishTermination();
        finishInit();
        await settle(60);
        expect(document.documentElement.getAttribute('data-model-status')).toBe('idle');
        expect((controller as unknown as { service: unknown }).service).toBeNull();
        expect(controller.getState(), 'late successful destruction has no continuation to finish retirement').toBe(stuckState);
        expect(useSessionStore.getState().runtimeState).toBe(stuckState);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false);
        await controller.warmUp('private');
        expect(controller.getState(), 'cached infrastructure readiness plus no service makes return warmUp a no-op').toBe(stuckState);
        const { useSessionLifecycle } = await import('@/hooks/useSessionLifecycle');
        const { MicCard } = await import('@/components/session/MicCard');
        const ReturnedCard = () => {
            const lifecycle = useSessionLifecycle();
            return React.createElement(MicCard, { onStart: () => undefined, privateModelStatus: lifecycle.privateModelStatus, disabled: lifecycle.isButtonDisabled });
        };
        const view = render(React.createElement(ReturnedCard));
        expect((view.getByTestId('mic-start') as HTMLButtonElement).disabled).toBe(true);
        expect(view.getByTestId('mic-status-row').textContent).toContain('Mic ready on this device');
        await act(async () => { await controller.hardResetAwaited('case4-probe-control'); });
        expect(controller.getState()).toBe('IDLE');
        expect((view.getByTestId('mic-start') as HTMLButtonElement).disabled, 'a real lifecycle reset clears this reproduced gate').toBe(false);
        view.unmount();
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

    it('isEngineTerminal (Codex P1 on c4fd77b2): false while a real engine records, true once it is torn down', async () => {
        expect(controller.isEngineTerminal(), 'no service yet').toBe(true);
        const started = controller.startRecording(POLICY as never, []);
        await settle(60);
        await started;
        expect(controller.getState()).toBe('RECORDING');
        expect(controller.isEngineTerminal(), 'a recording engine is not terminal').toBe(false);
        await expect(releaseTakeLeaseOnUnmount(true)).resolves.toBe(true);
        expect(controller.isEngineTerminal()).toBe(true);
    });

    it('PM RETURN (real service): FAILED → destroy() with strategy.terminate() HELD past a poll — the early FSM TERMINATED is NOT "engine off"', async () => {
        const started = controller.startRecording(POLICY as never, []);
        await settle(60);
        await started;
        const svc = (controller as unknown as { service: { destroy: () => Promise<void>; isServiceDestroyed: () => boolean; fsm: { transition: (e: unknown) => void } } }).service;
        let finishTermination: () => void = () => undefined;
        engine.terminateGate = new Promise<void>((resolve) => { finishTermination = resolve; });
        svc.fsm.transition({ type: 'ERROR_OCCURRED', error: new Error('STT_HEARTBEAT_FAILURE') }); // the take FAILS
        const destroying = svc.destroy(); // then the failure path destroys it: FAILED → TERMINATED at once
        await settle();
        expect(svc.isServiceDestroyed(), 'the FSM already says TERMINATED (the early state PM identified)').toBe(true);
        expect(controller.isEngineTerminal(), 'but the engine is still terminating').toBe(false);
        await new Promise((r) => setTimeout(r, 300)); // longer than one lifecycle poll
        expect(controller.isEngineTerminal()).toBe(false);
        finishTermination();
        await destroying;
        expect(controller.isEngineTerminal(), 'proven done once termination resolved').toBe(true);
    });

    it('PM RETURN (real service): a termination that REJECTS stays unconfirmed — the unmount keeps the lease and says so', async () => {
        const started = controller.startRecording(POLICY as never, []);
        await settle(60);
        await started;
        engine.terminateGate = Promise.reject(new Error('worker would not terminate'));
        engine.terminateGate.catch(() => undefined);
        vi.spyOn(controller, 'stopRecording').mockRejectedValueOnce(new Error('stop failed before shutdown'));
        await expect(releaseTakeLeaseOnUnmount(true)).resolves.toBe(false);
        expect(controller.isEngineTerminal()).toBe(false);
        expect(lease.release, 'another device stays blocked').not.toHaveBeenCalled();
    });

    const recordNow = async () => {
        const started = controller.startRecording(POLICY as never, []);
        await settle(60);
        await started;
        expect(controller.getState()).toBe('RECORDING');
    };

    it('PM RETURN (real service): an ORDINARY Stop proves the engine off', async () => {
        await recordNow();
        await controller.stopRecording();
        await settle();
        expect(controller.isEngineTerminal()).toBe(true);
    });

    it('PM RETURN (real service) CONTROL: failed engine STOP → the failure path\'s destroy terminates successfully → PROVEN off; Retry Save untouched', async () => {
        await recordNow();
        engine.stopRejects = true;
        const retry = { sessionId: 'sess-retry', marker: 'durable-retry-save' };
        const before = engine.terminateCalls;
        await controller.stopRecording();
        await settle();
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = retry;
        expect(engine.terminateCalls - before, 'proved by an awaited, successful termination').toBeGreaterThanOrEqual(1);
        expect(controller.isEngineTerminal()).toBe(true);
        await expect(controller.confirmEngineShutdown(2_000)).resolves.toBe('terminal');
        expect((controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry).toBe(retry);
    });

    it('PM RETURN (real service): failed engine STOP, then termination REJECTS — never "off"; the lease must be kept', async () => {
        await recordNow();
        engine.stopRejects = true;
        engine.terminateGate = Promise.reject(new Error('worker would not terminate'));
        engine.terminateGate.catch(() => undefined);
        await controller.stopRecording();
        await settle();
        expect(controller.isEngineTerminal(), 'a failed stop plus a failed termination is not a stopped engine').toBe(false);
        await expect(controller.confirmEngineShutdown(2_000)).resolves.toBe('unconfirmed');
    });

    it('PM RETURN (real service): failed engine STOP, then termination HANGS — unconfirmed within the bound', async () => {
        await recordNow();
        engine.stopRejects = true;
        engine.terminateHangs = true;
        void controller.stopRecording(); // may itself wait on the hung termination
        await settle();
        expect(controller.isEngineTerminal()).toBe(false);
        await expect(controller.confirmEngineShutdown(300)).resolves.toBe('unconfirmed');
    });

    it('confirmEngineShutdown\'s OWN bounded destroy: an attached, unconfirmed engine whose termination hangs is unconfirmed, never "proven"', async () => {
        await recordNow(); // attached and registered: not yet proven stopped
        engine.terminateHangs = true;
        await expect(controller.confirmEngineShutdown(300)).resolves.toBe('unconfirmed');
        expect(controller.isEngineTerminal()).toBe(false);
    });

    it('CONTROL: an idle page releases at once, touching no engine', async () => {
        const terminatedBefore = engine.terminateCalls;
        await expect(releaseTakeLeaseOnUnmount(false)).resolves.toBe(true);
        expect(engine.terminateCalls).toBe(terminatedBefore);
        expect(lease.release).toHaveBeenCalledTimes(1);
    });
});
