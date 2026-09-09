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
import { completeSession, saveSession } from '../../lib/storage';

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

    it("CASUALTY P1-2c: a superseded stop that FAILS must not mark B's row failed", async () => {
        /**
         * #1431 P1 (exact-head return on `af473132b`). The common stop catch read `this.sessionId`
         * LIVE and called `completeSession(status: 'failed')` on it. When stale A's persistence work
         * rejected after a reset, that marked B'S DATABASE ROW failed, wrote an error over B's UI and
         * purged B's live transcript — a recording the user was still making, torn down because a take
         * they had already abandoned lost a race.
         *
         * A still settles its OWN record: its session genuinely failed and saying so is A's to do. It
         * does that against the id CAPTURED at stop entry, never the live one.
         */
        let superseded = false;
        const c: ReturnType<typeof stoppingController> = stoppingController(
            // Rejects on a later tick so the rejection is never unhandled before the stop awaits it.
            new Promise((_resolve, reject) => {
                setTimeout(() => reject(new Error('A could not finish its stop')), 0);
            }),
            () => {
                c.lifecycleVersion += 1;
                c.serviceGeneration += 1;
                // B is the current session by the time A's failure lands.
                c.sessionId = 'session-B';
                superseded = true;
            },
        );
        vi.mocked(completeSession).mockClear();

        await c.stopRecording().catch(() => { /* A's own failure is the subject, not the assertion */ });
        expect(superseded, 'the stop must actually have reached stopTranscription').toBe(true);

        const failedRows = vi.mocked(completeSession).mock.calls
            .filter(([, args]) => (args as { status?: string } | undefined)?.status === 'failed')
            .map(([id]) => id);
        expect(failedRows, "A's failure must never mark B's row failed").not.toContain('session-B');
        expect(c.state, 'B must not be transitioned to FAILED by A').not.toBe('FAILED');
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

    it("CASUALTY P2-4b: a refused flush does not consume the successor's only update", async () => {
        // The pending slot and the scheduled flag are SHARED. While A's flush is pending, B's progress
        // is coalesced into the same slot and refused a flush of its own. If A then arrives, finds
        // itself stale and simply returns, it clears the flag and throws away the only flush B was
        // going to get — B's download bar stops moving at whatever it last showed.
        vi.useFakeTimers();
        try {
            const c = newController() as unknown as PrivateController & {
                serviceGeneration: number;
                subscriberCallbacks: { onModelLoadProgress?: (v: number | null) => void };
                handleModelLoadProgress: (p: number | null) => void;
            };
            const subscriber = vi.fn();
            c.subscriberCallbacks = { onModelLoadProgress: subscriber };
            useSessionStore.getState().setModelLoadingProgress(null);

            c.handleModelLoadProgress(42);   // A schedules
            c.serviceGeneration += 1;          // B is accepted
            c.handleModelLoadProgress(77);   // B writes into the same slot, refused its own flush

            await vi.advanceTimersByTimeAsync(50);

            // B's value is published, not discarded with A's stale flush and not replaced by A's.
            expect(useSessionStore.getState().modelLoadingProgress, "B's own progress must survive").toBe(77);
            expect(subscriber).toHaveBeenCalledWith(77);
            expect(subscriber, "A's value must never be published").not.toHaveBeenCalledWith(42);
        } finally {
            vi.useRealTimers();
        }
    });

    it('CASUALTY P1-3: the OWNER releases its own finalizing latch after advancing the lifecycle', async () => {
        // The regression my first ownership guard introduced. The terminal advances the lifecycle
        // itself to fence its destroyed service, and the guard then compared the latch's armed version
        // against the LIVE value — so the rightful owner no longer matched its own latch and refused
        // to release it. "Finalizing…" sticks forever with the record control disabled, which is the
        // unrecoverable lockout #1089 exists to prevent.
        const c = newController() as unknown as PrivateController & {
            finalizingOwnerVersion: number | null;
            releaseFinalizingIfOwner: (reason: string, captured?: number | null) => boolean;
        };
        useSessionStore.getState().setTranscriptFinalizing(true);
        const armedAt = c.lifecycleVersion;
        c.finalizingOwnerVersion = armedAt;

        // The owner's OWN advance, exactly as the terminal performs it.
        c.lifecycleVersion += 1;

        expect(c.releaseFinalizingIfOwner('normal_terminal', armedAt), 'the owner may release').toBe(true);
        expect(useSessionStore.getState().isTranscriptFinalizing, 'the latch is actually released').toBe(false);
    });

    it('CASUALTY P1-3b: a SUPERSEDED take still cannot release the successor\'s latch', async () => {
        // The other half. Passing a captured version must not become a way to release anyone's latch.
        const c = newController() as unknown as PrivateController & {
            finalizingOwnerVersion: number | null;
            releaseFinalizingIfOwner: (reason: string, captured?: number | null) => boolean;
        };
        useSessionStore.getState().setTranscriptFinalizing(true);
        const aCaptured = c.lifecycleVersion;
        // B took over and armed the latch itself.
        c.lifecycleVersion += 5;
        c.finalizingOwnerVersion = c.lifecycleVersion;

        expect(c.releaseFinalizingIfOwner('superseded_before_stop', aCaptured), 'A may not release').toBe(false);
        expect(useSessionStore.getState().isTranscriptFinalizing, "B's latch survives").toBe(true);
    });

    it('CASUALTY P1-2b: a destroy that fails AFTER takeover is contained, not thrown at B', async () => {
        // The other destroy site. On the owner path A is still the rightful owner when it reaches the
        // terminal, so a teardown failure there IS A's failure and belongs in the common catch — that
        // is how the user gets FAILED, an honest message and the recovery draft.
        //
        // But `destroy()` is a suspension. If B takes over DURING it, the same rejection reaches a
        // catch that now belongs to B and fails a recording that is going fine. The decision has to be
        // made after the suspension, which is why containment here is conditional and the superseded
        // branch's is not.
        const c: ReturnType<typeof stoppingController> = stoppingController(Promise.resolve({ transcript: 'A said something', stats: { accuracy: 0.9 }, success: true }));
        (c.service as { destroy: ReturnType<typeof vi.fn> }).destroy = vi.fn(async () => {
            // B arrives while A is tearing down, and A's engine refuses to die.
            c.lifecycleVersion += 1;
            c.serviceGeneration += 1;
            useSessionStore.getState().setRuntimeState('RECORDING');
            throw new Error('WORKER_TEARDOWN_REFUSED');
        });
        vi.mocked(completeSession).mockResolvedValue({ success: true } as never);

        const outcome = await c.stopRecording().catch((e: unknown) => e);

        expect(outcome, "A's teardown failure must not surface as a rejection to B").not.toBeInstanceOf(Error);
        expect(c.state, 'B must not be transitioned to FAILED').not.toBe('FAILED');
        expect(useSessionStore.getState().runtimeState, "B's runtime state is untouched").toBe('RECORDING');
    });

    it('CASUALTY P1-4: stale Progress touches NOTHING shared — gate, briefs, coverage', async () => {
        // `completeProgressForRecording` is reached after several suspensions, and it writes far more
        // than the coverage rail: it opens the Start-blocking gate, replaces the completed Focus Points
        // brief, clears the active one, and publishes the verdict. A stale take reaching any of those
        // blocks the successor's recorder, swaps the successor's point set, or publishes a verdict
        // about a session the user has already moved on from.
        //
        // Only the durable evaluation itself is A's to finish.
        const c = newController() as unknown as PrivateController & {
            capturedUserId: string | null;
            completeProgressForRecording: (
                context: unknown, sessionId: string, attributionStatus: string | undefined,
                metricsPersisted: boolean, canPublishShared: () => boolean,
            ) => Promise<unknown>;
        };
        c.capturedUserId = 'owner-1';

        const store = useSessionStore.getState();
        const bBrief = { projectId: 'p-B', briefId: 'b-B', points: ['B one', 'B two'], topic: 'B topic', paceGuideSecPerPoint: 60 };
        store.setActiveObjectiveBrief(bBrief as never);
        store.setCompletedObjectiveBrief(null);
        store.setObjectiveCoverageResult(null);
        store.setRuntimeState('RECORDING');
        store.setTranscriptFinalizing(true);
        const gateBefore = store.progressGate;

        // A has already lost ownership before it gets here.
        await c.completeProgressForRecording(
            {
                mode: 'objective',
                brief: { projectId: 'p-A', briefId: 'b-A' },
                segments: [{ text: 'A said all four points', startSec: 0 }],
                durationSeconds: 60,
            },
            'session-A',
            'verified',
            true,
            () => false,
        );

        const after = useSessionStore.getState();
        expect(after.activeObjectiveBrief, "B's active brief is untouched").toEqual(bBrief);
        expect(after.completedObjectiveBrief, "A must not publish its brief as completed").toBeNull();
        expect(after.objectiveCoverageResult, "A must not publish coverage").toBeNull();
        expect(after.progressGate, "A must not open or close B's Start gate").toEqual(gateBefore);
        expect(after.runtimeState, "B's runtime state is untouched").toBe('RECORDING');
        expect(after.isTranscriptFinalizing, "B's finalizing latch is untouched").toBe(true);
    });

    it('CASUALTY P1-5: a service/generation swap WITHOUT a lifecycle bump still contains the rejection', async () => {
        // The terminal ownership check compared only `lifecycleVersion`. A successor that replaces the
        // service and its generation inside the SAME lifecycle — which is what the candidate switch
        // does — left that check satisfied, so A's teardown rejection was rethrown into a catch that
        // now belongs to B: B to FAILED, B's state purged, for a recording that is going fine.
        const c: ReturnType<typeof stoppingController> = stoppingController(
            Promise.resolve({ transcript: 'A said something', stats: { accuracy: 0.9 }, success: true }),
        );
        // Captured before the stop, because the mock REPLACES `c.service` — reading the spy off the
        // controller afterwards would read the successor's stub, not A's.
        const aDestroy = vi.fn(async () => {
            // Service identity and generation move; the lifecycle deliberately does NOT.
            c.serviceGeneration += 1;
            c.service = { getMode: () => 'private', isServiceDestroyed: () => false } as never;
            // ...and the successor owns the controller's session id, which is what makes the harm
            // reachable: the common catch writes `status: 'failed'` for `this.sessionId`, so an
            // uncontained rejection marks B's row failed in the database, not A's.
            c.sessionId = 'session-B';
            useSessionStore.getState().setRuntimeState('RECORDING');
            throw new Error('WORKER_TEARDOWN_REFUSED');
        });
        (c.service as { destroy: ReturnType<typeof vi.fn> }).destroy = aDestroy;
        vi.mocked(completeSession).mockResolvedValue({ success: true } as never);

        vi.mocked(completeSession).mockClear();
        const outcome = await c.stopRecording().catch((e: unknown) => e);

        expect(aDestroy, 'the terminal teardown ran').toHaveBeenCalled();
        expect(outcome, "A's rejection must not reach B").not.toBeInstanceOf(Error);
        expect(c.state, 'B must not be transitioned to FAILED').not.toBe('FAILED');
        expect(useSessionStore.getState().runtimeState, 'B remains RECORDING').toBe('RECORDING');

        // THE ASSERTION THAT ACTUALLY DISCRIMINATES. The tokened `transition('FAILED')` refuses a
        // stale token on its own, so the controller state alone cannot tell whether the rejection was
        // contained — it looks the same either way. The common catch's OTHER side effect is not
        // token-guarded: it writes `status: 'failed'` for `this.sessionId`, which after a takeover is
        // the SUCCESSOR's session. A stale teardown failure would mark B's row failed in the database.
        const failedWrites = vi.mocked(completeSession).mock.calls
            .filter((call) => (call[1] as { status?: string } | undefined)?.status === 'failed')
            .map((call) => call[0]);
        expect(failedWrites, "A's teardown failure must not mark B's session failed").toEqual([]);
    });
});

/**
 * #1431 P1 — THE TWO EXACT-HEAD FINDINGS RETURNED ON `af473132b`.
 *
 * Both are the same shape as everything else in this file and both slipped through anyway, because
 * the paths that carry them are the ones that LOOK exempt: a user-initiated recovery, and an error
 * handler. Neither is exempt. A suspension point does not care who started the work.
 */
describe('#1431 — superseded work publishes nothing into the successor', () => {
    let controller: ReturnType<typeof newController>;

    beforeEach(() => {
        vi.restoreAllMocks();
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        for (const attribute of [...document.documentElement.attributes]) {
            if (attribute.name.startsWith('data-')) document.documentElement.removeAttribute(attribute.name);
        }
        controller = newController();
        controller.state = 'READY';
    });

    it('CASUALTY P1-1: a RETRY that resumes after a reset unlocks nothing and publishes nothing', async () => {
        /**
         * The retry paths passed `canPublishShared: () => true`, reasoning that Retry Save is
         * user-initiated and therefore "the current take by definition". Being user-initiated says who
         * STARTED the work; `attestSessionEngine()` is a real suspension point, and nothing freezes the
         * app while it is in flight. Resuming, A unlocked B's recording latch, wrote A's persistence
         * identity over B's, and published A's Progress/brief/coverage — with an explicit authority
         * argument vouching for it.
         */
        const priv = controller as unknown as {
            pendingAttributionRetry: unknown;
            recordingStartedUnresolved: boolean;
            lifecycleVersion: number;
            serviceGeneration: number;
            attestSessionEngine: (id: string, ev: unknown) => Promise<{ attributed: boolean } | null>;
            retryPendingAttribution: () => Promise<boolean>;
        };

        const entered = deferred();
        const release = deferred();
        priv.attestSessionEngine = async () => {
            entered.resolve();
            await release.promise;
            return { attributed: true };
        };
        const slot = {
            sessionId: 'session-A',
            evidence: null,
            progressContext: { mode: 'private' },
            progressMetrics: { payload: null, persisted: false },
        };
        priv.pendingAttributionRetry = slot;
        priv.recordingStartedUnresolved = true;

        const running = priv.retryPendingAttribution();
        await entered.promise;

        /**
         * SUPERSEDE THE WAY THE OTHER CASUALTIES IN THIS FILE DO — bump the authority terms directly.
         *
         * My first version called `hardResetAwaited()`, which also CLEARS `pendingAttributionRetry`.
         * The compare-and-clear below it therefore never opened, A never reached the guarded
         * publications at all, and the casualty passed with the fence fully reverted. It measured
         * nothing. Bumping the versions leaves the retry slot intact, so the fence is the only thing
         * that can stop the publication.
         */
        priv.lifecycleVersion += 1;
        priv.serviceGeneration += 1;

        release.resolve();
        await running;

        expect(priv.pendingAttributionRetry, "A still finishes its OWN bookkeeping").toBeNull();
        expect(priv.recordingStartedUnresolved, "B's recording latch is not unlocked by A's retry").toBe(true);
        expect(
            document.documentElement.getAttribute('data-session-persisted-id'),
            "A's persistence identity is not published over B's",
        ).not.toBe('session-A');
    });

});

/**
 * #1431 — THE TWO EXACT-HEAD P1s RETURNED ON `f6a082ca3e`.
 *
 * Both live past a suspension point that looked settled: an initial-save retry adopting the row it
 * just created, and an error path releasing a latch it believed it owned.
 */
describe('#1431 — a suspended retry and a stale error path own nothing shared', () => {
    let controller: ReturnType<typeof newController>;

    beforeEach(() => {
        vi.restoreAllMocks();
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        controller = newController();
        controller.state = 'READY';
    });

    it("CASUALTY P1-A: a suspended initial-save retry does not install its created row into B", async () => {
        /**
         * `saveSession()` is a real suspension point. A hard reset can start successor B while it is
         * unresolved, and B begins with NO session row — so `!this.sessionId` was true and A, on
         * resuming, assigned its own created id and telemetry context to B. B then persisted into A's
         * row: two takes, one row, the second recording written over the first's identity.
         */
        const priv = controller as unknown as {
            pendingFullSaveRetry: unknown;
            sessionId: string | null;
            lifecycleVersion: number;
            serviceGeneration: number;
            retryRecordingSave: () => Promise<boolean>;
        };

        const entered = deferred();
        const release = deferred();
        vi.mocked(saveSession).mockImplementation(async () => {
            entered.resolve();
            await release.promise;
            return { session: { id: 'session-A-created' }, usageExceeded: false } as never;
        });

        priv.sessionId = null;
        priv.pendingFullSaveRetry = {
            initialSave: true,
            sessionId: null,
            completeArgs: {},
            attributionEvidence: null,
            progressContext: { mode: 'private', userId: 'u', recordingId: 'r' },
            progressMetrics: { payload: null, persisted: false },
        };

        const running = priv.retryRecordingSave().catch(() => false);
        await entered.promise;

        // B takes the lifecycle while A is suspended inside saveSession, and has no row of its own.
        priv.lifecycleVersion += 1;
        priv.serviceGeneration += 1;
        priv.sessionId = null;

        release.resolve();
        await running;

        expect(priv.sessionId, "A's created row is not installed as B's session").not.toBe('session-A-created');
    });

    it("CASUALTY P1-B: a service swap WITHIN one lifecycle cannot release the successor's latch", async () => {
        /**
         * The release compared the lifecycle version alone. A service can be replaced WITHIN the same
         * lifecycle, so a stale take matched the successor's latch on version alone and switched off
         * B's "Finalizing…" and discarded B's frozen transcript — the user watched the record control
         * re-enable while their save was still running.
         *
         * The lifecycle version is deliberately IDENTICAL on both sides here; only the service
         * generation differs. That is what makes this discriminating: a guard comparing versions alone
         * passes it.
         */
        const priv = controller as unknown as {
            lifecycleVersion: number;
            serviceGeneration: number;
            service: unknown;
            finalizingOwner: unknown;
            finalizingOwnerVersion: number | null;
            releaseFinalizingIfOwner: (reason: string, v?: number | null, owner?: unknown) => boolean;
        };

        const serviceB = fakeService({ isDestroyed: () => false });
        priv.service = serviceB as never;
        priv.serviceGeneration = 7;

        // B armed the latch, in the CURRENT lifecycle with B's service.
        priv.finalizingOwnerVersion = priv.lifecycleVersion;
        priv.finalizingOwner = {
            lifecycleVersion: priv.lifecycleVersion,
            serviceGeneration: 7,
            service: serviceB,
        };
        useSessionStore.getState().setTranscriptFinalizing(true);

        // Stale A: SAME lifecycle version, earlier service generation and a different service.
        const staleAuthority = {
            tokenVersion: priv.lifecycleVersion,
            lifecycleVersion: priv.lifecycleVersion,
            serviceGeneration: 6,
            service: fakeService({ isDestroyed: () => true }),
            sessionId: 'session-A',
            recordingId: 'recording-A',
            intentToken: 'intent-A',
        };

        const released = priv.releaseFinalizingIfOwner('stale_error', staleAuthority.lifecycleVersion, staleAuthority);

        expect(released, "A must not release a latch it did not arm").toBe(false);
        expect(useSessionStore.getState().isTranscriptFinalizing, "B's Finalizing… stays on").toBe(true);
    });

    it("CASUALTY P1-C: SERVICE IDENTITY alone protects the latch — same lifecycle, same generation", () => {
        /**
         * Codex P2 on `2365f87f8e`, accepted: casualty P1-B varied BOTH generation and service, so the
         * generation comparison refused on its own and the service term was never measured. Removing
         * service identity entirely left P1-B green.
         *
         * Here lifecycle version AND service generation are identical on both sides; only the service
         * object differs. That is the only configuration in which the identity term is load-bearing.
         */
        const priv = controller as unknown as {
            lifecycleVersion: number;
            serviceGeneration: number;
            service: unknown;
            finalizingOwner: unknown;
            finalizingOwnerVersion: number | null;
            releaseFinalizingIfOwner: (reason: string, v?: number | null, owner?: unknown) => boolean;
        };

        const serviceB = fakeService({ isDestroyed: () => false });
        priv.service = serviceB as never;
        priv.serviceGeneration = 4;
        priv.finalizingOwnerVersion = priv.lifecycleVersion;
        priv.finalizingOwner = {
            lifecycleVersion: priv.lifecycleVersion,
            serviceGeneration: 4,
            service: serviceB,
        };
        useSessionStore.getState().setTranscriptFinalizing(true);

        const sameGenerationDifferentService = {
            tokenVersion: priv.lifecycleVersion,
            lifecycleVersion: priv.lifecycleVersion,
            serviceGeneration: 4,
            service: fakeService({ isDestroyed: () => true }),
            sessionId: 'session-A',
            recordingId: 'recording-A',
            intentToken: 'intent-A',
        };

        expect(
            priv.releaseFinalizingIfOwner('stale_error', priv.lifecycleVersion, sameGenerationDifferentService),
            'a different service cannot release the latch',
        ).toBe(false);
        expect(useSessionStore.getState().isTranscriptFinalizing, "B's Finalizing… stays on").toBe(true);

        // NULL IS NOT A WILDCARD, on either side. A detached take carries a null service, which is
        // exactly the state a superseded take is usually in — so treating null as "matches anything"
        // made the term vacuous precisely when it mattered.
        expect(
            priv.releaseFinalizingIfOwner('stale_error', priv.lifecycleVersion,
                { ...sameGenerationDifferentService, service: null }),
            'a null service on the claimant side is not a wildcard',
        ).toBe(false);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);

        priv.finalizingOwner = { lifecycleVersion: priv.lifecycleVersion, serviceGeneration: 4, service: null };
        expect(
            priv.releaseFinalizingIfOwner('stale_error', priv.lifecycleVersion, sameGenerationDifferentService),
            'a null service on the armed side is not a wildcard either',
        ).toBe(false);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);
    });

    it("CASUALTY P1-D: a stale TERMINAL TRANSITION cannot clear the successor's latch", async () => {
        /**
         * PM RETURN on `2365f87f8e`. The stale-token branch in `transition()` released on
         * `finalizingOwnerVersion === token.version` and cleared the latch and frozen transcript
         * directly, bypassing `releaseFinalizingIfOwner()` entirely. With A cancelled and B replacing
         * the service inside the SAME lifecycle version, A's terminal transition matched on version and
         * switched off B's "Finalizing…" — the user watched the record control re-enable mid-save.
         */
        const priv = controller as unknown as {
            lifecycleVersion: number;
            serviceGeneration: number;
            service: unknown;
            finalizingOwner: unknown;
            finalizingOwnerVersion: number | null;
            transition: (state: string, error?: Error, token?: LifecycleToken) => Promise<void>;
        };

        const serviceB = fakeService({ isDestroyed: () => false });
        priv.service = serviceB as never;
        priv.serviceGeneration = 9;
        // B owns the armed latch and the frozen transcript.
        priv.finalizingOwnerVersion = priv.lifecycleVersion;
        priv.finalizingOwner = {
            lifecycleVersion: priv.lifecycleVersion,
            serviceGeneration: 9,
            service: serviceB,
        };
        useSessionStore.getState().setTranscriptFinalizing(true);
        useSessionStore.getState().freezeTranscriptAtStop('B is still saving these words');

        // A speaks with a CANCELLED token carrying the SAME lifecycle version.
        await priv.transition('READY', undefined, { cancelled: true, version: priv.lifecycleVersion } as LifecycleToken);

        expect(useSessionStore.getState().isTranscriptFinalizing,
            "B's Finalizing… survives A's terminal transition").toBe(true);
        expect(useSessionStore.getState().frozenTranscriptAtStop,
            "B's frozen transcript survives").toBe('B is still saving these words');
    });
});
