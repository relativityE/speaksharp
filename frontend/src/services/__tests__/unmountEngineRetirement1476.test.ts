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
const lease = vi.hoisted(() => ({ release: vi.fn(async () => undefined), id: null as string | null }));
vi.mock('../recordingLease', () => ({
    acquireTakeLease: vi.fn(async () => ({ action: 'start', tookOver: false })),
    confirmTakeLease: vi.fn(async () => 'held'),
    startLeaseHeartbeat: vi.fn(),
    releaseTakeLease: () => lease.release(),
    currentTakeLeaseId: () => lease.id,
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
    /** When set, the engine's stop waits on this promise (held, then released by the test). */
    public stopGate: Promise<void> | null = null;
    async stop() {
        if (this.stopGate) await this.stopGate;
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
    afterEach(() => { vi.clearAllMocks(); lease.release.mockImplementation(async () => undefined); lease.id = null; vi.useRealTimers(); });

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

    /** A Start parked in `phase`, then a bounded retirement whose termination is held past the bound. */
    const timedOutRetirement = async (phase: 'initializing' | 'download-required', onLateTerminal?: () => void) => {
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
        let failTermination!: (e: Error) => void;
        engine.terminateGate = new Promise<void>((resolve, reject) => { finishTermination = resolve; failTermination = reject; });
        // The production default is 10s. Scale only the explicit bound, not any lifecycle state or cleanup result.
        expect(await controller.retireEngineForUnmount(100, onLateTerminal)).toBe('unconfirmed');
        const preparing = phase === 'initializing' ? 'ENGINE_INITIALIZING' : 'DOWNLOAD_REQUIRED';
        expect(controller.getState(), 'cleanup is incomplete: the Start stays truthfully blocked').toBe(preparing);
        return { preparing, finishTermination, failTermination, finishInit };
    };
    const renderReturnedCard = async () => {
        const { useSessionLifecycle } = await import('@/hooks/useSessionLifecycle');
        const { MicCard } = await import('@/components/session/MicCard');
        const ReturnedCard = () => {
            const lifecycle = useSessionLifecycle();
            return React.createElement(MicCard, { onStart: () => undefined, privateModelStatus: lifecycle.privateModelStatus, disabled: lifecycle.isButtonDisabled });
        };
        return render(React.createElement(ReturnedCard));
    };

    it.each(['initializing', 'download-required'] as const)('case4 (CLI 0ae7573b): %s — a retirement that timed out then SUCCEEDED completes; Start re-enables', async (phase) => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement(phase, onLateTerminal);
        expect(onLateTerminal).not.toHaveBeenCalled();
        t.finishTermination();
        t.finishInit();
        await settle(60);
        expect(controller.isEngineTerminal()).toBe(true);
        expect(controller.getState(), 'the late success finishes THIS retirement').toBe('IDLE');
        expect(useSessionStore.getState().runtimeState).toBe('IDLE');
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false);
        expect(onLateTerminal).toHaveBeenCalledTimes(1);
        await controller.warmUp('private');
        const view = await renderReturnedCard();
        expect((view.getByTestId('mic-start') as HTMLButtonElement).disabled, 'no forced enable: the runtime is genuinely IDLE').toBe(false);
        view.unmount();
    });

    it.each(['initializing', 'download-required'] as const)('case4 (Sam RETURN on 77780845): %s — the engine\'s ACTUAL late termination rejection, caught inside destroy(), completes nothing', async (phase) => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement(phase, onLateTerminal);
        lease.id = null;
        t.failTermination(new Error('worker would not terminate'));
        t.finishInit();
        await settle(60);
        // destroy() resolved (its catch) and the preparing engine was never in the live-engine registry — neither is proof.
        expect(controller.getState(), 'no affirmative termination: Start stays blocked').toBe(t.preparing);
        expect(useSessionStore.getState().runtimeState).toBe(t.preparing);
        expect(onLateTerminal, 'no lease release on a rejected termination').not.toHaveBeenCalled();
    });

    it('Codex P2 r4315983017 (#1668): a NORMAL stop is affirmative proof — a later redundant terminate() that rejects does not erase it', async () => {
        engine.modelCached = true;
        await controller.startRecording(POLICY as never, []);
        await vi.waitFor(() => expect(controller.getState()).toBe('RECORDING'), { timeout: 5_000 });
        const svc = (controller as unknown as { service: { stopTranscription: () => Promise<unknown>; destroy: () => Promise<void>; didConfirmTermination: () => boolean } }).service;
        expect(svc.didConfirmTermination(), 'a running engine is not proven off').toBe(false);
        await svc.stopTranscription();
        expect(svc.didConfirmTermination(), 'the normal stop proved it off').toBe(true);
        engine.terminateGate = Promise.reject(new Error('redundant terminate failed'));
        engine.terminateGate.catch(() => undefined);
        await svc.destroy();
        expect(svc.didConfirmTermination(), 'the caught redundant rejection does not erase the stop proof').toBe(true);
        expect(controller.isEngineTerminal()).toBe(true);
    });

    it('Sam (#1668): the stop proof is bound to its engine generation — preparing a successor strategy on the same service clears it', async () => {
        engine.modelCached = true;
        await controller.startRecording(POLICY as never, []);
        await vi.waitFor(() => expect(controller.getState()).toBe('RECORDING'), { timeout: 5_000 });
        const svc = (controller as unknown as { service: { stopTranscription: () => Promise<unknown>; didConfirmTermination: () => boolean; initializeStrategy: (m: string) => Promise<void> } }).service;
        await svc.stopTranscription();
        expect(svc.didConfirmTermination()).toBe(true);
        engine.initGate = new Promise<void>(() => undefined); // the successor stays preparing
        let prepError: unknown = null;
        void svc.initializeStrategy('private').catch((e: unknown) => { prepError = e; });
        await settle();
        expect(prepError, 'the successor preparation itself ran').toBeNull();
        await vi.waitFor(() => expect(svc.didConfirmTermination(), 'a preparing successor is not proven off by the earlier stop').toBe(false));
    });

    describe('Sam (#1668 advisory): resetEphemeralState\'s delayed termination acts only for its own engine epoch', () => {
        type Svc = { resetEphemeralState: () => void; didConfirmTermination: () => boolean; initializeStrategy: (m: string) => Promise<void> };
        const recordingService = async (): Promise<Svc> => {
            engine.modelCached = true;
            await controller.startRecording(POLICY as never, []);
            await vi.waitFor(() => expect(controller.getState()).toBe('RECORDING'), { timeout: 5_000 });
            return (controller as unknown as { service: Svc }).service;
        };

        it('no successor: the late termination clears the entry and proves the engine off', async () => {
            const svc = await recordingService();
            let finish!: () => void;
            engine.terminateGate = new Promise<void>((resolve) => { finish = resolve; });
            svc.resetEphemeralState();
            expect(controller.isEngineTerminal(), 'still terminating').toBe(false);
            const epochBefore = (svc as unknown as { engineEpoch: number }).engineEpoch;
            finish();
            await settle();
            expect((svc as unknown as { engineEpoch: number }).engineEpoch, 'no successor prepared').toBe(epochBefore);
            expect(controller.isEngineTerminal(), 'entry cleared').toBe(true);
            expect(svc.didConfirmTermination(), 'proof published').toBe(true);
        });

        it('a successor prepared meanwhile: the old engine\'s late success neither clears the live entry nor vouches for it', async () => {
            const svc = await recordingService();
            let finish!: () => void;
            engine.terminateGate = new Promise<void>((resolve) => { finish = resolve; });
            svc.resetEphemeralState();
            engine.initGate = new Promise<void>(() => undefined);
            void svc.initializeStrategy('private').catch(() => undefined); // the successor's epoch
            await settle();
            finish();
            await settle();
            expect(controller.isEngineTerminal(), 'the entry is not cleared on the successor\'s behalf').toBe(false);
            expect(svc.didConfirmTermination()).toBe(false);
        });

        it('a successor prepared meanwhile and the old termination REJECTS: nothing is proven for the successor', async () => {
            const svc = await recordingService();
            let fail!: (e: Error) => void;
            engine.terminateGate = new Promise<void>((_, reject) => { fail = reject; });
            engine.terminateGate.catch(() => undefined);
            svc.resetEphemeralState();
            engine.initGate = new Promise<void>(() => undefined);
            void svc.initializeStrategy('private').catch(() => undefined);
            await settle();
            fail(new Error('old worker would not terminate'));
            await settle();
            expect(svc.didConfirmTermination()).toBe(false);
            expect(controller.isEngineTerminal()).toBe(false);
        });
    });

    it('case4: an IN-BOUND termination rejection of a preparing engine is not "terminal" either — the lease is kept', async () => {
        engine.downloadEnabled = false;
        await controller.warmUp('private');
        const initialCalls = engine.initCalls;
        engine.initGate = new Promise<void>(() => undefined);
        void controller.startRecording(POLICY as never, []).catch(() => undefined);
        await vi.waitFor(() => expect(engine.initCalls).toBeGreaterThan(initialCalls));
        await settle();
        engine.terminateGate = Promise.reject(new Error('worker would not terminate'));
        engine.terminateGate.catch(() => undefined);
        expect(await controller.retireEngineForUnmount(5_000)).toBe('unconfirmed');
    });

    it('case4: a destroy() that later REJECTS never claims cleanup — runtime stays blocked, no late completion', async () => {
        // Same proof as the in-bound path: only a destroy() that RESOLVED with the engine registry confirming the stop
        // completes a retirement. (A preparing engine that never ran is already "off" in that registry.)
        engine.downloadEnabled = false;
        await controller.warmUp('private');
        const initialCalls = engine.initCalls;
        engine.initGate = new Promise<void>(() => undefined);
        void controller.startRecording(POLICY as never, []).catch(() => undefined);
        await vi.waitFor(() => expect(engine.initCalls).toBeGreaterThan(initialCalls));
        await settle();
        const svc = (controller as unknown as { service: { destroy: () => Promise<void> } }).service;
        let reject!: (e: Error) => void;
        vi.spyOn(svc, 'destroy').mockImplementation(() => new Promise<void>((_, r) => { reject = r; }));
        const onLateTerminal = vi.fn();
        expect(await controller.retireEngineForUnmount(100, onLateTerminal)).toBe('unconfirmed');
        reject(new Error('destroy failed'));
        await settle(60);
        expect(controller.getState()).toBe('ENGINE_INITIALIZING');
        expect(onLateTerminal).not.toHaveBeenCalled();
    });

    it('case4: a termination that is STILL hung completes nothing', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        await settle(60);
        expect(controller.getState()).toBe(t.preparing);
        expect(onLateTerminal).not.toHaveBeenCalled();
        t.finishTermination();
        await settle(60);
    });

    it('case4: a SUPERSEDED retirement (hard reset since) never completes over its successor', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('initializing', onLateTerminal);
        await controller.hardResetAwaited('case4-successor');
        const transitions: string[] = [];
        const unsubscribe = useSessionStore.subscribe((s, prev) => { if (s.runtimeState !== prev.runtimeState) transitions.push(s.runtimeState); });
        t.finishTermination();
        t.finishInit();
        await settle(60);
        unsubscribe();
        expect(onLateTerminal, 'the reset owns the page now').not.toHaveBeenCalled();
        expect(transitions, 'no stale TERMINATED/IDLE from the superseded retirement').toEqual([]);
    });

    /**
     * Codex P2 r4317105661 (#1668, Sam 1792438537): `transition()` awaits, so a hard reset or a successor Start can take the
     * runtime BETWEEN the late retirement's TERMINATED and IDLE. Interleave exactly there and require that the stale
     * retirement publishes nothing after it, and never calls back for a take it no longer owns.
     */
    const interleaveAfterLateTerminated = (successor: () => Promise<void>) => {
        const ctl = controller as unknown as { transition: (state: string, ...rest: unknown[]) => Promise<void> };
        const original = ctl.transition.bind(controller);
        let armed = true;
        const seen: string[] = [];
        vi.spyOn(ctl, 'transition').mockImplementation(async (state: string, ...rest: unknown[]) => {
            await original(state, ...rest);
            seen.push(state);
            if (state === 'TERMINATED' && armed) { armed = false; await successor(); }
        });
        return seen;
    };

    it('Codex P2 r4317105661: a hard reset + successor Start inside the late TERMINATED→IDLE window keeps the successor\'s state', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('initializing', onLateTerminal);
        engine.initGate = new Promise<void>(() => undefined); // the successor parks in its own preparation
        let successorState = '';
        interleaveAfterLateTerminated(async () => {
            await controller.hardResetAwaited('p2-successor');
            void controller.startRecording(POLICY as never, []).catch(() => undefined);
            await vi.waitFor(() => expect(['INITIATING', 'ENGINE_INITIALIZING', 'DOWNLOAD_REQUIRED']).toContain(controller.getState()));
            successorState = controller.getState();
        });
        t.finishTermination();
        await settle(60);
        expect(successorState, 'the successor really started inside the window').not.toBe('');
        expect(controller.getState(), 'the stale retirement never publishes IDLE over the successor').toBe(successorState);
        expect(useSessionStore.getState().runtimeState).toBe(successorState);
        expect(onLateTerminal, 'no lease callback for a take the retirement no longer owns').not.toHaveBeenCalled();
    });

    it('Codex P2 r4317105661: a successor that only ATTACHES a service in the window (same lifecycle version) is still respected', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        const ctl = controller as unknown as { serviceGeneration: number };
        const seen = interleaveAfterLateTerminated(async () => { ctl.serviceGeneration += 1; });
        t.finishTermination();
        await settle(60);
        expect(seen, 'the retirement stopped after TERMINATED').toEqual(['TERMINATED']);
        expect(onLateTerminal).not.toHaveBeenCalled();
    });

    it('Codex P2 r4317105661: with the owner UNCHANGED through the window, the late retirement still completes to IDLE', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        const seen = interleaveAfterLateTerminated(async () => { await settle(5); });
        t.finishTermination();
        await settle(60);
        expect(seen.slice(seen.indexOf('TERMINATED')), 'the retirement still completes both transitions').toEqual(['TERMINATED', 'IDLE']);
        expect(controller.getState()).toBe('IDLE');
        expect(onLateTerminal).toHaveBeenCalledTimes(1);
    });

    /**
     * Main-path ownership (Sam 1792445123, separate from #1668's late path): `retireEngineForUnmount` awaits the retired
     * service's destroy() for up to its bound. A returning page can start successor B through the real controller in that
     * window; when A's destroy then resolves, the retirement must not set engine readiness, TERMINATED or IDLE over B,
     * and A's receipt speaks only for A's own engine.
     */
    const preparingRetiree = async () => {
        engine.downloadEnabled = false;
        await controller.warmUp('private');
        const before = engine.initCalls;
        engine.initGate = new Promise<void>(() => undefined); // A parks in its own preparation
        void controller.startRecording(POLICY as never, []).catch(() => undefined);
        await vi.waitFor(() => expect(engine.initCalls).toBeGreaterThan(before), { timeout: 5_000 });
        await settle();
        let finishTermination!: () => void;
        let failTermination!: (e: Error) => void;
        engine.terminateGate = new Promise<void>((resolve, reject) => { finishTermination = resolve; failTermination = reject; });
        const retiring = controller.retireEngineForUnmount(10_000); // A's destroy is HELD inside the bound
        await settle();
        const ctl = controller as unknown as { service: unknown; serviceGeneration: number };
        expect(ctl.service, 'A was detached before its destroy').toBeNull();
        return { retiring, generationAtRetire: ctl.serviceGeneration, finishTermination, failTermination };
    };
    /** Successor B through the real controller: a hard reset (as take-over/sign-out does), then a Start that attaches B. */
    const resetThenStartSuccessor = async () => {
        await controller.hardResetAwaited('main-path-successor');
        await settle();
        engine.terminateGate = null; // A's destroy already holds ITS gate; B has none of its own
        engine.initGate = new Promise<void>(() => undefined); // B parks in its own preparation
        void controller.startRecording(POLICY as never, []).catch(() => undefined);
        const ctl = controller as unknown as { service: unknown; serviceGeneration: number };
        // B is real only when the controller attached B's own service through its Start. While A's termination is still
        // held, the destroy-before-create gate refuses B's engine and B fails VISIBLY: that state is B's, and it is what a
        // stale retirement must not overwrite.
        await vi.waitFor(() => expect(ctl.service, 'B attached its own service').not.toBeNull(), { timeout: 5_000 });
        await settle(30);
        return { state: controller.getState(), service: ctl.service, generation: ctl.serviceGeneration };
    };
    const recordTransitions = () => {
        const seen: string[] = [];
        const unsubscribe = useSessionStore.subscribe((s, prev) => { if (s.runtimeState !== prev.runtimeState) seen.push(s.runtimeState); });
        return { seen, unsubscribe };
    };

    it('main path (Sam 1792445123): successor B (reset, then a real Start that attaches B) during A\'s held destroy keeps its runtime', async () => {
        const a = await preparingRetiree();
        const b = await resetThenStartSuccessor();
        expect(b.service, 'precondition: B attached its own service in the window').not.toBeNull();
        // The service object is a shared instance; ownership is the controller's attachment generation.
        expect(b.generation, 'precondition: B\'s attachment is newer than A\'s retirement').toBeGreaterThan(a.generationAtRetire);
        const t = recordTransitions();
        a.finishTermination();
        const outcome = await a.retiring;
        await settle(30);
        t.unsubscribe();
        expect(t.seen, 'the stale retirement publishes nothing over B').toEqual([]);
        expect(controller.getState()).toBe(b.state);
        expect(useSessionStore.getState().runtimeState).toBe(b.state);
        expect((controller as unknown as { service: unknown }).service, 'B keeps its service').toBe(b.service);
        expect(outcome, 'A\'s own engine was proven off').toBe('terminal');
    });

    it('main path (characterization): WITHOUT a reset, a Start or warm-up during A\'s held destroy attaches no successor service', async () => {
        const a = await preparingRetiree();
        const ctl = controller as unknown as { service: unknown; serviceGeneration: number; lifecycleVersion: number };
        const generation = ctl.serviceGeneration;
        const version = ctl.lifecycleVersion;
        const before = engine.initCalls;
        await controller.startRecording(POLICY as never, []).catch(() => undefined);
        await controller.warmUp('private').catch(() => undefined);
        await settle(30);
        // The runtime still shows A's preparation, so the controller does not attach a second service in this window:
        // same-lifecycle attachment is not reachable here, and the version/generation guard covers it regardless.
        expect(ctl.service).toBeNull();
        expect(ctl.serviceGeneration).toBe(generation);
        expect(ctl.lifecycleVersion).toBe(version);
        expect(engine.initCalls).toBe(before);
        a.finishTermination();
        await a.retiring;
    });

    it('main path (Sam 1792445123): a HARD RESET during A\'s held destroy is never followed by A\'s TERMINATED/IDLE', async () => {
        const a = await preparingRetiree();
        await controller.hardResetAwaited('main-path-successor');
        await settle();
        const afterReset = controller.getState();
        const t = recordTransitions();
        a.finishTermination();
        await a.retiring;
        await settle(30);
        t.unsubscribe();
        expect(t.seen, 'no stale TERMINATED/IDLE after the reset owns the runtime').toEqual([]);
        expect(controller.getState()).toBe(afterReset);
    });

    it('main path (Sam 1792445123): with the owner UNCHANGED through A\'s held destroy, the retirement still completes', async () => {
        const a = await preparingRetiree();
        const t = recordTransitions();
        a.finishTermination();
        const outcome = await a.retiring;
        await settle(30);
        t.unsubscribe();
        expect(t.seen.slice(t.seen.indexOf('TERMINATED')), 'TERMINATED then IDLE').toEqual(['TERMINATED', 'IDLE']);
        expect(controller.getState()).toBe('IDLE');
        expect(outcome).toBe('terminal');
    });

    it('main path (Sam 1792445123): a REJECTED held destroy stays unconfirmed even when a successor attached meanwhile', async () => {
        const a = await preparingRetiree();
        const b = await resetThenStartSuccessor();
        a.failTermination(new Error('worker would not terminate'));
        const outcome = await a.retiring;
        await settle(30);
        expect(outcome, 'a rejected termination is never proof').toBe('unconfirmed');
        expect(controller.getState(), 'B is untouched either way').toBe(b.state);
        expect((controller as unknown as { service: unknown }).service).toBe(b.service);
    });

    it('case4: the hook releases the take\'s lease on late proof — only while that take still owns it', async () => {
        const store = () => useSessionStore.getState();
        const retire = vi.spyOn(controller, 'retireEngineForUnmount');
        let late: (() => void) | undefined;
        retire.mockImplementation(async (_bound?: number, onLate?: () => void) => { late = onLate; return 'unconfirmed'; });
        lease.id = 'take-A';
        await expect(releaseTakeLeaseOnUnmount(false)).resolves.toBe(false);
        expect(lease.release).not.toHaveBeenCalled();
        expect(store().sttStatus.type).toBe('error');
        late?.();
        expect(lease.release, 'proven off later: this take\'s lease is released').toHaveBeenCalledTimes(1);
        expect(store().sttStatus.type, 'its own "could not confirm" status is withdrawn').toBe('idle');
        // A newer take owns the lease when the proof arrives: nothing of the newer take is touched.
        lease.release.mockClear();
        await expect(releaseTakeLeaseOnUnmount(false)).resolves.toBe(false);
        lease.id = 'take-B';
        store().setSTTStatus({ type: 'error', message: 'a newer problem' });
        late?.();
        expect(lease.release).not.toHaveBeenCalled();
        expect(store().sttStatus.message).toBe('a newer problem');
        retire.mockRestore();
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

    /**
     * Codex P1 r4320483450 (Sam FIX NOW 1792459463): a retirement that began from an ACTIVE take. The bounded stop and the
     * destroy both exceed the bound; the lifecycle bump cancels the stop's continuation, so the runtime is left in the active
     * state it retired. A later affirmative destroy must finish THAT retirement exactly once (TERMINATED → IDLE, lease
     * callback), keep the durable Retry Save, and never act for a successor.
     *  - `recording`: the real stop path runs and its engine stop never settles (left STOPPING);
     *  - `failed`: a failure state still holding the engine whose stop is wedged in the queue (left FAILED).
     */
    const timedOutActiveRetirement = async (from: 'recording' | 'failed', onLateTerminal: () => void) => {
        engine.modelCached = true;
        await controller.startRecording(POLICY as never, []);
        await vi.waitFor(() => expect(controller.getState()).toBe('RECORDING'), { timeout: 5_000 });
        const ctl = controller as unknown as { service: { stopTranscription: () => Promise<unknown> }; state: string; pendingFullSaveRetry: unknown; lifecycleVersion: number; serviceGeneration: number };
        const svc = ctl.service;
        if (from === 'recording') {
            vi.spyOn(svc, 'stopTranscription').mockImplementation(() => new Promise(() => undefined));
        } else {
            ctl.state = 'FAILED';
            vi.spyOn(controller, 'stopRecording').mockImplementation(() => new Promise(() => undefined));
        }
        const retry = { sessionId: 'sess-retry', marker: 'durable-retry-save' };
        ctl.pendingFullSaveRetry = retry;
        let finishTermination!: () => void;
        engine.terminateGate = new Promise<void>((resolve) => { finishTermination = resolve; });
        expect(await controller.retireEngineForUnmount(100, onLateTerminal)).toBe('unconfirmed');
        const stranded = controller.getState();
        expect(stranded, 'cleanup is incomplete: the retired active state is held').toBe(from === 'recording' ? 'STOPPING' : 'FAILED');
        expect(onLateTerminal).not.toHaveBeenCalled();
        const retirement = { version: ctl.lifecycleVersion, generation: ctl.serviceGeneration };
        return { ctl, svc, retry, retirement, stranded, finishTermination };
    };

    it.each(['recording', 'failed'] as const)('Codex P1 r4320483450: %s — stop AND destroy timed out; the late destroy success completes once and keeps the Retry Save', async (from) => {
        const onLateTerminal = vi.fn();
        const t = await timedOutActiveRetirement(from, onLateTerminal);
        t.finishTermination();
        await settle(60);
        expect(controller.isEngineTerminal()).toBe(true);
        expect(controller.getState(), `the late success finishes THIS retirement (was ${t.stranded})`).toBe('IDLE');
        expect(useSessionStore.getState().runtimeState).toBe('IDLE');
        expect(onLateTerminal, 'the owned lease is released exactly once, after the engine is proven off').toHaveBeenCalledTimes(1);
        expect(t.ctl.pendingFullSaveRetry, 'the durable Retry Save survives the completion').toBe(t.retry);
    });

    it('Codex P1 r4320483450: a DUPLICATE late proof for the same retirement publishes nothing and calls back no second time', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutActiveRetirement('recording', onLateTerminal);
        t.finishTermination();
        await settle(60);
        expect(onLateTerminal).toHaveBeenCalledTimes(1);
        const transitions: string[] = [];
        const unsubscribe = useSessionStore.subscribe((s, prev) => { if (s.runtimeState !== prev.runtimeState) transitions.push(s.runtimeState); });
        const late = controller as unknown as { completeLateRetirement: (r: { version: number; generation: number }, svc: unknown, cb: () => void) => Promise<void> };
        await late.completeLateRetirement(t.retirement, t.svc, onLateTerminal);
        await settle(10);
        unsubscribe();
        expect(transitions, 'an already-completed retirement republishes nothing').toEqual([]);
        expect(controller.getState()).toBe('IDLE');
        expect(onLateTerminal).toHaveBeenCalledTimes(1);
        expect(t.ctl.pendingFullSaveRetry).toBe(t.retry);
    });

    it('Codex P1 r4320483450: a HARD RESET (lifecycle changed) during the held destroy is never followed by the active retirement\'s TERMINATED/IDLE or callback', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutActiveRetirement('recording', onLateTerminal);
        await controller.hardResetAwaited('p1-successor');
        const transitions: string[] = [];
        const unsubscribe = useSessionStore.subscribe((s, prev) => { if (s.runtimeState !== prev.runtimeState) transitions.push(s.runtimeState); });
        t.finishTermination();
        await settle(60);
        unsubscribe();
        expect(onLateTerminal, 'the reset owns the page now').not.toHaveBeenCalled();
        expect(transitions, 'no stale TERMINATED/IDLE from the superseded retirement').toEqual([]);
    });

    it('Codex P1 r4320483450: a successor ENGINE attached since the retirement (generation changed) is respected — nothing published, no callback', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutActiveRetirement('recording', onLateTerminal);
        t.ctl.serviceGeneration += 1;
        const transitions: string[] = [];
        const unsubscribe = useSessionStore.subscribe((s, prev) => { if (s.runtimeState !== prev.runtimeState) transitions.push(s.runtimeState); });
        t.finishTermination();
        await settle(60);
        unsubscribe();
        expect(transitions).toEqual([]);
        expect(controller.getState(), 'the retirement no longer owns the runtime').toBe(t.stranded);
        expect(onLateTerminal).not.toHaveBeenCalled();
        expect(t.ctl.pendingFullSaveRetry).toBe(t.retry);
    });

    /**
     * Codex P2 r4320680220 (Sam SOURCE RETURN 1792461197, scope 1792462026/1792462080/1792462096): a successor Start is
     * ACCEPTED synchronously — selection lock and intent minted — before any queued work attaches a service. While a
     * retirement that detached the service is still settling, that accepted Start must neither vanish (absorbed by the
     * retired take's stale state) nor be retired by the retirement's TERMINATED. It waits — bounded — then proceeds from the
     * truthful state the retirement settled to, or is refused truthfully and retryably; nothing is launched before the old
     * engine is affirmatively off. The retired take never regains lease authority once any Start was accepted.
     */
    const acceptSuccessor = () => {
        const ctl = controller as unknown as { service: unknown; engineSelectionIntentLocked: boolean };
        let outcome = 'pending';
        void controller.startRecording(POLICY as never, []).then(() => { outcome = 'resolved'; }, (e: Error) => { outcome = `rejected:${e.message}`; });
        return { ctl, intent: intentApi.pendingRecordingIntent(), locked: ctl.engineSelectionIntentLocked, outcome: () => outcome };
    };
    /** Records every transition() call; runs `before` just BEFORE the first TERMINATED and `inside` right after it. */
    const aroundTerminated = (hooks: { before?: () => void; inside?: () => void; afterIdle?: () => void }) => {
        const ctl = controller as unknown as { transition: (state: string, ...rest: unknown[]) => Promise<void> };
        const original = ctl.transition.bind(controller);
        const seen: string[] = [];
        let armedT = true;
        let armedI = true;
        vi.spyOn(ctl, 'transition').mockImplementation(async (state: string, ...rest: unknown[]) => {
            const firstT = state === 'TERMINATED' && armedT;
            if (firstT) { armedT = false; hooks.before?.(); }
            await original(state, ...rest);
            seen.push(state);
            if (firstT) hooks.inside?.();
            if (state === 'IDLE' && armedI && !armedT) { armedI = false; hooks.afterIdle?.(); }
        });
        return seen;
    };
    /** The retirement's own IDLE precedes the successor's first move; no IDLE ever lands after the successor moved. */
    const expectRetirementSettledBeforeSuccessor = (seen: string[]) => {
        const t = seen.indexOf('TERMINATED');
        const after = seen.slice(t + 1);
        expect(after[0], `the retirement settles to IDLE before the successor moves: ${JSON.stringify(seen)}`).toBe('IDLE');
        expect(after.slice(1), 'no IDLE lands after the successor started moving').not.toContain('IDLE');
        expect(after, 'the successor proceeds into its own Start').toContain('INITIATING');
    };

    it.each(['initializing', 'download-required'] as const)('Codex P2 r4320680220: late path, %s — a Start accepted just BEFORE the late TERMINATED keeps intent and lock, waits, then proceeds; no lease callback', async (phase) => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement(phase, onLateTerminal);
        engine.initGate = new Promise<void>(() => undefined); // the successor parks in its own preparation
        const initsBefore = engine.initCalls;
        let b: ReturnType<typeof acceptSuccessor> | null = null;
        const seen = aroundTerminated({ before: () => { b = acceptSuccessor(); } });
        t.finishTermination();
        await settle(60);
        expect(b!.intent, 'precondition: the successor minted its intent').not.toBeNull();
        expect(b!.locked, 'precondition: the successor took the selection lock').toBe(true);
        expect(b!.outcome(), 'never retired by the old TERMINATED, never absorbed as a no-op').toBe('pending');
        expectRetirementSettledBeforeSuccessor(seen);
        expect(onLateTerminal, 'a Start was accepted since the detach: no lease authority').not.toHaveBeenCalled();
        expect(engine.initCalls, 'the successor prepared its own engine once the old one was off').toBeGreaterThan(initsBefore);
        expect(b!.ctl.engineSelectionIntentLocked).toBe(true);
    });

    it('Codex P2 r4320680220: late path, SAME tick — a Start pressed as the late destroy resolves is not absorbed; it waits and proceeds', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        engine.initGate = new Promise<void>(() => undefined);
        const initsBefore = engine.initCalls;
        const seen = aroundTerminated({});
        t.finishTermination();
        const b = acceptSuccessor();
        await settle(60);
        expect(b.intent).not.toBeNull();
        expect(b.outcome(), 'the accepted Start did not vanish as a resolved no-op').toBe('pending');
        expectRetirementSettledBeforeSuccessor(seen);
        expect(engine.initCalls).toBeGreaterThan(initsBefore);
        expect(onLateTerminal).not.toHaveBeenCalled();
        expect(b.ctl.engineSelectionIntentLocked).toBe(true);
    });

    it('Codex P2 r4320680220: late path, DIRECT-RESET interleaving — a Start accepted at the late TERMINATED waits; the queued TERMINATED→IDLE reset never runs ahead of the retirement', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        engine.initGate = new Promise<void>(() => undefined);
        let b: ReturnType<typeof acceptSuccessor> | null = null;
        const seen = aroundTerminated({ inside: () => { b = acceptSuccessor(); } });
        t.finishTermination();
        await settle(60);
        expect(b!.intent, 'precondition: accepted while the runtime showed the retirement\'s TERMINATED').not.toBeNull();
        expect(b!.outcome()).toBe('pending');
        // The retirement's IDLE is a transition() call; the queued Start's direct reset is not. IDLE recorded right after
        // TERMINATED proves the retirement published it, before the successor touched the state.
        expectRetirementSettledBeforeSuccessor(seen);
        expect(onLateTerminal).not.toHaveBeenCalled();
    });

    it('Codex P2 r4320680220 CONTROL: a Start accepted once the late retirement reached IDLE proceeds at once; the retired take still has no lease authority', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        engine.initGate = new Promise<void>(() => undefined);
        const initsBefore = engine.initCalls;
        let b: ReturnType<typeof acceptSuccessor> | null = null;
        aroundTerminated({ afterIdle: () => { b = acceptSuccessor(); } });
        t.finishTermination();
        await settle(60);
        expect(b!.intent).not.toBeNull();
        expect(b!.outcome()).toBe('pending');
        expect(onLateTerminal, 'count-based: an accepted Start ends the retired take\'s lease authority').not.toHaveBeenCalled();
        expect(engine.initCalls).toBeGreaterThan(initsBefore);
    });

    it('Codex P2 r4320680220 (ABA): a successor accepted and then CANCELLED before the late proof does not give the retired take its lease authority back', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        const b = acceptSuccessor();
        await settle(10);
        expect(b.intent, 'precondition: accepted').not.toBeNull();
        intentApi.retireRecordingIntent('navigated'); // the page went away again before the old engine was proven off
        await settle(10);
        expect(intentApi.pendingRecordingIntent(), 'precondition: the successor was cancelled').toBeNull();
        t.finishTermination();
        await settle(60);
        expect(controller.getState(), 'the runtime still settles truthfully').toBe('IDLE');
        expect(onLateTerminal, 'no ABA: a settled/cancelled successor does not restore the old callback').not.toHaveBeenCalled();
        expect(b.ctl.engineSelectionIntentLocked, 'the cancelled Start holds no lock').toBe(false);
    });

    it('Codex P2 r4320680220: a retirement that never confirms termination refuses the waiting Start truthfully and retryably — no replacement engine', async () => {
        const onLateTerminal = vi.fn();
        await timedOutRetirement('download-required', onLateTerminal); // termination stays HELD
        (controller as unknown as { retirementAdmissionWaitMs: number }).retirementAdmissionWaitMs = 150;
        const initsBefore = engine.initCalls;
        const b = acceptSuccessor();
        await vi.waitFor(() => expect(b.outcome()).not.toBe('pending'), { timeout: 3_000 });
        expect(b.outcome(), 'a truthful, retryable refusal naming the unretired engine').toBe('rejected:PREVIOUS_TAKE_SERVICE_NOT_RETIRED');
        expect(intentApi.pendingRecordingIntent()).toBeNull();
        expect(b.ctl.engineSelectionIntentLocked, 'its lock is released').toBe(false);
        expect(b.ctl.service, 'nothing was launched before the old engine is off').toBeNull();
        expect(engine.initCalls).toBe(initsBefore);
        expect(onLateTerminal).not.toHaveBeenCalled();
    });

    it('Codex P2 r4320680220: IN-BOUND path — a Start accepted during the held in-bound destroy waits, is never retired by its TERMINATED, and proceeds once the engine is off', async () => {
        engine.downloadEnabled = false;
        await controller.warmUp('private');
        const initialCalls = engine.initCalls;
        engine.initGate = new Promise<void>(() => undefined);
        void controller.startRecording(POLICY as never, []).catch(() => undefined);
        await vi.waitFor(() => expect(engine.initCalls).toBeGreaterThan(initialCalls));
        await settle();
        let finishTermination!: () => void;
        engine.terminateGate = new Promise<void>((resolve) => { finishTermination = resolve; });
        const retiring = controller.retireEngineForUnmount(10_000); // A's destroy is HELD inside the bound
        await settle();
        engine.terminateGate = null;
        const initsBefore = engine.initCalls;
        const seen = aroundTerminated({});
        const b = acceptSuccessor();
        await settle(20);
        expect(b.intent, 'precondition: the successor was accepted during the held destroy').not.toBeNull();
        expect(b.outcome(), 'not absorbed while the old engine is still terminating').toBe('pending');
        expect(engine.initCalls, 'no replacement before the old engine is off').toBe(initsBefore);
        finishTermination();
        expect(await retiring, 'A\'s own engine was proven off').toBe('terminal');
        await settle(60);
        expect(b.outcome(), 'the in-bound TERMINATED is scoped: the successor is not retired').toBe('pending');
        expectRetirementSettledBeforeSuccessor(seen);
        expect(engine.initCalls, 'the successor then prepares its own engine').toBeGreaterThan(initsBefore);
        expect(b.ctl.engineSelectionIntentLocked).toBe(true);
    });

    /**
     * Sam SOURCE RETURN 1792464541 on bfbb1ed2: a retirement that SETTLES WITHOUT AFFIRMATIVE PROOF leaves the runtime detached
     * in the retired take's stale state. A Start after that settlement must be refused truthfully and retryably — never
     * absorbed as a resolved no-op and never handed a replacement engine — until the retired service itself proves it is off.
     */
    const preparingTake = async () => {
        engine.downloadEnabled = false;
        await controller.warmUp('private');
        const initialCalls = engine.initCalls;
        engine.initGate = new Promise<void>(() => undefined);
        void controller.startRecording(POLICY as never, []).catch(() => undefined);
        await vi.waitFor(() => expect(engine.initCalls).toBeGreaterThan(initialCalls));
        await settle();
    };
    const expectTruthfulRefusal = async (b: ReturnType<typeof acceptSuccessor>, initsBefore: number) => {
        await vi.waitFor(() => expect(b.outcome()).not.toBe('pending'), { timeout: 3_000 });
        expect(b.outcome(), 'refused truthfully and retryably — not absorbed as a resolved no-op').toBe('rejected:PREVIOUS_TAKE_SERVICE_NOT_RETIRED');
        expect(intentApi.pendingRecordingIntent()).toBeNull();
        expect(b.ctl.engineSelectionIntentLocked, 'the refused Start releases its own lock').toBe(false);
        expect(b.ctl.service, 'no replacement service').toBeNull();
        expect(engine.initCalls, 'no replacement engine').toBe(initsBefore);
    };

    it('SOURCE RETURN 1792464541 (1) in-bound: terminate REJECTS inside destroy (destroy resolves, no proof) — a later Start is refused truthfully, no replacement', async () => {
        await preparingTake();
        engine.terminateGate = Promise.reject(new Error('worker would not terminate'));
        engine.terminateGate.catch(() => undefined);
        expect(await controller.retireEngineForUnmount(5_000)).toBe('unconfirmed');
        await settle(10);
        const stale = controller.getState();
        expect(['ENGINE_INITIALIZING', 'DOWNLOAD_REQUIRED'], 'precondition: detached in the retired take\'s stale preparation').toContain(stale);
        engine.initGate = null;
        const initsBefore = engine.initCalls;
        const b = acceptSuccessor();
        await expectTruthfulRefusal(b, initsBefore);
        expect(controller.getState(), 'the stale state is not overwritten without proof').toBe(stale);
    });

    it('SOURCE RETURN 1792464541 (1) late: the timed-out retirement\'s termination later REJECTS — a later Start is refused truthfully', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutRetirement('download-required', onLateTerminal);
        t.failTermination(new Error('worker would not terminate'));
        await settle(60);
        engine.initGate = null;
        const initsBefore = engine.initCalls;
        const b = acceptSuccessor();
        await expectTruthfulRefusal(b, initsBefore);
        expect(onLateTerminal).not.toHaveBeenCalled();
    });

    it('SOURCE RETURN 1792464541 (2) in-bound: destroy() itself REJECTS — a later Start is refused truthfully, no replacement', async () => {
        await preparingTake();
        const svc = (controller as unknown as { service: { destroy: () => Promise<void> } }).service;
        vi.spyOn(svc, 'destroy').mockRejectedValue(new Error('destroy failed'));
        expect(await controller.retireEngineForUnmount(5_000)).toBe('unconfirmed');
        await settle(10);
        engine.initGate = null;
        const initsBefore = engine.initCalls;
        const b = acceptSuccessor();
        await expectTruthfulRefusal(b, initsBefore);
    });

    it('SOURCE RETURN 1792464541 (2) late: a timed-out destroy() that later REJECTS — a later Start is refused truthfully', async () => {
        await preparingTake();
        const svc = (controller as unknown as { service: { destroy: () => Promise<void> } }).service;
        let reject!: (e: Error) => void;
        vi.spyOn(svc, 'destroy').mockImplementation(() => new Promise<void>((_, r) => { reject = r; }));
        expect(await controller.retireEngineForUnmount(100)).toBe('unconfirmed');
        reject(new Error('destroy failed'));
        await settle(60);
        engine.initGate = null;
        const initsBefore = engine.initCalls;
        const b = acceptSuccessor();
        await expectTruthfulRefusal(b, initsBefore);
    });

    it('SOURCE RETURN 1792464541: detached FAILED take (never recorded: init succeeded, engine start threw) — the unproven engine keeps every Start gate closed; no replacement', async () => {
        // From FAILED, the retirement's own bounded stop runs the failure path, which detaches and destroys the service; its
        // termination rejects. The retirement then has no service of its own and settles, but the tab's live-engine registry
        // still lists the unproven engine — which is exactly what the product's Start gate (useSessionLifecycle: isEngineTerminal
        // / confirmEngineShutdown, before any controller Start) refuses on. The controller's own marker covers the other case:
        // a retirement that detached its OWN unproven service (including a preparing engine absent from the registry).
        engine.modelCached = true;
        engine.failStart = new Error('engine start failed');
        await controller.startRecording(POLICY as never, []).catch(() => undefined);
        await vi.waitFor(() => expect(['FAILED', 'FAILED_VISIBLE']).toContain(controller.getState()), { timeout: 5_000 });
        expect((controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved, 'precondition: nothing was recorded').toBe(false);
        engine.terminateGate = Promise.reject(new Error('worker would not terminate'));
        engine.terminateGate.catch(() => undefined);
        expect(await controller.retireEngineForUnmount(100)).toBe('unconfirmed');
        await settle(10);
        engine.failStart = null;
        engine.terminateGate = null;
        expect(controller.isEngineTerminal(), 'the unproven engine is still on record').toBe(false);
        expect(await controller.confirmEngineShutdown(150), 'the Start gate\'s bounded proof attempt fails: the Start is refused before any engine work').toBe('unconfirmed');
    });

    /** A take recording, then an unmount whose bounded stop never settles: the stop armed the finalization latch. */
    const recordingWithHeldStop = async () => {
        engine.modelCached = true;
        await controller.startRecording(POLICY as never, []);
        await vi.waitFor(() => expect(controller.getState()).toBe('RECORDING'), { timeout: 5_000 });
        const ctl = controller as unknown as { service: { stopTranscription: () => Promise<unknown> }; finalizingOwner: unknown; pendingFullSaveRetry: unknown };
        vi.spyOn(ctl.service, 'stopTranscription').mockImplementation(() => new Promise(() => undefined));
        return ctl;
    };
    const nextStart = async () => {
        const b = acceptSuccessor();
        await settle(30);
        expect(b.outcome(), 'never refused by the retired take\'s orphaned finalization latch').not.toBe('rejected:START_REFUSED_FINALIZATION_IN_PROGRESS');
        return b;
    };

    it('latch (P1 additional defect, Sam 1792465458): IN-BOUND completion from STOPPING releases the retired take\'s latch; the next Start meets only the legitimate unsaved-work guard', async () => {
        const ctl = await recordingWithHeldStop();
        engine.terminateGate = null; // destruction succeeds inside the bound
        expect(await controller.retireEngineForUnmount(100)).toBe('terminal');
        await settle(20);
        expect(controller.getState()).toBe('IDLE');
        expect(useSessionStore.getState().isTranscriptFinalizing, 'the orphaned latch is released on proof').toBe(false);
        expect(ctl.finalizingOwner).toBeNull();
        // The existing in-bound 'terminal' path also resolves the unsaved-recording flag (pre-existing; unchanged here), so no
        // #1033 guard applies and the next Start genuinely records.
        const b = await nextStart();
        expect(b.intent, 'the next Start was accepted').not.toBeNull();
        await vi.waitFor(() => expect(controller.getState()).toBe('RECORDING'), { timeout: 5_000 });
    });

    it('latch (P1 additional defect): LATE completion from STOPPING releases the retired take\'s latch and keeps the Retry Save; the next Start meets only the legitimate guard', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutActiveRetirement('recording', onLateTerminal);
        expect(useSessionStore.getState().isTranscriptFinalizing, 'precondition: the cancelled stop armed the latch').toBe(true);
        t.finishTermination();
        await settle(60);
        expect(controller.getState()).toBe('IDLE');
        expect(useSessionStore.getState().isTranscriptFinalizing, 'released on the late proof').toBe(false);
        expect(t.ctl.pendingFullSaveRetry, 'durable Retry Save untouched').toBe(t.retry);
        const b = await nextStart();
        // The pending Retry Save keeps the legitimate #1033 guard: refused visibly, before any intent — not the stale latch.
        expect(useSessionStore.getState().sttStatus.message).toBe('Finish saving your previous recording before starting a new one.');
        expect(b.intent).toBeNull();
    });

    it('latch CONTROL: a latch armed by ANOTHER take before the late completion is never released by the retirement', async () => {
        const onLateTerminal = vi.fn();
        const t = await timedOutActiveRetirement('recording', onLateTerminal);
        const ctl = controller as unknown as { finalizingOwner: unknown };
        // A different take's latch (strict identity differs) — the retirement must not treat it as the retired take's.
        const other = { lifecycleVersion: 9_999, serviceGeneration: 9_999, service: null };
        ctl.finalizingOwner = other;
        useSessionStore.getState().setTranscriptFinalizing(true);
        t.finishTermination();
        await settle(60);
        expect(ctl.finalizingOwner, 'another take\'s latch is untouched').toBe(other);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);
    });

    it('latch: an UNPROVEN retirement releases nothing — the latch stays until the stop\'s own bound or proof', async () => {
        const ctl = await recordingWithHeldStop();
        engine.terminateGate = Promise.reject(new Error('worker would not terminate'));
        engine.terminateGate.catch(() => undefined);
        expect(await controller.retireEngineForUnmount(100)).toBe('unconfirmed');
        await settle(20);
        expect(useSessionStore.getState().isTranscriptFinalizing, 'no affirmative proof: no latch release').toBe(true);
        expect(ctl.finalizingOwner).not.toBeNull();
        // Characterization: the in-tree service has no later proof once its termination failed (destroy() is memoized and
        // has nulled the strategy), so the unresolved marker holds until a hard reset.
        const retired = (controller as unknown as { unresolvedRetirement: { retired: { didConfirmTermination: () => boolean } } | null }).unresolvedRetirement;
        expect(retired?.retired.didConfirmTermination()).toBe(false);
    });

    it('SOURCE RETURN 1792464541: RECOVERY (never-recorded take) — the unresolved retirement refuses until a hard reset ends its ownership; then the next Start proceeds', async () => {
        await preparingTake();
        engine.terminateGate = Promise.reject(new Error('worker would not terminate'));
        engine.terminateGate.catch(() => undefined);
        expect(await controller.retireEngineForUnmount(5_000)).toBe('unconfirmed');
        await settle(10);
        engine.initGate = null;
        engine.terminateGate = null;
        const initsBefore = engine.initCalls;
        const first = acceptSuccessor();
        await expectTruthfulRefusal(first, initsBefore);
        await controller.hardResetAwaited('user-reload');
        await settle(10);
        engine.initGate = new Promise<void>(() => undefined);
        const second = acceptSuccessor();
        await settle(60);
        expect(second.outcome(), 'after the reset the next Start is neither refused by the old retirement nor absorbed').toBe('pending');
        expect(engine.initCalls, 'it proceeds into its own preparation').toBeGreaterThan(initsBefore);
        expect(second.ctl.engineSelectionIntentLocked).toBe(true);
    });

    it('lease binding (Sam 1792464541): a successor take that acquired its own lease during the held in-bound destroy is never released by the retired take', async () => {
        await preparingTake();
        lease.id = 'lease-A';
        let finishTermination!: () => void;
        engine.terminateGate = new Promise<void>((resolve) => { finishTermination = resolve; });
        const releasing = releaseTakeLeaseOnUnmount(false);
        await settle();
        lease.id = 'lease-B'; // the returning page acquired the successor's lease before its Start
        engine.terminateGate = null;
        const b = acceptSuccessor();
        finishTermination();
        await expect(releasing, 'a newer take owns the lease now').resolves.toBe(false);
        await settle(30);
        expect(lease.release, 'the retired take never releases the successor\'s lease').not.toHaveBeenCalled();
        expect(b.outcome()).not.toMatch(/teardown|RECORDING_INTENT_RETIRED/);
    });
});
