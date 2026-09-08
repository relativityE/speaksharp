// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import {
    __resetRecordingIntentForTests,
    mintRecordingIntent,
    pendingRecordingIntent,
} from '../recordingIntent';
import { SpeechRuntimeController, type LifecycleToken } from '../SpeechRuntimeController';
import { sessionManager } from '../transcription/SessionManager';
import type { TranscriptionServiceOptions } from '../transcription/TranscriptionService';
import { completeSession } from '../../lib/storage';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({}),
}));
// The coverage publish is only reached when the objective finalizer SUCCEEDS with coverage. Without
// this the casualty below is vacuous: the publish never runs, and the mutant that removes its
// ownership guard survives — which is exactly what the first version of it did.
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({
    finalizeObjectiveSessionOnSave: vi.fn().mockResolvedValue({
        ok: true,
        coverage: [
            { briefPointId: 'fp-0', point: 'Name the price', status: 'covered' },
            { briefPointId: 'fp-1', point: 'State the guarantee', status: 'covered' },
        ],
    }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    })),
}));

type PrivateController = {
    lifecycleVersion: number;
    state: string;
    isEngineReady: boolean;
    isEmissionsSafe: boolean;
    recordingStartedUnresolved: boolean;
    recordingEngineMode: string | null;
    service: unknown;
    callbacksForNewService: (callbacks?: Partial<TranscriptionServiceOptions>) => Partial<TranscriptionServiceOptions>;
    checkRecordingInvariant: (token?: LifecycleToken, intentToken?: string) => Promise<void>;
    transition: (
        state: string,
        error?: Error,
        token?: LifecycleToken,
        intentToken?: string,
    ) => Promise<void>;
    startRecording: SpeechRuntimeController['startRecording'];
    hardResetAwaited: SpeechRuntimeController['hardResetAwaited'];
    whenStable: SpeechRuntimeController['whenStable'];
};

const newController = (): PrivateController => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController;
};

const fakeService = (input: {
    isDestroyed: () => boolean;
    mode?: string;
    start?: () => Promise<void>;
    destroy?: () => Promise<void>;
}) => ({
    isServiceDestroyed: input.isDestroyed,
    warmUp: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue(input.mode ?? 'private'),
    getStrategy: vi.fn().mockReturnValue(null),
    getState: vi.fn().mockReturnValue('RECORDING'),
    getMetadata: vi.fn().mockReturnValue({
        engineVersion: 'test-engine',
        modelName: 'test-model',
        deviceType: 'browser',
    }),
    startTranscription: vi.fn().mockImplementation(input.start ?? (() => Promise.resolve())),
    destroy: vi.fn().mockImplementation(input.destroy ?? (() => Promise.resolve())),
    setSessionId: vi.fn(),
    updateCallbacks: vi.fn(),
    fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
});

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => { resolve = settle; });
    return { promise, resolve };
};

const POLICY = {
    allowNative: false,
    allowCloud: false,
    allowPrivate: true,
    preferredMode: 'private',
    allowFallback: false,
    executionIntent: 'test',
};

describe('#1431 — lifecycle work belongs to its originating attempt and service', () => {
    let controller: PrivateController;

    beforeEach(() => {
        vi.restoreAllMocks();
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready to record' });
        controller = newController();
        controller.state = 'READY';
    });

    it('lets B survive when A resolves from startTranscription after a hard reset', async () => {
        const aStart = deferred();
        let firstDestroyed = false;
        const serviceA = fakeService({
            isDestroyed: () => firstDestroyed,
            mode: 'mock',
            start: () => aStart.promise,
            destroy: async () => { firstDestroyed = true; },
        });
        const serviceB = fakeService({ isDestroyed: () => false, mode: 'private' });
        const services = [serviceA, serviceB];
        vi.spyOn(sessionManager, 'getOrCreateService').mockImplementation(() => services.shift() as never);

        controller.state = 'IDLE';
        useSessionStore.getState().setRuntimeState('IDLE');
        const attemptA = controller.startRecording(POLICY as never, []);
        const rejectedA = attemptA.catch((error: Error) => error.message);
        await vi.waitFor(() => expect(serviceA.startTranscription).toHaveBeenCalledTimes(1));

        await controller.hardResetAwaited('route_exit');
        const attemptB = controller.startRecording(POLICY as never, []);
        await expect(attemptB).resolves.toBeUndefined();
        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(controller.recordingEngineMode).toBe('private');
        expect(controller.service).toBe(serviceB);
        expect(pendingRecordingIntent()).toBeNull();

        aStart.resolve();
        await controller.whenStable();

        expect(await rejectedA).toBe('RECORDING_INTENT_RETIRED:teardown');
        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(controller.recordingEngineMode).toBe('private');
        expect(controller.service).toBe(serviceB);
        expect(pendingRecordingIntent()).toBeNull();
    });

    it('rejects a stale lifecycle transition before controller or store mutation', async () => {
        const stale: LifecycleToken = { version: controller.lifecycleVersion, cancelled: false };
        controller.lifecycleVersion += 1;

        await controller.transition('INITIATING', undefined, stale);

        expect(controller.state).toBe('READY');
        expect(useSessionStore.getState().runtimeState).toBe('READY');
        expect(useSessionStore.getState().sttStatus).toMatchObject({
            type: 'idle',
            message: 'Ready to record',
        });
    });

    it('does not enter RECORDING when the supplied intent no longer owns the current start', async () => {
        const attemptA = mintRecordingIntent({
            recordingId: 'recording-a',
            policy: null,
            userWords: [],
        });
        const attemptB = mintRecordingIntent({
            recordingId: 'recording-b',
            policy: null,
            userWords: [],
        });
        controller.state = 'ENGINE_INITIALIZING';
        useSessionStore.getState().setRuntimeState('ENGINE_INITIALIZING');
        controller.isEngineReady = true;
        controller.isEmissionsSafe = true;

        // #1431 — a service that CONFIRMS recording is now required on every route into the RECORDING
        // publish, so the attempt has something to be a claim about. This test previously drove the
        // invariant with NO service attached and still expected RECORDING, which is the starkest form of
        // the false success Codex identified: the product reporting a recording that no engine is making.
        const recordingService = fakeService({ isDestroyed: () => false });
        controller.service = recordingService as never;

        const startSession = vi.spyOn(useSessionStore.getState(), 'startSession');
        await controller.transition('RECORDING');
        await controller.transition('RECORDING', undefined, undefined, attemptA.token);

        expect(controller.state).toBe('ENGINE_INITIALIZING');
        expect(useSessionStore.getState().runtimeState).toBe('ENGINE_INITIALIZING');
        expect(controller.recordingStartedUnresolved).toBe(false);
        expect(pendingRecordingIntent()?.token).toBe(attemptB.token);
        expect(startSession).not.toHaveBeenCalled();

        await controller.checkRecordingInvariant(undefined, attemptB.token);

        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(startSession).toHaveBeenCalledTimes(1);
        expect(pendingRecordingIntent()).toBeNull();
    });

    it('CASUALTY D2: the owning intent cannot publish RECORDING for a service that is not recording', async () => {
        // The callback route. `handleReady()` reaches `checkRecordingInvariant` too, and on a warm take
        // `isEngineReady`/`isEmissionsSafe` survive the previous recording — so without asking the
        // service, a `ready` could publish RECORDING, resolve the Start intent and open the store session
        // while `startTranscription` was still on its way to a non-recording early return. A later
        // failure cannot retract a success already reported.
        const attempt = mintRecordingIntent({ recordingId: 'recording-c', policy: null, userWords: [] });
        controller.state = 'ENGINE_INITIALIZING';
        useSessionStore.getState().setRuntimeState('ENGINE_INITIALIZING');
        controller.isEngineReady = true;
        controller.isEmissionsSafe = true;

        const notRecording = fakeService({ isDestroyed: () => false });
        notRecording.getState = vi.fn().mockReturnValue('READY');
        notRecording.fsm = { is: vi.fn((state: string): state is 'RECORDING' => state === 'NEVER') };
        controller.service = notRecording as never;

        const startSession = vi.spyOn(useSessionStore.getState(), 'startSession');
        await controller.checkRecordingInvariant(undefined, attempt.token);

        expect({
            state: controller.state,
            runtime: useSessionStore.getState().runtimeState,
            startSessionCalls: startSession.mock.calls.length,
            intentStillPending: pendingRecordingIntent()?.token,
        }).toEqual({
            state: 'ENGINE_INITIALIZING',
            runtime: 'ENGINE_INITIALIZING',
            startSessionCalls: 0,
            intentStillPending: attempt.token,
        });
    });

    it('ignores a late error callback from a service generation that has been replaced', async () => {
        let firstDestroyed = false;
        const first = fakeService({
            isDestroyed: () => firstDestroyed,
            destroy: async () => { firstDestroyed = true; },
        });
        const second = fakeService({ isDestroyed: () => false });
        const callbacksA = controller.callbacksForNewService();
        controller.service = first;

        controller.state = 'IDLE';
        useSessionStore.getState().setRuntimeState('IDLE');
        await controller.hardResetAwaited('replace_service');
        controller.callbacksForNewService();
        controller.service = second;
        const attemptB = mintRecordingIntent({
            recordingId: 'recording-b',
            policy: null,
            userWords: [],
        });
        controller.state = 'ENGINE_INITIALIZING';
        useSessionStore.getState().setRuntimeState('ENGINE_INITIALIZING');

        const preparingState = controller.state;
        const preparingStatus = useSessionStore.getState().sttStatus;
        const currentIntent = pendingRecordingIntent()?.token;
        callbacksA.onError?.(new Error('microphone permission denied by replaced service'));
        await controller.whenStable();
        expect(controller.state).toBe(preparingState);
        expect(useSessionStore.getState().sttStatus).toEqual(preparingStatus);
        expect(pendingRecordingIntent()?.token).toBe(currentIntent);
        expect(controller.service).toBe(second);
        expect(completeSession).not.toHaveBeenCalled();

        controller.isEngineReady = true;
        controller.isEmissionsSafe = true;
        await controller.checkRecordingInvariant(undefined, attemptB.token);
        const recordingStatus = useSessionStore.getState().sttStatus;
        callbacksA.onError?.(new Error('microphone permission denied by replaced service'));
        await controller.whenStable();

        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(useSessionStore.getState().sttStatus).toEqual(recordingStatus);
        expect(controller.service).toBe(second);
        expect(completeSession).not.toHaveBeenCalled();
    });

    // =============================================================================================
    // #1431 consolidated return — the four named casualties. Each drives a REAL suspension and lets
    // the stale take resolve into it, because that is the only shape in which these defects exist.
    // =============================================================================================

    /**
     * A controller parked mid-stop, with A owning the take and a resolvable suspension point.
     *
     * `stopTranscription` signals that it has been ENTERED before it hangs. That signal is what lets
     * a test supersede A at the only moment these defects exist: after the stop's early ownership
     * check has already passed, and while A is suspended. Superseding earlier makes A exit at that
     * early check instead, and the casualty then passes with the fences removed — which is exactly
     * what the first version of these two tests did.
     */
    const stoppingController = (stopSuspension: Promise<unknown>, onEntered?: () => void) => {
        const c = newController() as unknown as PrivateController & {
            sessionId: string | null;
            serviceGeneration: number;
            stopRecording: SpeechRuntimeController['stopRecording'];
            watchdogInterval: unknown;
        };
        c.state = 'RECORDING';
        (c as unknown as { initialized: boolean }).initialized = true;
        c.isEngineReady = true;
        c.isEmissionsSafe = true;
        c.sessionId = 'session-A';
        c.service = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 30_000),
            getState: vi.fn().mockReturnValue('RECORDING'),
            getMetadata: vi.fn().mockReturnValue({ engineVersion: 'e', modelName: 'm', deviceType: 'browser' }),
            stopTranscription: vi.fn(() => { onEntered?.(); return stopSuspension; }),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            setSessionId: vi.fn(),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        };
        return c;
    };

    it('CASUALTY P1-1: A resolving after B is accepted publishes NOTHING shared', async () => {
        // A is suspended inside stopTranscription. B is accepted while it hangs. A then resolves.
        // Before the fence, A walked on through session id, saved marker, finalized analysis and
        // runtime state — every one of them B's.
        let releaseA!: (v: unknown) => void;
        let bSessionId = '';
        const c: ReturnType<typeof stoppingController> = stoppingController(
            new Promise((resolve) => { releaseA = resolve; }),
            // Superseded INSIDE the suspension — past the stop's early ownership check, which is the
            // only window in which the post-stop publications are reachable by a stale take.
            () => {
                c.lifecycleVersion += 1;
                c.serviceGeneration += 1;
                c.sessionId = 'session-B';
                bSessionId = c.sessionId;
                useSessionStore.getState().setSessionSaved(false);
                useSessionStore.getState().setFinalizedAnalysis(null);
            },
        );

        // A's OWN persistence must SUCCEED — otherwise the stop diverts into the save-failure path and
        // never reaches the shared publications at all, and this casualty passes with the fence
        // removed. That is precisely what the first version of it did.
        vi.mocked(completeSession).mockResolvedValue({ success: true } as never);

        useSessionStore.getState().setRuntimeState('RECORDING');
        const stopPromise = c.stopRecording().catch(() => null);
        await Promise.resolve();
        await Promise.resolve();

        expect(bSessionId, 'the stop must actually have reached stopTranscription').toBe('session-B');

        // ---- A finally answers.
        releaseA({ transcript: 'A transcript', stats: { accuracy: 0.9 }, success: true });
        await stopPromise;

        // A's own row was still completed — that work is A's and must not be abandoned half-written.
        expect(vi.mocked(completeSession), "A finishes its OWN persistence").toHaveBeenCalled();

        // ...and NOTHING shared moved. B's identity and markers are exactly as B left them.
        expect(c.sessionId, "A must not overwrite B's controller session").toBe(bSessionId);
        expect(useSessionStore.getState().sessionSaved, "A must not set B's saved marker").toBe(false);
        expect(useSessionStore.getState().finalizedAnalysis, "A must not publish B's review").toBeNull();
    });

    it("CASUALTY P1-2: a stale service's destroy() rejection cannot fail B", async () => {
        // A is already superseded when it reaches the terminal, and its engine refuses to tear down.
        // Unhandled, that rejection reached the common catch — which belongs to B — and would
        // transition B to FAILED and purge B's working state.
        let superseded = false;
        const c: ReturnType<typeof stoppingController> = stoppingController(
            Promise.resolve({ transcript: '', stats: { accuracy: 0 }, success: true }),
            () => {
                // Same window as above: A is past its early check and now genuinely stale, so it
                // reaches the terminal on the already-superseded branch with a failing teardown.
                c.lifecycleVersion += 1;
                c.serviceGeneration += 1;
                superseded = true;
                useSessionStore.getState().setRuntimeState('RECORDING');
                useSessionStore.getState().setTranscriptFinalizing(true);
            },
        );
        (c.service as { destroy: ReturnType<typeof vi.fn> }).destroy =
            vi.fn().mockRejectedValue(new Error('WORKER_TEARDOWN_REFUSED'));

        const outcome = await c.stopRecording().catch((e: unknown) => e);
        expect(superseded, 'the stop must actually have reached stopTranscription').toBe(true);

        expect(outcome, "A's teardown failure must not surface as a rejection to B").not.toBeInstanceOf(Error);
        expect(c.state, 'B must not be transitioned to FAILED by A').not.toBe('FAILED');
        expect(useSessionStore.getState().runtimeState, "B's runtime state is untouched").toBe('RECORDING');
        expect(useSessionStore.getState().isTranscriptFinalizing, "B's finalizing latch is untouched").toBe(true);
    });

    it('CASUALTY P2-3: a late onReady during STOPPING cannot arm a watchdog that outlives its take', async () => {
        // A's engine can report ready while A is finalizing. Its generation is still current at that
        // point — the bump happens at detach — so the generation wrapper passes it through, and the
        // stop's scoped watchdog clear would then miss the newly armed one entirely.
        const c = stoppingController(Promise.resolve({ transcript: '', stats: { accuracy: 0 } })) as unknown as
            PrivateController & { handleReady: (g?: number, s?: unknown) => void; watchdogInterval: unknown; watchdogVersion: number };
        c.state = 'STOPPING';
        c.watchdogInterval = null;
        const versionBefore = c.watchdogVersion;

        c.handleReady();

        expect(c.watchdogInterval, 'no watchdog may be armed while STOPPING').toBeNull();
        expect(c.watchdogVersion, 'and no version may be minted for one').toBe(versionBefore);
    });

    it("CASUALTY P2-4: A's queued model progress cannot write B's store or call B's subscriber", async () => {
        vi.useFakeTimers();
        try {
            const c = newController() as unknown as PrivateController & {
                serviceGeneration: number;
                subscriberCallbacks: { onModelLoadProgress?: (v: number | null) => void };
                handleModelLoadProgress: (p: number | null) => void;
            };
            const bSubscriber = vi.fn();
            c.subscriberCallbacks = { onModelLoadProgress: bSubscriber };
            useSessionStore.getState().setModelLoadingProgress(null);

            // A schedules a flush for the frame after next...
            c.handleModelLoadProgress(0.42);
            // ...and B is accepted before it runs.
            c.serviceGeneration += 1;

            await vi.advanceTimersByTimeAsync(50);

            expect(useSessionStore.getState().modelLoadingProgress, "A's percentage must not reach B's store").toBeNull();
            expect(bSubscriber, "A's progress must not call B's subscriber").not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY P1-1b: a stale take cannot republish its Focus Points coverage over the new take', async () => {
        // THIS is the write that strands a Retry at the previous take's N/N.
        //
        // A new recording clears `objectiveCoverageResult` at the accepted-start boundary. But A's
        // finalization publishes the rail from inside `completeProgressForRecording`, which runs after
        // several suspensions — so A finishing AFTER B started put A's coverage straight back, and the
        // user who pressed "Retry these points" saw the previous take's 4/4 instead of a fresh 0/4.
        //
        // Guarding the other shared writes did not cover this one: the coverage publish lives in a
        // different method entirely, and the ownership has to be threaded into it.
        const c = newController() as unknown as PrivateController & {
            stopStillOwnsSharedState: (a: unknown, t: { cancelled: boolean; version: number }) => boolean;
            captureStopAuthority: (v: number, s: unknown, id: string | null) => unknown;
            finalizeObjectiveAndGateProgress: (
                brief: { projectId: string; briefId: string },
                sessionId: string,
                segments: unknown[],
                durationSeconds: number,
                runProgressEval: () => Promise<unknown>,
                canPublishShared?: () => boolean,
            ) => Promise<unknown>;
        };

        // A captures its authority, then B supersedes.
        const token = { cancelled: false, version: c.lifecycleVersion };
        const authority = c.captureStopAuthority(token.version, null, 'session-A');
        c.lifecycleVersion += 1;

        // B has already cleared the rail by starting.
        useSessionStore.getState().setObjectiveCoverageResult(null);

        // A's finalization completes and tries to publish its own coverage.
        await c.finalizeObjectiveAndGateProgress(
            { projectId: 'p1', briefId: 'b1' },
            'session-A',
            [{ text: 'A said all four points', startSec: 0 }],
            60,
            async () => ({ status: 'queued' }) as never,
            () => c.stopStillOwnsSharedState(authority, token),
        );

        expect(
            useSessionStore.getState().objectiveCoverageResult,
            "A's coverage must not reappear on B's rail",
        ).toBeNull();
    });
});
